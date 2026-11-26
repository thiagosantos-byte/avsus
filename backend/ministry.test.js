import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRecords } from './dataShape.js';

test('extractRecords reads array payload', () => {
  assert.deepEqual(extractRecords([{ a: 1 }]), [{ a: 1 }]);
});

test('extractRecords reads common object result wrappers', () => {
  assert.deepEqual(extractRecords({ data: [{ cnes: '1' }] }), [{ cnes: '1' }]);
  assert.deepEqual(extractRecords({ result: [{ value: 2 }] }), [{ value: 2 }]);
  assert.deepEqual(extractRecords({ hits: { hits: [{ _source: { cnes: '2' } }] } }), [{ cnes: '2' }]);
});

test('extractRecords does not fabricate records', () => {
  assert.deepEqual(extractRecords({ message: 'sem dados' }), []);
  assert.deepEqual(extractRecords(null), []);
});

import { describedMaximum, buildPageMetadata } from './pagination.js';
import { sanitizePublicPayload, normalizeFieldName } from './privacy.js';
import { buildAnalytics, toGeoPoints } from './analytics.js';
import { RESOURCES } from './resources.js';

const extract = extractRecords;

test('Swagger page-size maximum is extracted from Portuguese descriptions', () => {
  assert.equal(describedMaximum({ description: 'O valor deve ser menor ou igual a 20.' }), 20);
  assert.equal(describedMaximum({ description: 'Quantidade de itens. Deve ser menor ou igual 1000.' }), 1000);
  assert.equal(describedMaximum({ maximum: 300, description: 'texto' }), 300);
  assert.equal(describedMaximum({ description: 'Sem limite informado.' }), null);
});

test('page metadata uses page-index offset semantics and source total', () => {
  const meta = buildPageMetadata(new Array(20).fill({}), new URLSearchParams('limit=20&offset=1'), { defaultLimit: 20, offsetParameter: 'offset' }, 55);
  assert.equal(meta.page, 2);
  assert.equal(meta.hasPrevious, true);
  assert.equal(meta.hasNext, true);
  assert.equal(meta.nextOffset, 2);
});

test('pagination infers next page from raw source rows when the total is unknown', () => {
  const fullPage = buildPageMetadata(20, new URLSearchParams('limit=20&offset=0'), { defaultLimit: 20, offsetParameter: 'offset' }, null);
  const lastPage = buildPageMetadata(7, new URLSearchParams('limit=20&offset=1'), { defaultLimit: 20, offsetParameter: 'offset' }, null);
  assert.equal(fullPage.hasNext, true);
  assert.equal(lastPage.hasNext, false);
});

test('public facility sanitizer removes identifiers and contact/clinical fields', () => {
  const result = sanitizePublicPayload({ profile: 'facilities' }, { records: [{
    co_cnes: '1234567', no_fantasia: 'UBS Central', latitude: '-12', longitude: '-38',
    cpf: '12345678900', telefone: '71999999999', endereco: 'Rua particular', nome_paciente: 'Pessoa'
  }] }, extract);
  assert.deepEqual(result.records, [{ co_cnes: '1234567', no_fantasia: 'UBS Central', latitude: '-12', longitude: '-38' }]);
});

test('arbovirus notifications are aggregated and small groups suppressed', () => {
  const payload = { records: Array.from({ length: 6 }, () => ({ nu_ano: 2025, id_municip: '2927408', cpf: 'secret' }))
    .concat([{ nu_ano: 2025, id_municip: '2927409' }]) };
  const result = sanitizePublicPayload({ profile: 'arbovirus' }, payload, extract);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].registros_na_pagina, 6);
  assert.equal(result.sourceRecordCount, 7);
  assert.equal(result.privacy.suppressedGroups, 1);
  assert.equal(result.totalRecordsReported, null, 'não expõe o total quando existem grupos suprimidos');
  assert.equal('cpf' in result.records[0], false);
});

test('vaccination output aggregates recognized doses and never exposes unapproved fields', () => {
  const payload = { records: Array.from({ length: 6 }, (_, index) => ({
    nu_ano: 2025, nu_mes: 3, sg_uf: 'BA', imunobiologico: 'Vacina X', dose: 'D1',
    qt_doses: 10, cpf: `sensitive-${index}`, nome_paciente: `Pessoa ${index}`
  })) };
  const result = sanitizePublicPayload({ profile: 'vaccination' }, payload, extract);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].doses_aplicadas, 60);
  assert.equal('cpf' in result.records[0], false);
  assert.equal('nome_paciente' in result.records[0], false);
  assert.equal(result.privacy.aggregated, true);
});

test('field names are normalized and geo points reject out-of-Brazil coordinates', () => {
  assert.equal(normalizeFieldName('Código Município'), 'codigomunicipio');
  assert.equal(toGeoPoints([{ latitude: -12, longitude: -38, cnes: '1' }, { latitude: 48, longitude: 2, cnes: '2' }]).length, 1);
});

test('analytics counts notification measures instead of merely counting aggregate rows', () => {
  const analytics = buildAnalytics('dengue', [
    { nu_ano: '2025', id_municip: '2927408', registros_na_pagina: 12 },
    { nu_ano: '2025', id_municip: '2927409', registros_na_pagina: 4 }
  ], 16);
  assert.deepEqual(analytics.byYear, [{ name: '2025', value: 16 }]);
});


import { classifyApiHttpStatus } from './status.js';

test('API status is online only for successful 2xx responses', () => {
  assert.equal(classifyApiHttpStatus(200), 'online');
  assert.equal(classifyApiHttpStatus(204), 'online');
  assert.equal(classifyApiHttpStatus(401), 'restricted');
  assert.equal(classifyApiHttpStatus(403), 'restricted');
  assert.equal(classifyApiHttpStatus(429), 'limited');
  assert.equal(classifyApiHttpStatus(404), 'unavailable');
  assert.equal(classifyApiHttpStatus(503), 'unavailable');
  assert.equal(classifyApiHttpStatus(null), 'unavailable');
});


import { buildSafeCsv } from '../shared/csv.js';

test('CSV repeats metadata as columns and neutralizes spreadsheet formulas', () => {
  const csv = buildSafeCsv([
    { municipio: '=HYPERLINK("https://example.com")', registros: 6 },
    { municipio: 'Salvador', registros: 8 }
  ], { Fonte: 'DEMAS', Competencia: '2025' });
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0].split(';').length, 4);
  assert.equal(lines[1].split(';').length, 4);
  assert.match(lines[1], /'=HYPERLINK/);
  assert.match(lines[0], /"Fonte";"Competencia"/);
});


test('analytics sums only an explicit total-leitos field for hospital resources', () => {
  const analytics = buildAnalytics('hospitalsBeds', [
    { sg_uf: 'BA', qt_leitos: 120, nu_ano: '2025' },
    { sg_uf: 'SP', qt_leitos: 80, nu_ano: '2025' }
  ], null);
  assert.equal(analytics.measureLabel, 'Leitos informados na página');
  assert.equal(analytics.totalMeasureInPage, 200);
  assert.deepEqual(analytics.byState, [{ name: 'BA', value: 120 }, { name: 'SP', value: 80 }]);
});


test('vaccination does not publish partial sums when any source row lacks the quantity field', () => {
  const rows = Array.from({ length: 6 }, (_, index) => ({
    nu_ano: 2025, sg_uf: 'BA', imunobiologico: 'Vacina X',
    ...(index === 5 ? {} : { qt_doses: 10 })
  }));
  const result = sanitizePublicPayload({ profile: 'vaccination' }, { records: rows }, extract);
  assert.equal(result.records.length, 1);
  assert.equal('doses_aplicadas' in result.records[0], false);
  assert.match(result.privacy.quantitySemantics, /todos os registros/);
});


test('analytics does not publish partial bed sums when any row lacks the quantity field', () => {
  const result = buildAnalytics('hospitalsBeds', [
    { sg_uf: 'BA', qt_leitos: 120 },
    { sg_uf: 'SP' }
  ], null);
  assert.equal(result.totalMeasureInPage, null);
  assert.deepEqual(result.byState, [{ name: 'BA', value: 1 }, { name: 'SP', value: 1 }]);
  assert.match(result.note, /apenas a página consultada/);
});


test('pagination does not advertise navigation when the Swagger operation has no offset parameter', () => {
  const metadata = buildPageMetadata(20, new URLSearchParams('limit=20'), {
    limitParameter: 'limit', offsetParameter: null, defaultLimit: 20
  }, 100);
  assert.equal(metadata.canNavigate, false);
  assert.equal(metadata.hasNext, false);
  assert.equal(metadata.nextOffset, null);
});


test('CNES current API fields pass the facility allowlist without exposing contacts', () => {
  const result = sanitizePublicPayload({ profile: 'facilities' }, {
    estabelecimentos: [{
      codigo_cnes: 1234567,
      nome_fantasia: 'UNIDADE DE SAUDE DE TESTE',
      nome_razao_social: 'SECRETARIA MUNICIPAL DE SAUDE',
      codigo_tipo_unidade: 2,
      codigo_uf: 29,
      codigo_municipio: 292740,
      latitude_estabelecimento_decimo_grau: -12.9714,
      longitude_estabelecimento_decimo_grau: -38.5014,
      data_atualizacao: '2025-09-03',
      numero_telefone_estabelecimento: '(71)3000-0000',
      endereco_email_estabelecimento: 'privado@example.com',
      cpf: '00000000000'
    }]
  }, extract);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].codigo_cnes, 1234567);
  assert.equal(result.records[0].latitude_estabelecimento_decimo_grau, -12.9714);
  assert.equal('numero_telefone_estabelecimento' in result.records[0], false);
  assert.equal('endereco_email_estabelecimento' in result.records[0], false);
  assert.equal('cpf' in result.records[0], false);
});

test('CNES current coordinate property names produce real map points', () => {
  const points = toGeoPoints([{
    codigo_cnes: 1234567,
    nome_fantasia: 'UNIDADE DE SAUDE DE TESTE',
    codigo_tipo_unidade: 2,
    codigo_municipio: 292740,
    codigo_uf: 29,
    latitude_estabelecimento_decimo_grau: -12.9714,
    longitude_estabelecimento_decimo_grau: -38.5014
  }]);
  assert.equal(points.length, 1);
  assert.equal(points[0].id, '1234567');
  assert.equal(points[0].name, 'UNIDADE DE SAUDE DE TESTE');
  assert.equal(points[0].lat, -12.9714);
  assert.equal(points[0].lng, -38.5014);
  assert.equal(points[0].municipality, '292740');
  assert.equal(points[0].uf, '29');
});


test('CNES directory uses the current Swagger path and field names', () => {
  assert.equal(RESOURCES.cnesEstablishments.path, '/cnes/estabelecimentos');
  assert.equal(RESOURCES.cnesLookup.path, '/cnes/estabelecimentos/{codigo_cnes}');
  assert.equal(RESOURCES.tiposUnidade.path, '/cnes/tipounidades');
});

test('map conversion does not invent zero coordinates when one coordinate is absent', () => {
  const points = toGeoPoints([
    { codigo_cnes: 1, longitude_estabelecimento_decimo_grau: -38.5 },
    { codigo_cnes: 2, latitude_estabelecimento_decimo_grau: -12.9 },
    { codigo_cnes: 3, latitude_estabelecimento_decimo_grau: -12.9, longitude_estabelecimento_decimo_grau: -38.5 }
  ]);
  assert.equal(points.length, 1);
  assert.equal(points[0].id, '3');
});
