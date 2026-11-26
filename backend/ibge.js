const IBGE_BASE = 'https://servicodados.ibge.gov.br/api/v3/malhas';

export const IBGE_UFS = [
  { id: '11', sigla: 'RO' }, { id: '12', sigla: 'AC' }, { id: '13', sigla: 'AM' },
  { id: '14', sigla: 'RR' }, { id: '15', sigla: 'PA' }, { id: '16', sigla: 'AP' },
  { id: '17', sigla: 'TO' }, { id: '21', sigla: 'MA' }, { id: '22', sigla: 'PI' },
  { id: '23', sigla: 'CE' }, { id: '24', sigla: 'RN' }, { id: '25', sigla: 'PB' },
  { id: '26', sigla: 'PE' }, { id: '27', sigla: 'AL' }, { id: '28', sigla: 'SE' },
  { id: '29', sigla: 'BA' }, { id: '31', sigla: 'MG' }, { id: '32', sigla: 'ES' },
  { id: '33', sigla: 'RJ' }, { id: '35', sigla: 'SP' }, { id: '41', sigla: 'PR' },
  { id: '42', sigla: 'SC' }, { id: '43', sigla: 'RS' }, { id: '50', sigla: 'MS' },
  { id: '51', sigla: 'MT' }, { id: '52', sigla: 'GO' }, { id: '53', sigla: 'DF' }
];

export function asFeatureCollection(data) {
  if (data?.type === 'FeatureCollection' && Array.isArray(data.features)) {
    return { type: 'FeatureCollection', features: data.features };
  }
  if (data?.type === 'Feature') {
    return { type: 'FeatureCollection', features: [data] };
  }
  return { type: 'FeatureCollection', features: [] };
}

/**
 * A rota /malhas/estados exige um identificador; chamar apenas /estados
 * devolve 404. Primeiro tentamos a malha nacional com divisão por UF. Se o
 * serviço não retornar as 27 unidades, buscamos cada UF por seu código IBGE.
 */
export async function loadBrazilStateGeoJSON(get) {
  const nationalUrl = `${IBGE_BASE}/paises/BR?intrarregiao=UF&formato=application/vnd.geo+json&qualidade=minima`;
  try {
    const response = await get(nationalUrl, {
      timeout: 15000,
      headers: { Accept: 'application/geo+json, application/json' },
      maxContentLength: 12 * 1024 * 1024
    });
    const collection = asFeatureCollection(response?.data);
    if (collection.features.length >= 20) {
      return {
        ...collection,
        source: 'IBGE — Malhas territoriais',
        geography: 'Unidades da Federação',
        completeness: collection.features.length >= 27 ? 'complete' : 'partial'
      };
    }
  } catch {
    // O endpoint nacional pode estar indisponível em certos momentos. Usa-se
    // abaixo a rota oficial documentada por UF, sem abandonar o mapa.
  }

  const features = [];
  const missingStates = [];
  let cursor = 0;
  const workers = Array.from({ length: 6 }, async () => {
    while (cursor < IBGE_UFS.length) {
      const state = IBGE_UFS[cursor++];
      const url = `${IBGE_BASE}/estados/${state.id}?formato=application/vnd.geo+json&qualidade=minima`;
      try {
        const response = await get(url, {
          timeout: 12000,
          headers: { Accept: 'application/geo+json, application/json' },
          maxContentLength: 2 * 1024 * 1024
        });
        const collection = asFeatureCollection(response?.data);
        if (collection.features.length) {
          for (const feature of collection.features) {
            const properties = { ...(feature.properties || {}) };
            if (!properties.codarea && !properties.CD_UF && !properties.cd_uf) properties.codarea = state.id;
            if (!properties.nome && !properties.name && !properties.NM_UF) properties.nome = state.sigla;
            features.push({ ...feature, properties });
          }
        } else {
          missingStates.push(state.sigla);
        }
      } catch {
        missingStates.push(state.sigla);
      }
    }
  });
  await Promise.all(workers);

  if (features.length < 20) {
    throw Object.assign(new Error('O serviço cartográfico do IBGE não retornou malhas suficientes para montar o mapa das Unidades da Federação.'), {
      status: 502,
      upstreamStatus: 502,
      code: 'IBGE_GEO_UNAVAILABLE'
    });
  }

  return {
    type: 'FeatureCollection',
    features,
    source: 'IBGE — API de Malhas Geográficas',
    geography: 'Unidades da Federação',
    completeness: missingStates.length ? 'partial' : 'complete',
    missingStates
  };
}
