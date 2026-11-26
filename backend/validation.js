const DATE_PARAM_NAMES = new Set(['data_atualizacao', 'dataCompraInicio', 'dataCompraFim', 'dataInsercaoInicio', 'dataInsercaoFim']);

function makeValidationError(message, code = 'INVALID_QUERY_PARAMETER') {
  return Object.assign(new Error(message), {
    status: 400,
    code,
    publicMessage: message
  });
}

function isRealIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateParameter(value, parameter) {
  const clean = String(value).trim();
  if (!clean) return clean;

  const dateParameter = parameter.format === 'date'
    || DATE_PARAM_NAMES.has(parameter.name)
    || /YYYY-MM-DD/i.test(String(parameter.description || ''));
  if (dateParameter && !isRealIsoDate(clean)) {
    throw makeValidationError(
      `O campo ${parameter.name} precisa de uma data válida no formato AAAA-MM-DD. Exemplo: 2026-01-05.`,
      'INVALID_DATE'
    );
  }

  if (parameter.enum && !parameter.enum.map(String).includes(clean)) {
    throw makeValidationError(`O filtro ${parameter.name} possui uma opção inválida. Selecione um dos valores disponíveis.`);
  }
  if (parameter.type === 'integer' && !/^-?\d+$/.test(clean)) {
    throw makeValidationError(`O campo ${parameter.name} aceita apenas números inteiros.`);
  }
  if (parameter.type === 'number' && !Number.isFinite(Number(clean))) {
    throw makeValidationError(`O campo ${parameter.name} precisa ser numérico.`);
  }
  if (['integer', 'number'].includes(parameter.type)) {
    const numeric = Number(clean);
    if (parameter.minimum !== null && parameter.minimum !== undefined && numeric < Number(parameter.minimum)) {
      throw makeValidationError(`O valor de ${parameter.name} deve ser igual ou maior que ${parameter.minimum}.`);
    }
    if (parameter.maximum !== null && parameter.maximum !== undefined && numeric > Number(parameter.maximum)) {
      throw makeValidationError(`O valor de ${parameter.name} deve ser igual ou menor que ${parameter.maximum}.`);
    }
    if (parameter.name === 'limit' && numeric < 1) {
      throw makeValidationError('A quantidade por consulta deve ser maior que zero.');
    }
    if (parameter.name === 'offset' && numeric < 0) {
      throw makeValidationError('A página informada não pode ser negativa.');
    }
  }
  return clean;
}

export function normalizeSavedFilters(filters = {}) {
  const normalized = { ...filters };
  for (const name of DATE_PARAM_NAMES) {
    const value = normalized[name];
    if (typeof value === 'string' && /^\d{8}$/.test(value)) {
      normalized[name] = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    }
  }
  return normalized;
}
