const RECORD_KEYS = [
  'data', 'dados', 'results', 'resultados', 'items', 'records', 'content', 'rows',
  'estabelecimentos', 'lista', 'srag_2019_2026', 'hits'
];

export function extractRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  if (Array.isArray(payload.hits?.hits)) return payload.hits.hits.map(hit => hit?._source || hit).filter(Boolean);
  if (Array.isArray(payload.hits)) return payload.hits.map(hit => hit?._source || hit).filter(Boolean);

  for (const key of RECORD_KEYS) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) return candidate.map(item => item?._source || item).filter(Boolean);
    if (candidate && typeof candidate === 'object') {
      const nested = extractRecords(candidate);
      if (nested.length) return nested;
    }
  }
  for (const value of Object.values(payload)) {
    if (Array.isArray(value) && value.length && typeof value[0] === 'object') return value.map(item => item?._source || item).filter(Boolean);
  }
  return [];
}
