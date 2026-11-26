export function describedMaximum(parameter) {
  const explicit = parameter.maximum ?? parameter.schema?.maximum;
  if (explicit !== undefined && explicit !== null) return Number(explicit);
  const description = String(parameter.description || '');
  const patterns = [
    /menor\s+ou\s+igual(?:\s+a)?\s*(\d+)/i,
    /(?:máximo|maxima|máxima|limite máximo)\s*(?:de|é|igual a)?\s*(\d+)/i,
    /até\s+(\d+)\s+(?:registros|itens|resultados)/i
  ];
  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

export function buildPageMetadata(sourcePageCount, params, paging, totalRecordsReported) {
  if (!paging) return null;
  const limit = Number(params.get(paging.limitParameter || 'limit') || paging.defaultLimit || 100);
  const canNavigate = Boolean(paging.offsetParameter);
  const offset = canNavigate ? Number(params.get(paging.offsetParameter) || 0) : 0;
  const hasNext = canNavigate && (totalRecordsReported !== null && totalRecordsReported !== undefined
    ? (offset + 1) * limit < totalRecordsReported
    : sourcePageCount >= limit);
  return {
    limit, offset, page: offset + 1, totalRecordsReported: totalRecordsReported ?? null,
    canNavigate,
    hasPrevious: canNavigate && offset > 0, hasNext,
    previousOffset: canNavigate ? Math.max(0, offset - 1) : null,
    nextOffset: hasNext ? offset + 1 : null,
    offsetParameter: paging.offsetParameter || null,
    offsetSemantics: canNavigate ? 'Índice da página iniciado em zero, conforme a descrição do Swagger.' : 'A operação não documenta parâmetro de deslocamento/página.'
  };
}
