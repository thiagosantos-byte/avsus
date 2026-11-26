import test from 'node:test';
import assert from 'node:assert/strict';
import { asFeatureCollection, IBGE_UFS, loadBrazilStateGeoJSON } from './ibge.js';

const feature = (code) => ({
  type: 'Feature',
  id: code,
  properties: { codarea: code },
  geometry: { type: 'Polygon', coordinates: [] }
});

test('asFeatureCollection normalizes Feature and FeatureCollection payloads', () => {
  assert.equal(asFeatureCollection(feature('29')).features.length, 1);
  assert.equal(asFeatureCollection({ type: 'FeatureCollection', features: [feature('29')] }).features.length, 1);
  assert.equal(asFeatureCollection({ message: '404' }).features.length, 0);
});

test('loads the national IBGE boundary with UF subdivisions in one request', async () => {
  let calls = 0;
  const data = { type: 'FeatureCollection', features: Array.from({ length: 27 }, (_, index) => feature(String(index))) };
  const result = await loadBrazilStateGeoJSON(async (url) => {
    calls += 1;
    assert.match(url, /paises\/BR\?intrarregiao=UF/);
    return { data };
  });
  assert.equal(calls, 1);
  assert.equal(result.features.length, 27);
  assert.equal(result.completeness, 'complete');
});

test('falls back to the documented state-id endpoint when the national malha fails', async () => {
  const requested = [];
  const result = await loadBrazilStateGeoJSON(async (url) => {
    requested.push(url);
    if (url.includes('/paises/BR?')) throw new Error('404');
    const stateId = url.match(/\/estados\/(\d{2})\?/)[1];
    return { data: feature(stateId) };
  });
  assert.equal(requested.length, IBGE_UFS.length + 1);
  assert.equal(result.features.length, 27);
  assert.equal(result.completeness, 'complete');
  assert.match(requested[1], /\/estados\/\d{2}\?/);
});
