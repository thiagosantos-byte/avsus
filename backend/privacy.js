export function normalizeFieldName(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const profile = fields => new Set(fields.map(normalizeFieldName));
const FIELD_PROFILES = {
  facilities: profile([
    // Identificadores e atributos institucionais públicos do CNES.
    'cnes', 'cnescode', 'cocnes', 'codigocnes', 'codigoestabelecimento', 'codigo_cnes',
    'codigo_estabelecimento_saude', 'nome_fantasia', 'nome_razao_social', 'nome_estabelecimento',
    'no_estabelecimento', 'no_fantasia', 'razao_social', 'descricao_esfera_administrativa',
    'descricao_natureza_juridica_estabelecimento', 'tipo_gestao', 'tp_gestao', 'no_grupo_nat_jur',
    'tipo_unidade', 'ds_tipo_unidade', 'codigo_tipo_unidade', 'codigo_identificador_turno_atendimento',
    'descricao_turno_atendimento', 'estabelecimento_faz_atendimento_ambulatorial_sus',
    'estabelecimento_possui_centro_cirurgico', 'estabelecimento_possui_centro_obstetrico',
    'estabelecimento_possui_centro_neonatal', 'estabelecimento_possui_atendimento_hospitalar',
    'estabelecimento_possui_servico_apoio', 'estabelecimento_possui_atendimento_ambulatorial',
    'cnes_status', 'status', 'situacao',
    // Território: endereço do estabelecimento (não endereço residencial de paciente).
    'co_ibge', 'codigo_municipio', 'codigomunicipio', 'municipio', 'nome_municipio',
    'nome_do_municipio', 'nome_municipio_estabelecimento', 'codigo_uf', 'uf', 'sg_uf',
    'codigo_cep_estabelecimento', 'endereco_estabelecimento', 'numero_estabelecimento', 'bairro_estabelecimento',
    // Coordenadas oficiais publicadas pelo CNES.
    'latitude', 'longitude', 'lat', 'lng', 'lon', 'latitude_estabelecimento_decimo_grau',
    'longitude_estabelecimento_decimo_grau', 'lat_estabelecimento', 'long_estabelecimento',
    'nu_comp', 'competencia', 'data_atualizacao', 'data_competencia',
    'qt_leitos', 'qt_leitos_gerais', 'qt_leitos_complementares', 'qt_leitos_sus', 'qt_leitos_nao_sus',
    'tipo_leito', 'descricao', 'equipamento', 'qt_equipamento', 'qt_em_uso', 'quantidade',
    'quantidade_existente', 'quantidade_em_uso'
  ]),
  unitTypes: profile(['codigo', 'codigo_tipo_unidade', 'descricao', 'descricao_tipo_unidade', 'nome', 'tipo_unidade']),
  arbovirus: profile(['nu_ano', 'ano', 'id_municip', 'id_municipio', 'co_ibge', 'codigo_municipio', 'municipio', 'nome_municipio', 'sg_uf', 'uf']),
  vaccination: profile([
    'nu_ano', 'ano', 'nu_comp', 'competencia', 'nu_mes', 'mes', 'sg_uf', 'uf', 'co_ibge', 'codigo_municipio',
    'id_municip', 'municipio', 'nome_municipio', 'imunobiologico', 'nome_imunobiologico', 'vacina', 'nome_vacina',
    'dose', 'tipo_dose', 'doses', 'doses_aplicadas', 'qt_doses', 'quantidade_doses', 'total_doses', 'quantidade',
    'faixa_etaria', 'grupo_de_atendimento', 'ano_aplicacao', 'mes_aplicacao', 'periodo'
  ])
};

const configuredMinimum = Number(process.env.HEALTH_MIN_AGGREGATE_COUNT || 5);
const MIN_AGGREGATE_COUNT = Number.isFinite(configuredMinimum) ? Math.max(5, configuredMinimum) : 5;

function sanitizeRow(row, profileName) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const allowed = FIELD_PROFILES[profileName] || new Set();
  const safe = {};
  for (const [key, value] of Object.entries(row)) {
    if (!allowed.has(normalizeFieldName(key))) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) safe[key] = value;
  }
  return Object.keys(safe).length ? safe : null;
}

function valueFor(row, candidates) {
  const map = new Map(Object.entries(row || {}).map(([key, value]) => [normalizeFieldName(key), value]));
  for (const candidate of candidates) {
    const value = map.get(normalizeFieldName(candidate));
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return null;
}

function findTotal(payload) {
  if (!payload || typeof payload !== 'object') return null;
  for (const key of ['total_registros', 'totalRegistros', 'total', 'count', 'total_count', 'totalCount']) {
    const value = payload[key];
    const numeric = Number(value?.value ?? value);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  }
  for (const value of Object.values(payload)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = findTotal(value);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function aggregateArbovirus(rows) {
  const groups = new Map();
  for (const row of rows) {
    const year = valueFor(row, ['nu_ano', 'ano']);
    const municipality = valueFor(row, ['id_municip', 'id_municipio', 'co_ibge', 'codigo_municipio']);
    const state = valueFor(row, ['sg_uf', 'uf']) || (municipality && /^\d{7}$/.test(municipality) ? municipality.slice(0, 2) : null);
    const key = [year || 'não informado', municipality || 'território não informado', state || ''].join('|');
    const group = groups.get(key) || { nu_ano: year, id_municip: municipality, sg_uf: state, registros_na_pagina: 0 };
    group.registros_na_pagina += 1;
    groups.set(key, group);
  }
  const grouped = [...groups.values()];
  const visible = grouped.filter(row => row.registros_na_pagina >= MIN_AGGREGATE_COUNT);
  return {
    records: visible,
    suppressedGroups: grouped.length - visible.length,
    privacy: {
      aggregated: true,
      minimumGroupSize: MIN_AGGREGATE_COUNT,
      suppressedGroups: grouped.length - visible.length,
      note: 'Registros de notificação recebidos nesta página foram agregados por ano e município. A contagem não deve ser interpretada como incidência ou total de casos. Grupos com menos de cinco registros foram suprimidos.'
    },
    totalRecordsReported: null,
    sourceRecordCount: rows.length
  };
}

function aggregateVaccination(rows, originalRowCount = rows.length) {
  const groups = new Map();
  let quantityRows = 0;
  for (const row of rows) {
    const year = valueFor(row, ['nu_ano', 'ano', 'ano_aplicacao']);
    const month = valueFor(row, ['nu_mes', 'mes', 'mes_aplicacao', 'nu_comp', 'competencia']);
    const state = valueFor(row, ['sg_uf', 'uf']);
    const vaccine = valueFor(row, ['imunobiologico', 'nome_imunobiologico', 'vacina', 'nome_vacina']);
    const dose = valueFor(row, ['dose', 'tipo_dose']);
    const quantityRaw = valueFor(row, ['doses_aplicadas', 'qt_doses', 'quantidade_doses', 'total_doses', 'quantidade']);
    const quantity = quantityRaw !== null && Number.isFinite(Number(quantityRaw)) ? Number(quantityRaw) : null;
    if (quantity !== null) quantityRows += 1;
    const key = [year || '', month || '', state || '', vaccine || '', dose || ''].join('|');
    const group = groups.get(key) || {
      nu_ano: year, nu_mes: month, sg_uf: state,
      imunobiologico: vaccine, dose, doses_aplicadas: 0, registros_agregados: 0
    };
    group.registros_agregados += 1;
    if (quantity !== null) group.doses_aplicadas += quantity;
    groups.set(key, group);
  }
  const all = [...groups.values()];
  const hasCompleteQuantity = originalRowCount > 0 && quantityRows === originalRowCount;
  const visible = all.filter(row => row.registros_agregados >= MIN_AGGREGATE_COUNT);
  return {
    records: visible.map(row => {
      if (!hasCompleteQuantity) delete row.doses_aplicadas;
      delete row.registros_agregados;
      return row;
    }),
    suppressedGroups: all.length - visible.length,
    privacy: {
      aggregated: true,
      minimumGroupSize: MIN_AGGREGATE_COUNT,
      suppressedGroups: all.length - visible.length,
      quantitySemantics: hasCompleteQuantity ? 'Soma de coluna quantitativa reconhecida em todos os registros recebidos.' : 'A fonte não forneceu uma quantidade reconhecida para todos os registros; não foi calculado total de doses.'
    },
    totalRecordsReported: null,
    sourceRecordCount: rows.length
  };
}

export function sanitizePublicPayload(resource, payload, extractRecords) {
  const sourceRecords = extractRecords(payload);
  const totalFromSource = findTotal(payload);

  if (resource.profile === 'arbovirus') {
    const aggregated = aggregateArbovirus(sourceRecords);
    return { data: { records: aggregated.records, total_registros: aggregated.totalRecordsReported }, ...aggregated };
  }
  if (resource.profile === 'vaccination') {
    const safeRows = sourceRecords.map(row => sanitizeRow(row, resource.profile)).filter(Boolean);
    const aggregated = aggregateVaccination(safeRows, sourceRecords.length);
    return { data: { records: aggregated.records, total_registros: aggregated.totalRecordsReported }, ...aggregated };
  }

  const records = sourceRecords.map(row => sanitizeRow(row, resource.profile)).filter(Boolean);
  return {
    data: { records, total_registros: totalFromSource }, records,
    totalRecordsReported: totalFromSource,
    privacy: { aggregated: false, fieldsFiltered: true, note: 'Somente campos públicos permitidos para esta fonte foram mantidos.' }
  };
}

export function safeCsvRows(rows, resource) {
  const profileName = resource?.profile;
  return (Array.isArray(rows) ? rows : []).map(row => sanitizeRow(row, profileName)).filter(Boolean);
}
