/** Gera CSV consistente (metadados como colunas) e neutraliza fórmulas de planilha. */
export function buildSafeCsv(rows, metadata = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const columns = [...new Set(rows.flatMap(row => Object.keys(row || {})))];
  const context = Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined && value !== '');
  const csvCell = value => {
    const raw = String(value ?? '');
    const safe = /^[\t\r ]*[=+@-]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const header = [...context.map(([key]) => key), ...columns];
  const body = rows.map(row => [
    ...context.map(([, value]) => value),
    ...columns.map(key => row?.[key])
  ]);
  return [header.map(csvCell).join(';'), ...body.map(line => line.map(csvCell).join(';'))].join('\r\n');
}
