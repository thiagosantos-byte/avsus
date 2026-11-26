const entries = new Map();
const MAX_ENTRIES = 500;

export function cacheGet(key) {
  const entry = entries.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { entries.delete(key); return null; }
  return entry.value;
}

export function cacheSet(key, value, ttlSeconds = 600) {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return;
  if (entries.has(key)) entries.delete(key);
  while (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value);
  entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export function cacheStats() {
  let active = 0;
  for (const [key, entry] of entries) {
    if (Date.now() > entry.expiresAt) entries.delete(key);
    else active += 1;
  }
  return { activeEntries: active, maxEntries: MAX_ENTRIES };
}
