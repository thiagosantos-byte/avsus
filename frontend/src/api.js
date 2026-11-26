const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

async function request(path, options = {}) {
  const timeoutSignal = AbortSignal.timeout(45000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
    signal
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Erro HTTP ${response.status}`);
    error.status = response.status;
    error.detail = body.detail;
    error.accessStatus = body.accessStatus;
    error.upstreamStatus = body.upstreamStatus;
    error.supportedParameters = body.supportedParameters;
    error.code = body.code || 'REQUEST_FAILED';
    error.hint = body.hint;
    throw error;
  }
  return body;
}

export const getHealth = () => request('/health');
export const getSources = () => request('/sources');
export const getSourceStatus = () => request('/sources/status');
export const getResourceSchema = id => request(`/sources/${encodeURIComponent(id)}/schema`);
export const getResourceData = (id, params = {}, options = {}) => {
  const search = new URLSearchParams(params);
  return request(`/data/${encodeURIComponent(id)}${search.size ? `?${search.toString()}` : ''}`, options);
};
export const getGeoStates = () => request('/geo/estados');
export const getGeoMunicipalities = codes => request(`/geo/municipios?codigos=${encodeURIComponent(codes.join(','))}`);
