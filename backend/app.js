import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import axios from 'axios';
import { z } from 'zod';
import { RESOURCES, RESTRICTED_RESOURCES, RESOURCE_GROUPS } from './resources.js';
import { fetchResource, getResourceSchema, getSourceStatus, getResourceCatalog } from './ministry.js';
import { cacheGet, cacheSet, cacheStats } from './cache.js';
import { toGeoPoints } from './analytics.js';
import { loadBrazilStateGeoJSON } from './ibge.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

const origins = new Set((process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:4173')
  .split(',').map(value => value.trim()).filter(Boolean));
app.use(cors((req, callback) => {
  const origin = req.get('Origin');
  const requestOrigin = `${req.protocol}://${req.get('host')}`;
  const isSameOrigin = Boolean(origin && origin === requestOrigin);
  const isAllowedOrigin = !origin || isSameOrigin || origins.has(origin);

  if (!isAllowedOrigin) {
    return callback(Object.assign(new Error('Origem não autorizada pelo CORS.'), { status: 403 }));
  }

  return callback(null, {
    origin: origin || false,
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  });
}));
app.use(express.json({ limit: '128kb' }));
app.use(rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  limit: Number(process.env.RATE_LIMIT_MAX || 90),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas consultas em sequência. Aguarde um pouco e tente novamente.' }
}));

const queryRecordSchema = z.record(z.string(), z.string());
const publicResourceIds = new Set(Object.keys(RESOURCES));
const epidemiologyIds = new Set(['dengue', 'zika', 'chikungunya']);
const vaccinationIds = new Set(['vaccination2025', 'vaccination2026']);

function getQuery(req) {
  const raw = Object.fromEntries(Object.entries(req.query).map(([key, value]) => [key, String(value)]));
  const parsed = queryRecordSchema.safeParse(raw);
  if (!parsed.success) throw Object.assign(new Error('Parâmetros de consulta inválidos.'), { status: 400 });
  return parsed.data;
}

function assertResource(id) {
  if (publicResourceIds.has(id)) return;
  const restricted = RESTRICTED_RESOURCES.find(item => item.id === id);
  if (restricted) throw Object.assign(new Error('Esta fonte está temporariamente bloqueada para consulta pública por revisão de privacidade ou autorização.'), { status: 403, accessStatus: restricted.status });
  throw Object.assign(new Error('Fonte de dados não reconhecida.'), { status: 404 });
}

app.get('/api/health', (_req, res) => res.json({
  status: 'ok', service: 'HealthData Brasil API', time: new Date().toISOString(), cache: cacheStats()
}));

app.get('/api/sources', (_req, res) => res.json({ groups: RESOURCE_GROUPS, ...getResourceCatalog() }));

app.get('/api/sources/status', async (_req, res, next) => {
  try { res.json(await getSourceStatus()); } catch (error) { next(error); }
});

app.get('/api/sources/:resource/schema', async (req, res, next) => {
  try { res.json(await getResourceSchema(req.params.resource)); } catch (error) { next(error); }
});

app.get('/api/data/:resource', async (req, res, next) => {
  try { res.json(await fetchResource(req.params.resource, getQuery(req))); } catch (error) { next(error); }
});

// Contratos internos da plataforma: eles não representam endpoints da API DEMAS.
app.get('/api/overview', async (req, res, next) => {
  try {
    const resource = req.query.resource ? String(req.query.resource) : 'cnesEstablishments';
    assertResource(resource);
    const params = getQuery(req);
    delete params.resource;
    const result = await fetchResource(resource, params);
    res.json({
      resource: result.source,
      pageRecords: result.records.length,
      totalRecordsReported: result.totalRecordsReported,
      analytics: result.analytics,
      pagination: result.pagination,
      fetchedAt: result.fetchedAt,
      sourceStatus: result.sourceStatus,
      cache: result.cache,
      note: result.analytics?.note || 'O resultado representa somente o escopo e a página consultados. Não é total nacional, salvo confirmação explícita da fonte.'
    });
  } catch (error) { next(error); }
});

app.get('/api/estabelecimentos', async (req, res, next) => {
  try {
    const resource = req.query.tipo === 'ubs' ? 'ubs' : req.query.tipo === 'hospitais' ? 'hospitalsBeds' : 'cnesEstablishments';
    const params = getQuery(req);
    delete params.tipo;
    res.json(await fetchResource(resource, params));
  } catch (error) { next(error); }
});

app.get('/api/estabelecimentos/:cnes', async (req, res, next) => {
  try { res.json(await fetchResource('cnesLookup', { codigo_cnes: String(req.params.cnes) })); }
  catch (error) { next(error); }
});

app.get('/api/map/points', async (req, res, next) => {
  try {
    const resource = req.query.resource ? String(req.query.resource) : 'cnesEstablishments';
    assertResource(resource);
    const params = getQuery(req);
    delete params.resource;
    const result = await fetchResource(resource, params);
    res.json({
      source: result.source,
      points: toGeoPoints(result.records),
      recordsWithoutCoordinates: Math.max(0, result.records.length - toGeoPoints(result.records).length),
      pagination: result.pagination,
      fetchedAt: result.fetchedAt,
      sourceStatus: result.sourceStatus,
      note: 'Somente coordenadas fornecidas pela fonte foram representadas. Nenhuma geocodificação presumida foi aplicada.'
    });
  } catch (error) { next(error); }
});

app.get('/api/indicadores/dengue', async (req, res, next) => {
  try {
    const result = await fetchResource('dengue', getQuery(req));
    res.json({ ...result, indicator: { name: 'Registros de dengue agregados', unit: 'registros de notificação na página', method: 'Contagem de linhas recebidas na página agrupadas por ano e município; não representa incidência nem total nacional. Grupos com menos de cinco registros foram suprimidos.' } });
  } catch (error) { next(error); }
});

app.get('/api/indicadores/epidemiologia', async (req, res, next) => {
  try {
    const resource = String(req.query.resource || 'dengue');
    if (!epidemiologyIds.has(resource)) throw Object.assign(new Error('Selecione dengue, Zika ou chikungunya.'), { status: 400 });
    const params = getQuery(req);
    delete params.resource;
    res.json(await fetchResource(resource, params));
  } catch (error) { next(error); }
});

app.get('/api/indicadores/vacinacao', async (req, res, next) => {
  try {
    const year = String(req.query.ano || '2026');
    const resource = `vaccination${year}`;
    if (!vaccinationIds.has(resource)) throw Object.assign(new Error('A API configurada oferece as consultas desta plataforma para 2025 e 2026.'), { status: 400 });
    const params = getQuery(req);
    delete params.ano;
    res.json(await fetchResource(resource, params));
  } catch (error) { next(error); }
});

app.get('/api/geo/estados', async (_req, res, next) => {
  const key = 'ibge:malhas-estados:geojson-minima-v2';
  const cached = cacheGet(key);
  if (cached) return res.json({ ...cached, cache: { hit: true } });
  try {
    // /malhas/estados sem código de UF retorna 404. O helper usa a malha
    // nacional com divisões por UF e, se necessário, consulta cada UF por ID.
    const geojson = await loadBrazilStateGeoJSON((url, config) => axios.get(url, config));
    const payload = {
      ...geojson,
      reference: 'Malhas oficiais do IBGE, qualidade mínima; geometrias agregadas por Unidade da Federação.'
    };
    cacheSet(key, payload, 43200);
    res.json({ ...payload, cache: { hit: false } });
  } catch (error) { next(error); }
});

app.get('/api/geo/municipios', async (req, res, next) => {
  try {
    const rawCodes = String(req.query.codigos || '');
    const codes = [...new Set(rawCodes.split(',').map(code => code.trim()).filter(Boolean))];
    if (!codes.length || codes.length > 25 || codes.some(code => !/^\d{7}$/.test(code))) {
      throw Object.assign(new Error('Informe de 1 a 25 códigos IBGE municipais válidos, separados por vírgula.'), { status: 400 });
    }
    const cacheKey = `ibge:malhas:municipios:v1:${codes.sort().join(',')}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json({ ...cached, cache: { hit: true } });

    const features = [];
    const failures = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(5, codes.length) }, async () => {
      while (cursor < codes.length) {
        const code = codes[cursor++];
        try {
          const url = `https://servicodados.ibge.gov.br/api/v3/malhas/municipios/${code}?formato=application/vnd.geo+json&qualidade=minima`;
          const response = await axios.get(url, { timeout: 12000, headers: { Accept: 'application/geo+json, application/json' }, maxContentLength: 2 * 1024 * 1024 });
          const data = response.data;
          if (data?.type === 'FeatureCollection' && Array.isArray(data.features)) features.push(...data.features);
          else if (data?.type === 'Feature') features.push(data);
          else failures.push(code);
        } catch { failures.push(code); }
      }
    });
    await Promise.all(workers);
    const payload = {
      type: 'FeatureCollection', features,
      source: 'IBGE — API de Malhas Geográficas',
      geography: 'Municípios do conjunto consultado',
      requestedCodes: codes.length,
      returnedFeatures: features.length,
      failedCodes: failures,
      completeness: failures.length ? 'partial' : 'complete'
    };
    if (features.length) cacheSet(cacheKey, payload, 86400);
    res.json({ ...payload, cache: { hit: false } });
  } catch (error) { next(error); }
});

app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

app.use((error, _req, res, _next) => {
  const status = Number(error.status || 500);
  const accessStatus = error.accessStatus || (error.upstreamStatus === 401 || error.upstreamStatus === 403 ? 'restricted' : error.upstreamStatus === 429 ? 'limited' : undefined);
  const safeMessage = error.publicMessage || (status >= 500 ? 'A consulta não pôde ser concluída porque um serviço externo não respondeu.' : error.message);
  res.status(status).json({
    error: safeMessage,
    detail: process.env.NODE_ENV === 'production' ? undefined : error.message,
    code: error.code || 'REQUEST_FAILED',
    upstreamStatus: error.upstreamStatus || undefined,
    accessStatus,
    supportedParameters: error.supportedParameters || undefined
  });
});

export default app;
