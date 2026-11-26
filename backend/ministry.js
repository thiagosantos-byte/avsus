import axios from 'axios';
import { z } from 'zod';
import { RESOURCES, RESTRICTED_RESOURCES } from './resources.js';
import { cacheGet, cacheSet } from './cache.js';
import { getServiceSupabase } from './supabase.js';
import { extractRecords } from './dataShape.js';
import { sanitizePublicPayload } from './privacy.js';
import { buildAnalytics } from './analytics.js';
import { describedMaximum, buildPageMetadata } from './pagination.js';
import { classifyApiHttpStatus } from './status.js';
import { validateParameter } from './validation.js';
export { describedMaximum, buildPageMetadata } from './pagination.js';

const querySchema = z.record(z.string(), z.string()).superRefine((value, ctx) => {
  if (Object.keys(value).length > 40) ctx.addIssue({ code: 'custom', message: 'Quantidade excessiva de parâmetros.' });
  for (const [key, item] of Object.entries(value)) {
    if (key.length > 80 || item.length > 500) ctx.addIssue({ code: 'custom', message: 'Parâmetro excede o tamanho permitido.' });
  }
});
const DEFAULT_SWAGGER = 'https://apidadosabertos.saude.gov.br/static/swagger.json';
const DEFAULT_BASE = 'https://apidadosabertos.saude.gov.br';
const CACHE_VERSION = 'v3-cnes-root-safe';
let swaggerPromise;
let swaggerLoadedAt = 0;

function httpClient(timeout) {
  return axios.create({
    timeout: timeout || Math.min(Number(process.env.HEALTH_API_TIMEOUT_MS || 12000), 15000),
    headers: { Accept: 'application/json', 'User-Agent': 'HealthData-Brasil/1.2 (dados públicos de saúde)' },
    maxContentLength: 20 * 1024 * 1024,
    maxBodyLength: 2 * 1024 * 1024,
    validateStatus: status => status >= 200 && status < 300
  });
}

export async function requestWithRetry(url, attempts = 2, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await httpClient(options.timeout).get(url, options.config || {});
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      const retryable = !status || status === 408 || status === 425 || status === 429 || [500, 502, 503, 504].includes(status);
      if (!retryable || attempt === attempts - 1) break;
      const retryAfter = Number(error.response?.headers?.['retry-after']);
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 5000)
        : Math.min(300 * (2 ** attempt), 1800);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}

export async function getSwagger(force = false) {
  if (!force && swaggerPromise && Date.now() - swaggerLoadedAt < 30 * 60 * 1000) return swaggerPromise;
  swaggerPromise = requestWithRetry(process.env.HEALTH_API_SWAGGER_URL || DEFAULT_SWAGGER, 1, { timeout: 9000 })
    .then(({ data }) => {
      if (!data || typeof data !== 'object' || !data.paths) throw new Error('O Swagger recebido não possui a estrutura de caminhos esperada.');
      swaggerLoadedAt = Date.now();
      return data;
    })
    .catch(error => {
      swaggerPromise = null;
      throw new Error(`Não foi possível carregar o Swagger oficial: ${error.message}`);
    });
  return swaggerPromise;
}

function resolveParameterRef(parameter, spec) {
  if (!parameter?.$ref) return parameter;
  const ref = parameter.$ref.replace(/^#\//, '').split('/');
  return ref.reduce((value, key) => value?.[key], spec) || parameter;
}

function operationParameters(pathItem, operation, spec) {
  const merged = new Map();
  for (const p of [...(pathItem.parameters || []), ...(operation.parameters || [])]) {
    const item = resolveParameterRef(p, spec);
    if (item?.name && item.in) merged.set(`${item.in}:${item.name}`, item);
  }
  return [...merged.values()];
}

function normalizedParameter(parameter) {
  return {
    name: parameter.name,
    in: parameter.in,
    required: Boolean(parameter.required),
    type: parameter.type || parameter.schema?.type || 'string',
    description: parameter.description || '',
    enum: parameter.enum || parameter.schema?.enum || null,
    format: parameter.format || parameter.schema?.format || null,
    minimum: parameter.minimum ?? parameter.schema?.minimum ?? (parameter.name === 'offset' ? 0 : parameter.name === 'limit' ? 1 : null),
    maximum: describedMaximum(parameter),
    default: parameter.default ?? parameter.schema?.default ?? null
  };
}

export async function getResourceSchema(resourceId) {
  const resource = RESOURCES[resourceId];
  if (!resource) {
    const restricted = RESTRICTED_RESOURCES.find(item => item.id === resourceId);
    if (restricted) throw Object.assign(new Error(`${restricted.label}: consulta pública bloqueada. ${restricted.reason}`), { status: 403, accessStatus: restricted.status });
    throw Object.assign(new Error('Recurso não reconhecido.'), { status: 404 });
  }
  const spec = await getSwagger();
  const pathItem = spec.paths?.[resource.path];
  const operation = pathItem?.get;
  if (!operation) throw Object.assign(new Error(`A operação GET ${resource.path} não foi encontrada no Swagger atual.`), { status: 503 });
  const parameters = operationParameters(pathItem, operation, spec).map(normalizedParameter);
  const limit = parameters.find(item => item.in === 'query' && item.name === 'limit');
  const offset = parameters.find(item => item.in === 'query' && item.name === 'offset');
  const documentedDefault = limit?.default === null ? null : Number(limit?.default);
  const safeDefault = limit ? Math.min(
    Number.isFinite(documentedDefault) && documentedDefault > 0 ? documentedDefault : 100,
    limit.maximum || 100
  ) : null;
  const paging = limit ? {
    limitParameter: 'limit',
    offsetParameter: offset?.name || null,
    maxLimit: limit.maximum,
    defaultLimit: safeDefault,
    offsetSemantics: 'page-index-zero-based'
  } : null;
  return {
    id: resourceId,
    ...resource,
    summary: operation.summary || resource.description,
    operationDescription: operation.description || '',
    parameters,
    pagination: paging,
    security: operation.security || spec.security || [],
    responseContentType: operation.produces || spec.produces || ['application/json'],
    swaggerVersion: spec.info?.version || null,
    lastSwaggerCheck: new Date(swaggerLoadedAt).toISOString()
  };
}

async function readPersistedCache(cacheKey) {
  const supabase = getServiceSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from('api_cache').select('payload, expires_at').eq('cache_key', cacheKey).maybeSingle();
    if (error || !data?.payload) return null;
    return { payload: data.payload, fresh: new Date(data.expires_at).getTime() > Date.now() };
  } catch { return null; }
}

async function writePersistedCache(cacheKey, resourceId, payload, ttlSeconds) {
  const supabase = getServiceSupabase();
  if (!supabase || ttlSeconds <= 0) return;
  const fetchedAt = new Date();
  try {
    await supabase.from('api_cache').upsert({
      cache_key: cacheKey, source_key: resourceId, payload,
      fetched_at: fetchedAt.toISOString(),
      expires_at: new Date(fetchedAt.getTime() + ttlSeconds * 1000).toISOString()
    }, { onConflict: 'cache_key' });
  } catch { /* Cache persistente é auxiliar. */ }
}

async function writeSyncLog(resourceId, status, details = {}) {
  const supabase = getServiceSupabase();
  if (!supabase) return;
  try {
    await supabase.from('api_sync_logs').insert({
      source_key: resourceId, status,
      details: { upstreamStatus: details.upstreamStatus || null, elapsedMs: details.elapsedMs || null, errorCode: details.errorCode || null },
      completed_at: new Date().toISOString()
    });
  } catch { /* Logs nunca devem derrubar a consulta. */ }
}

function sourceCompetence(resource, params, payload) {
  for (const key of ['nu_comp', 'nu_ano', 'ano', 'ano_referencia', 'anomes', 'ano_mes']) {
    if (params[key]) return `${key}=${params[key]}`;
  }
  for (const key of ['competencia', 'nu_comp', 'data_referencia', 'ano_referencia']) {
    if (payload && typeof payload === 'object' && payload[key] !== undefined) return String(payload[key]);
  }
  return resource.dataReference || 'Não informada pela fonte para esta consulta';
}

function stableQueryString(params) {
  const sorted = new URLSearchParams();
  [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([key, value]) => sorted.set(key, value));
  return sorted.toString();
}

export async function fetchResource(resourceId, rawParams = {}) {
  const parsed = querySchema.safeParse(rawParams);
  if (!parsed.success) throw Object.assign(new Error('Parâmetros de consulta inválidos.'), { status: 400 });
  const resource = RESOURCES[resourceId];
  if (!resource) {
    const restricted = RESTRICTED_RESOURCES.find(item => item.id === resourceId);
    if (restricted) throw Object.assign(new Error(`Consulta bloqueada por privacidade: ${restricted.reason}`), { status: 403, accessStatus: restricted.status });
    throw Object.assign(new Error('Recurso não reconhecido.'), { status: 404 });
  }

  const schema = await getResourceSchema(resourceId);
  const allowed = new Map(schema.parameters.map(parameter => [`${parameter.in}:${parameter.name}`, parameter]));
  const pathParams = new Map();
  const queryParams = new URLSearchParams();

  for (const [name, value] of Object.entries(parsed.data)) {
    if (!String(value).trim()) continue;
    const parameter = allowed.get(`query:${name}`) || allowed.get(`path:${name}`);
    if (!parameter) {
      const supported = schema.parameters.filter(item => item.in === 'query' || item.in === 'path').map(item => item.name);
      throw Object.assign(new Error(`Parâmetro "${name}" não documentado para este endpoint. Parâmetros aceitos: ${supported.join(', ') || 'nenhum'}.`), { status: 400, supportedParameters: supported });
    }
    const clean = validateParameter(value, parameter);
    if (parameter.in === 'path') pathParams.set(name, encodeURIComponent(clean));
    else queryParams.set(name, clean);
  }

  // Limite e deslocamento são específicos da operação; o máximo é extraído
  // do próprio Swagger, inclusive quando a restrição consta na descrição.
  if (schema.pagination) {
    const parameter = schema.parameters.find(item => item.name === 'limit' && item.in === 'query');
    const requested = Number(queryParams.get('limit') || schema.pagination.defaultLimit || 100);
    const maxAllowed = parameter?.maximum ?? null;
    if (maxAllowed !== null && requested > maxAllowed) throw Object.assign(new Error(`O limite máximo documentado para ${resource.label} é ${maxAllowed} registros por página.`), { status: 400 });
    if (!queryParams.has('limit')) queryParams.set('limit', String(schema.pagination.defaultLimit || 100));
    if (schema.pagination.offsetParameter && !queryParams.has(schema.pagination.offsetParameter)) {
      queryParams.set(schema.pagination.offsetParameter, '0');
    }
  }

  // O endpoint de arboviroses publica dados de notificação em nível individual.
  // Solicita apenas chaves de agregação permitidas e agrega antes da resposta.
  if (resource.profile === 'arbovirus' && allowed.has('query:campos')) {
    const safeFields = ['nu_ano', 'sg_uf', 'id_municip'];
    const requestedFields = queryParams.get('campos')?.split(',').map(value => value.trim()).filter(Boolean) || [];
    const unsafe = requestedFields.filter(field => !safeFields.includes(field));
    if (unsafe.length) throw Object.assign(new Error('A seleção de campos solicitada contém colunas não permitidas para consulta pública.'), { status: 400 });
    queryParams.set('campos', safeFields.join(','));
  }

  const path = resource.path.replace(/\{([^}]+)\}/g, (_match, name) => {
    if (!pathParams.has(name)) throw Object.assign(new Error(`O parâmetro de caminho ${name} é obrigatório.`), { status: 400 });
    return pathParams.get(name);
  });
  const url = `${(process.env.HEALTH_API_BASE_URL || DEFAULT_BASE).replace(/\/$/, '')}${path}${queryParams.size ? `?${stableQueryString(queryParams)}` : ''}`;
  const cacheKey = `${CACHE_VERSION}:${resourceId}:${stableQueryString(queryParams)}`;
  const memoryPayload = cacheGet(cacheKey);
  const cached = memoryPayload
    ? { payload: memoryPayload, fresh: true, memory: true }
    : await readPersistedCache(cacheKey);
  if (cached?.fresh) return { ...cached.payload, cache: { hit: true, persistent: !cached.memory }, sourceStatus: 'cached' };

  const startedAt = Date.now();
  try {
    const response = await requestWithRetry(url, 2, { timeout: Math.min(Number(process.env.HEALTH_API_TIMEOUT_MS || 12000), 15000) });
    const sanitized = sanitizePublicPayload(resource, response.data, extractRecords);
    const pageParams = new URLSearchParams(queryParams);
    const pagination = buildPageMetadata(sanitized.sourceRecordCount ?? sanitized.records.length, pageParams, schema.pagination, sanitized.totalRecordsReported);
    const payload = {
      source: { id: resourceId, label: resource.label, endpoint: resource.path, competence: sourceCompetence(resource, parsed.data, response.data), fetchedAt: new Date().toISOString(), referenceNote: resource.dataReference || null },
      fetchedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt,
      records: sanitized.records, sourceRecordCount: sanitized.sourceRecordCount ?? sanitized.records.length, totalRecordsReported: sanitized.totalRecordsReported,
      pagination, analytics: buildAnalytics(resourceId, sanitized.records, sanitized.totalRecordsReported),
      privacy: sanitized.privacy || { aggregated: false, fieldsFiltered: true },
      sourceStatus: 'online'
    };
    const ttl = Number(process.env.HEALTH_API_CACHE_TTL_SECONDS || 600);
    cacheSet(cacheKey, payload, ttl);
    await writePersistedCache(cacheKey, resourceId, payload, ttl);
    await writeSyncLog(resourceId, 'success', { upstreamStatus: response.status, elapsedMs: payload.elapsedMs });
    return { ...payload, cache: { hit: false, persistent: false } };
  } catch (error) {
    await writeSyncLog(resourceId, 'error', { upstreamStatus: error.response?.status, elapsedMs: Date.now() - startedAt, errorCode: error.code });
    const stale = cached?.payload;
    if (stale) return { ...stale, sourceStatus: 'cached_stale', cache: { hit: true, stale: true }, warning: 'A fonte não respondeu. Os dados abaixo vieram de cache e não representam atualização atual.' };
    const status = error.response?.status;
    const accessStatus = status === 401 || status === 403 ? 'restricted'
      : status === 429 ? 'limited'
      : status && status >= 500 ? 'unavailable' : null;
    const timeout = ['ECONNABORTED', 'ETIMEDOUT'].includes(error.code);
    const publicMessage = status === 400
      ? 'A fonte oficial recusou os filtros informados. Revise os campos e tente novamente.'
      : status === 401 || status === 403
        ? 'A fonte oficial restringiu temporariamente o acesso a este conjunto de dados.'
        : status === 429
          ? 'A fonte oficial recebeu muitas consultas. Aguarde um pouco antes de tentar novamente.'
          : timeout || !status
            ? 'A fonte oficial demorou para responder. Tente novamente em instantes; seus filtros foram mantidos.'
            : 'A fonte oficial está temporariamente indisponível. Tente novamente em instantes.';
    const errorCode = status === 400 ? 'UPSTREAM_INVALID_FILTER'
      : status === 429 ? 'UPSTREAM_RATE_LIMIT'
        : status === 401 || status === 403 ? 'UPSTREAM_RESTRICTED'
          : timeout || !status ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE';
    throw Object.assign(new Error(publicMessage), {
      status: status === 400 ? 422 : status === 401 || status === 403 || status === 429 ? 503 : 502,
      publicMessage, upstreamStatus: status, accessStatus, code: errorCode
    });
  }
}

export async function getSourceStatus() {
  const checkedAt = new Date().toISOString();
  let swagger = 'unverified';
  let version = null;
  let resourcesDocumented = 0;
  try {
    const spec = await getSwagger();
    swagger = 'online';
    version = spec.info?.version || null;
    resourcesDocumented = Object.values(spec.paths || {}).reduce((sum, item) => sum + (item.get ? 1 : 0), 0);
  } catch { swagger = 'unavailable'; }

  let api = 'unverified';
  let apiHttpStatus = null;
  let apiMessage = null;
  try {
    const base = (process.env.HEALTH_API_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
    const response = await requestWithRetry(`${base}/cnes/tipounidades`, 1, { timeout: 8000 });
    apiHttpStatus = response.status;
    api = classifyApiHttpStatus(response.status);
  } catch (error) {
    apiHttpStatus = error.response?.status || null;
    api = classifyApiHttpStatus(apiHttpStatus);
    apiMessage = apiHttpStatus ? `HTTP ${apiHttpStatus}` : 'Falha de conexão ou tempo limite';
  }
  return {
    title: 'API de Dados Abertos — DEMAS', version, resourcesDocumented,
    swagger, api, apiHttpStatus, apiMessage,
    checkedAt, cache: CACHE_VERSION
  };
}

export function getResourceCatalog() {
  const active = Object.entries(RESOURCES).map(([id, item]) => ({ id, ...item, status: 'configured' }));
  return {
    resources: active,
    restricted: RESTRICTED_RESOURCES.map(item => ({ ...item })),
    note: 'Configurado não significa sincronizado: cada fonte é consultada somente quando o usuário solicita e o status real é retornado pela API.'
  };
}
