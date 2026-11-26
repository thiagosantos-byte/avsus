/** Classifica uma resposta HTTP sem inferir disponibilidade a partir de erros. */
export function classifyApiHttpStatus(status) {
  if (Number.isInteger(status) && status >= 200 && status < 300) return 'online';
  if (status === 401 || status === 403) return 'restricted';
  if (status === 429) return 'limited';
  return 'unavailable';
}
