import { normalizeFieldName } from './privacy.js';

function valueFor(row, names) {
  const map = new Map(Object.entries(row || {}).map(([key, value]) => [normalizeFieldName(key), value]));
  for (const name of names) {
    const value = map.get(normalizeFieldName(name));
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function sortedCounts(map, limit = 15) {
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || String(a.name).localeCompare(String(b.name), 'pt-BR'))
    .slice(0, limit);
}

export function buildAnalytics(resourceId, rows, totalRecordsReported = null) {
  const measureFields = resourceId === 'hospitalsBeds' || resourceId === 'cnesBeds' ? ['qt_leitos']
    : resourceId === 'cnesEquipment' ? ['qt_equipamento']
      : ['doses_aplicadas', 'registros_na_pagina'];
  const measureLabelByResource = {
    hospitalsBeds: 'Leitos informados na página',
    cnesBeds: 'Leitos informados na página',
    cnesEquipment: 'Equipamentos informados na página',
    vaccination2025: 'Doses agregadas na página',
    vaccination2026: 'Doses agregadas na página',
    dengue: 'Registros de notificação na página',
    zika: 'Registros de notificação na página',
    chikungunya: 'Registros de notificação na página'
  };
  const measureValues = rows.map((row) => {
    const rawMeasure = valueFor(row, measureFields);
    if (rawMeasure === null) return null;
    const parsed = Number(rawMeasure);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  });
  const hasCompleteMeasure = rows.length > 0 && measureValues.every((value) => value !== null);
  const explicitMeasureTotal = hasCompleteMeasure
    ? measureValues.reduce((total, value) => total + value, 0)
    : null;
  const result = {
    pageRecords: rows.length,
    totalRecordsReported,
    measureLabel: measureLabelByResource[resourceId] || 'Registros na página',
    totalMeasureInPage: null,
    note: totalRecordsReported === null
      ? 'A fonte não informou o total correspondente aos filtros. O quantitativo abaixo representa apenas a página consultada.'
      : 'O total informado é o total retornado pela fonte para os filtros aplicados.'
  };
  const byYear = new Map();
  const byState = new Map();
  const byMunicipality = new Map();
  const byCategory = new Map();
  const byImmunobiological = new Map();

  for (const [index, row] of rows.entries()) {
    const year = valueFor(row, ['nu_ano', 'ano', 'ano_referencia', 'anoaplicacao']);
    const weight = hasCompleteMeasure ? measureValues[index] : 1;
    if (year !== null) byYear.set(String(year), (byYear.get(String(year)) || 0) + weight);

    let state = valueFor(row, ['sg_uf', 'uf', 'uf_estabelecimento', 'uf_paciente']);
    if (!state) {
      const municipality = valueFor(row, ['id_municip', 'id_municipio', 'co_ibge', 'codigo_municipio']);
      const code = String(municipality || '').replace(/\D/g, '');
      if (code.length === 7) state = code.slice(0, 2);
    }
    if (state) byState.set(String(state).toUpperCase(), (byState.get(String(state).toUpperCase()) || 0) + weight);

    const municipality = valueFor(row, ['id_municip', 'id_municipio', 'co_ibge', 'codigo_municipio', 'municipio', 'nome_municipio']);
    if (municipality !== null) byMunicipality.set(String(municipality), (byMunicipality.get(String(municipality)) || 0) + weight);

    const category = valueFor(row, ['tipo_unidade', 'ds_tipo_unidade', 'tp_unidade', 'tipo_leito', 'equipamento']);
    if (category) byCategory.set(String(category), (byCategory.get(String(category)) || 0) + weight);

    const vaccine = valueFor(row, ['imunobiologico', 'nome_imunobiologico', 'vacina', 'nome_vacina']);
    if (vaccine) byImmunobiological.set(String(vaccine), (byImmunobiological.get(String(vaccine)) || 0) + weight);
  }

  result.totalMeasureInPage = explicitMeasureTotal;
  if (resourceId.startsWith('vaccination') && !hasCompleteMeasure) result.measureLabel = 'Registros de vacinação na página';
  return {
    ...result,
    byYear: sortedCounts(byYear, 20).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    byState: sortedCounts(byState, 27),
    byMunicipality: sortedCounts(byMunicipality, 20),
    byCategory: sortedCounts(byCategory, 20),
    byImmunobiological: sortedCounts(byImmunobiological, 20)
  };
}

export function toGeoPoints(rows) {
  const points = [];
  for (const row of rows || []) {
    const lookup = new Map(Object.entries(row || {}).map(([key, value]) => [normalizeFieldName(key), value]));
    const rawLat = lookup.get('latitude') ?? lookup.get('lat') ?? lookup.get('latitudeestabelecimentodecimograu') ?? lookup.get('latestabelecimento');
    const rawLng = lookup.get('longitude') ?? lookup.get('lng') ?? lookup.get('lon') ?? lookup.get('longitudeestabelecimentodecimograu') ?? lookup.get('longestabelecimento');
    if (rawLat === undefined || rawLat === null || rawLat === '' || rawLng === undefined || rawLng === null || rawLng === '') continue;
    const lat = Number(String(rawLat).replace(',', '.'));
    const lng = Number(String(rawLng).replace(',', '.'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -34 || lat > 6 || lng < -75 || lng > -32) continue;
    points.push({
      id: String(lookup.get('codigocnes') ?? lookup.get('codigoestabelecimentosaude') ?? lookup.get('cnes') ?? lookup.get('cocnes') ?? points.length + 1),
      name: String(lookup.get('nomefantasia') ?? lookup.get('nomerazaosocial') ?? lookup.get('nomeestabelecimento') ?? lookup.get('noestabelecimento') ?? 'Estabelecimento de saúde'),
      category: String(lookup.get('tipounidade') ?? lookup.get('dstipounidade') ?? lookup.get('codigotipounidade') ?? 'Estabelecimento de saúde'),
      municipality: String(lookup.get('municipio') ?? lookup.get('nomemunicipio') ?? lookup.get('codigomunicipio') ?? 'Município não informado'),
      uf: String(lookup.get('sguf') ?? lookup.get('uf') ?? lookup.get('codigouf') ?? ''),
      lat, lng
    });
  }
  return points;
}
