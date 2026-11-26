import test from 'node:test';
import assert from 'node:assert/strict';
import { validateParameter, normalizeSavedFilters } from './validation.js';

test('date filter accepts only a real ISO date', () => {
  assert.equal(validateParameter('2026-01-05', { name: 'data_atualizacao', type: 'string', description: 'Formato: YYYY-MM-DD' }), '2026-01-05');
  assert.throws(
    () => validateParameter('20260105', { name: 'data_atualizacao', type: 'string', description: 'Formato: YYYY-MM-DD' }),
    error => error.code === 'INVALID_DATE' && /AAAA-MM-DD/.test(error.message)
  );
  assert.throws(
    () => validateParameter('2026-02-30', { name: 'data_atualizacao', type: 'string' }),
    error => error.code === 'INVALID_DATE'
  );
});

test('saved dates in compact YYYYMMDD format are normalized for date controls', () => {
  assert.deepEqual(normalizeSavedFilters({ data_atualizacao: '20260105', status: '1' }), {
    data_atualizacao: '2026-01-05', status: '1'
  });
});

test('numeric and enum filters are validated before reaching the official API', () => {
  assert.equal(validateParameter('1', { name: 'status', type: 'integer', enum: [0, 1], minimum: 0, maximum: 1 }), '1');
  assert.throws(() => validateParameter('2', { name: 'status', type: 'integer', enum: [0, 1] }), /opção inválida/);
  assert.throws(() => validateParameter('vinte', { name: 'limit', type: 'integer' }), /números inteiros/);
});
