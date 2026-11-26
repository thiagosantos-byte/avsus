import { useEffect, useMemo, useRef, useState } from 'react';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { AlertCircle, Map as MapIcon, Satellite, Layers3, Box, ExternalLink } from 'lucide-react';

const GOOGLE_KEY = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
const GOOGLE_MAP_ID = String(import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID').trim();
const BRAZIL_CENTER = { lat: -14.2, lng: -51.9 };
let googleLoaderPromise = null;

export const googleMapsConfigured = Boolean(GOOGLE_KEY);

export function loadGoogleMaps() {
  if (!GOOGLE_KEY) return Promise.reject(new Error('A chave VITE_GOOGLE_MAPS_API_KEY ainda não foi configurada.'));
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if (googleLoaderPromise) return googleLoaderPromise;

  googleLoaderPromise = new Promise((resolve, reject) => {
    const callbackName = '__healthDataGoogleMapsReady';
    const existing = document.querySelector('script[data-healthdata-google-maps]');
    const cleanup = () => {
      try { delete window[callbackName]; } catch { window[callbackName] = undefined; }
    };
    window[callbackName] = () => {
      cleanup();
      if (window.google?.maps?.importLibrary) resolve(window.google.maps);
      else reject(new Error('O Google Maps carregou sem disponibilizar a biblioteca JavaScript.'));
    };

    if (existing) {
      existing.addEventListener('error', () => {
        cleanup();
        googleLoaderPromise = null;
        reject(new Error('Não foi possível carregar o Google Maps. Verifique a chave e as restrições do domínio.'));
      }, { once: true });
      if (window.google?.maps?.importLibrary) window[callbackName]();
      return;
    }

    const script = document.createElement('script');
    script.dataset.healthdataGoogleMaps = 'true';
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_KEY)}&v=beta&loading=async&callback=${callbackName}&language=pt-BR&region=BR`;
    script.onerror = () => {
      cleanup();
      googleLoaderPromise = null;
      reject(new Error('Não foi possível carregar o Google Maps. Confira se a Maps JavaScript API está habilitada e se a chave permite este domínio.'));
    };
    document.head.appendChild(script);
  });

  return googleLoaderPromise;
}

function createFacilityInfo(point) {
  const wrapper = document.createElement('div');
  wrapper.className = 'google-map-info';
  const title = document.createElement('strong');
  title.textContent = point.name || 'Estabelecimento de saúde';
  const category = document.createElement('span');
  category.textContent = point.category || 'Categoria não informada';
  const locality = document.createElement('small');
  locality.textContent = `${point.city || 'Município não informado'}${point.uf ? ` · ${point.uf}` : ''}`;
  const code = document.createElement('small');
  code.textContent = `CNES: ${point.id}`;
  const link = document.createElement('a');
  link.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.lat},${point.lng}`)}`;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = 'Abrir no Google Maps';
  wrapper.append(title, category, locality, code, link);
  return wrapper;
}

function MapTypeControls({ mapType, onMapType, is3D, onToggle3D }) {
  return <div className="google-map-controls" aria-label="Controles de visualização do mapa">
    <div className="google-map-type-group" role="group" aria-label="Tipo de mapa">
      <button type="button" className={mapType === 'roadmap' ? 'active' : ''} onClick={() => onMapType('roadmap')}><MapIcon size={14} /> Mapa</button>
      <button type="button" className={mapType === 'satellite' ? 'active' : ''} onClick={() => onMapType('satellite')}><Satellite size={14} /> Satélite</button>
      <button type="button" className={mapType === 'hybrid' ? 'active' : ''} onClick={() => onMapType('hybrid')}><Layers3 size={14} /> Híbrido</button>
    </div>
    <button type="button" className={`google-map-3d-toggle ${is3D ? 'active' : ''}`} onClick={onToggle3D} aria-pressed={is3D}><Box size={14} /> {is3D ? 'Voltar ao 2D' : 'Explorar em 3D'}</button>
  </div>;
}

function GoogleMapLoading({ error }) {
  if (error) return <div className="google-map-status google-map-status-error" role="status"><AlertCircle size={18} /><div><strong>Google Maps indisponível</strong><span>{error}</span><small>O mapa alternativo continua disponível. Verifique a chave e a restrição de domínio no Google Cloud.</small></div></div>;
  return <div className="google-map-status" role="status"><span className="spinner-border spinner-border-sm" /> Carregando Google Maps…</div>;
}

export function GoogleMapsSetupNotice() {
  if (googleMapsConfigured) return null;
  return <div className="google-map-setup-note"><div><strong>Google Maps pronto para ativação</strong><span>O projeto não precisa de arquivo .env. Para ativar o mapa do Google, cadastre <code>VITE_GOOGLE_MAPS_API_KEY</code> nas variáveis de ambiente da Vercel e publique novamente. Até lá, o mapa alternativo permanece funcionando.</span></div><a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank" rel="noreferrer">Criar chave <ExternalLink size={13} /></a></div>;
}

export function GoogleFacilityMap({ points, selectedId, onSelectPoint, onViewChange, initialView, showDensity = false, fallback = null }) {
  const mapHostRef = useRef(null);
  const map3dHostRef = useRef(null);
  const mapRef = useRef(null);
  const infoWindowRef = useRef(null);
  const clustererRef = useRef(null);
  const markersRef = useRef([]);
  const markerByIdRef = useRef(new Map());
  const densityOverlaysRef = useRef([]);
  const map3dRef = useRef(null);
  const [status, setStatus] = useState(googleMapsConfigured ? 'loading' : 'missing-key');
  const [error, setError] = useState('');
  const [mapType, setMapType] = useState('hybrid');
  const [is3D, setIs3D] = useState(false);
  const pointsFor3D = useMemo(() => {
    if (points.length <= 250) return points;
    const step = (points.length - 1) / 249;
    return Array.from({ length: 250 }, (_, index) => points[Math.round(index * step)]);
  }, [points]);

  useEffect(() => {
    if (!googleMapsConfigured) return undefined;
    let cancelled = false;
    let idleListener = null;
    loadGoogleMaps().then(async maps => {
      const { Map, InfoWindow } = await maps.importLibrary('maps');
      if (cancelled || !mapHostRef.current) return;
      const map = new Map(mapHostRef.current, {
        center: Number.isFinite(Number(initialView?.center_lat)) && Number.isFinite(Number(initialView?.center_lng))
          ? { lat: Number(initialView.center_lat), lng: Number(initialView.center_lng) }
          : BRAZIL_CENTER,
        zoom: Number(initialView?.zoom) || 4,
        minZoom: 3,
        maxZoom: 20,
        mapId: GOOGLE_MAP_ID,
        mapTypeId: 'hybrid',
        mapTypeControl: false,
        streetViewControl: true,
        fullscreenControl: false,
        clickableIcons: false,
        gestureHandling: 'cooperative',
        keyboardShortcuts: true,
        zoomControl: true,
        scaleControl: true
      });
      mapRef.current = map;
      infoWindowRef.current = new InfoWindow();
      idleListener = map.addListener('idle', () => {
        const center = map.getCenter();
        if (!center) return;
        onViewChange?.({ center_lat: center.lat(), center_lng: center.lng(), zoom: map.getZoom() || 4 });
      });
      setStatus('ready');
    }).catch(loadError => {
      if (cancelled) return;
      setError(loadError.message || 'Falha ao iniciar o mapa.');
      setStatus('error');
    });

    return () => {
      cancelled = true;
      if (idleListener) window.google?.maps?.event?.removeListener(idleListener);
      clustererRef.current?.clearMarkers();
      clustererRef.current = null;
      markersRef.current = [];
      markerByIdRef.current.clear();
      densityOverlaysRef.current.forEach(overlay => overlay.setMap(null));
      densityOverlaysRef.current = [];
      map3dRef.current = null;
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return undefined;
    mapRef.current.setMapTypeId(mapType);
    return undefined;
  }, [mapType, status]);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current || !initialView) return;
    const lat = Number(initialView.center_lat);
    const lng = Number(initialView.center_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    mapRef.current.setCenter({ lat, lng });
    mapRef.current.setZoom(Math.max(3, Math.min(20, Number(initialView.zoom) || 4)));
  }, [initialView, status]);

  useEffect(() => {
    if (map3dRef.current) map3dRef.current.mode = mapType.toUpperCase();
  }, [mapType]);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const maps = window.google.maps;
        const { AdvancedMarkerElement, PinElement } = await maps.importLibrary('marker');
        if (cancelled || !mapRef.current) return;
        clustererRef.current?.clearMarkers();
        markersRef.current = [];
        markerByIdRef.current.clear();
        const map = mapRef.current;
        const markers = points.map(point => {
          const pin = new PinElement({ background: '#147b94', borderColor: '#ffffff', glyphColor: '#ffffff', scale: 0.92 });
          const marker = new AdvancedMarkerElement({
            position: { lat: point.lat, lng: point.lng },
            title: point.name,
            content: pin.element,
            gmpClickable: true
          });
          marker.addEventListener('gmp-click', () => {
            infoWindowRef.current?.setContent(createFacilityInfo(point));
            infoWindowRef.current?.open({ map, anchor: marker });
            onSelectPoint?.(String(point.id));
          });
          markerByIdRef.current.set(String(point.id), marker);
          return marker;
        });
        markersRef.current = markers;
        clustererRef.current = new MarkerClusterer({ map, markers });
        if (points.length && !initialView) {
          const bounds = new maps.LatLngBounds();
          points.forEach(point => bounds.extend({ lat: point.lat, lng: point.lng }));
          if (!bounds.isEmpty()) map.fitBounds(bounds, 46);
        }
      } catch (markerError) {
        if (!cancelled) {
          setError(markerError.message || 'Não foi possível renderizar os marcadores.');
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
      clustererRef.current?.clearMarkers();
      clustererRef.current = null;
      markersRef.current = [];
      markerByIdRef.current.clear();
    };
  }, [points, status, onSelectPoint]);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current || !selectedId) return;
    const marker = markerByIdRef.current.get(String(selectedId));
    if (!marker) return;
    mapRef.current.panTo(marker.position);
    mapRef.current.setZoom(Math.max(mapRef.current.getZoom() || 12, 14));
    infoWindowRef.current?.open({ map: mapRef.current, anchor: marker });
  }, [selectedId, status, points]);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return undefined;
    densityOverlaysRef.current.forEach(overlay => overlay.setMap(null));
    densityOverlaysRef.current = [];
    if (!showDensity || !points.length) return undefined;

    // A antiga HeatmapLayer do Google foi removida em 2026. Círculos
    // translúcidos preservam uma leitura de concentração sem usar API obsoleta.
    const stride = Math.max(1, Math.ceil(points.length / 450));
    const sample = points.filter((_, index) => index % stride === 0);
    const maps = window.google.maps;
    densityOverlaysRef.current = sample.map(point => new maps.Circle({
      map: mapRef.current,
      center: { lat: point.lat, lng: point.lng },
      radius: 1350,
      strokeOpacity: 0,
      strokeWeight: 0,
      fillColor: '#1593ad',
      fillOpacity: 0.105,
      clickable: false,
      zIndex: 1
    }));
    return () => {
      densityOverlaysRef.current.forEach(overlay => overlay.setMap(null));
      densityOverlaysRef.current = [];
    };
  }, [showDensity, points, status]);

  useEffect(() => {
    if (!is3D || status !== 'ready' || !map3dHostRef.current) return undefined;
    let cancelled = false;
    let element = null;
    (async () => {
      try {
        const { Map3DElement, Marker3DElement } = await window.google.maps.importLibrary('maps3d');
        if (cancelled || !map3dHostRef.current) return;
        const mapCenter = mapRef.current?.getCenter?.();
        const center = mapCenter
          ? { lat: mapCenter.lat(), lng: mapCenter.lng() }
          : pointsFor3D.length
            ? {
                lat: pointsFor3D.reduce((sum, point) => sum + point.lat, 0) / pointsFor3D.length,
                lng: pointsFor3D.reduce((sum, point) => sum + point.lng, 0) / pointsFor3D.length
              }
            : BRAZIL_CENTER;
        const zoom = mapRef.current?.getZoom?.() || 4;
        const range = Math.max(9000, Math.min(4500000, 56000000 / (2 ** zoom)));
        element = new Map3DElement({
          center: { ...center, altitude: 0 },
          mapId: GOOGLE_MAP_ID,
          range,
          tilt: 58,
          heading: 0,
          mode: mapType.toUpperCase(),
          qualityMode: 'PERFORMANCE',
          gestureHandling: 'AUTO',
          maxMemoryMegabytes: 256
        });
        element.style.width = '100%';
        element.style.height = '100%';
        element.setAttribute('aria-label', 'Mapa tridimensional por imagens de satélite do Google');
        pointsFor3D.forEach(point => {
          const marker = new Marker3DElement({
            position: { lat: point.lat, lng: point.lng, altitude: 18 },
            label: point.name,
            extruded: false
          });
          element.append(marker);
        });
        map3dRef.current = element;
        map3dHostRef.current.replaceChildren(element);
      } catch (map3dError) {
        if (!cancelled) {
          setError(map3dError.message || 'A visualização 3D não está disponível para esta chave ou navegador.');
          setIs3D(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      element?.remove();
      map3dRef.current = null;
      if (map3dHostRef.current) map3dHostRef.current.replaceChildren();
    };
  }, [is3D, status, pointsFor3D]);

  if (!googleMapsConfigured) return <>{fallback}</>;
  if (status === 'loading') return <GoogleMapLoading />;
  if (status === 'error') return <>{fallback}<div className="google-map-error-overlay"><GoogleMapLoading error={error} /></div></>;

  return <div className="google-map-shell">
    <MapTypeControls mapType={mapType} onMapType={setMapType} is3D={is3D} onToggle3D={() => setIs3D(value => !value)} />
    {error && <div className="google-map-inline-warning" role="status"><AlertCircle size={14} /> {error}</div>}
    <div ref={mapHostRef} className={`google-map-canvas ${is3D ? 'is-hidden' : ''}`} aria-label="Mapa interativo Google Maps" />
    <div ref={map3dHostRef} className={`google-map-canvas google-map-3d-canvas ${is3D ? '' : 'is-hidden'}`} aria-label="Mapa 3D do Google com imagens de satélite" />
    {is3D && <div className="google-map-3d-caption">Google Maps 3D · até {pointsFor3D.length} marcadores amostrados nesta vista. A cobertura de edifícios 3D varia por região.</div>}
  </div>;
}

function featureCode(feature, municipalities) {
  const raw = feature.getProperty('codarea')
    ?? feature.getProperty('CD_UF')
    ?? feature.getProperty('cd_uf')
    ?? feature.getId();
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return municipalities ? digits.slice(-7).padStart(7, '0') : digits.slice(-2).padStart(2, '0');
}

export function GoogleEpidemiologyMap({ geojson, municipalityGeojson, showMunicipalities, showIntensity, totals, municipalityTotals, indicatorLabel, fallback = null }) {
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const infoWindowRef = useRef(null);
  const dataLayerRef = useRef(null);
  const [status, setStatus] = useState(googleMapsConfigured ? 'loading' : 'missing-key');
  const [error, setError] = useState('');
  const [mapType, setMapType] = useState('hybrid');
  const activeGeojson = showMunicipalities ? municipalityGeojson : geojson;
  const activeTotals = showMunicipalities ? municipalityTotals : totals;

  useEffect(() => {
    if (!googleMapsConfigured) { setStatus('missing-key'); return undefined; }
    let cancelled = false;
    loadGoogleMaps().then(async maps => {
      const { Map, InfoWindow } = await maps.importLibrary('maps');
      if (cancelled || !hostRef.current) return;
      const map = new Map(hostRef.current, {
        center: BRAZIL_CENTER,
        zoom: 4,
        minZoom: 3,
        maxZoom: 16,
        mapId: GOOGLE_MAP_ID,
        mapTypeId: 'hybrid',
        mapTypeControl: false,
        streetViewControl: true,
        fullscreenControl: true,
        clickableIcons: false,
        gestureHandling: 'cooperative',
        zoomControl: true,
        scaleControl: true
      });
      mapRef.current = map;
      infoWindowRef.current = new InfoWindow();
      dataLayerRef.current = map.data;
      setStatus('ready');
    }).catch(loadError => {
      if (!cancelled) { setError(loadError.message); setStatus('error'); }
    });
    return () => {
      cancelled = true;
      if (dataLayerRef.current) {
        const existing = [];
        dataLayerRef.current.forEach(feature => existing.push(feature));
        existing.forEach(feature => dataLayerRef.current.remove(feature));
      }
      dataLayerRef.current = null;
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return;
    mapRef.current.setMapTypeId(mapType);
  }, [status, mapType]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = dataLayerRef.current;
    if (status !== 'ready' || !map || !layer) return;
    const previousFeatures = [];
    layer.forEach(feature => previousFeatures.push(feature));
    previousFeatures.forEach(feature => layer.remove(feature));
    if (!activeGeojson?.features?.length) return;
    try {
      layer.addGeoJson(activeGeojson);
      const max = Math.max(1, ...activeTotals.values());
      layer.setStyle(feature => {
        const code = featureCode(feature, showMunicipalities);
        const value = activeTotals.get(code) || 0;
        const intensity = value / max;
        return {
          fillColor: value ? '#13809a' : '#91aeb8',
          fillOpacity: showIntensity ? (value ? 0.24 + intensity * 0.58 : 0.055) : 0.12,
          strokeColor: '#ffffff',
          strokeOpacity: 0.92,
          strokeWeight: showMunicipalities ? 0.8 : 1.4,
          clickable: true,
          zIndex: value
        };
      });
      const bounds = new window.google.maps.LatLngBounds();
      layer.forEach(feature => feature.getGeometry()?.forEachLatLng(latLng => bounds.extend(latLng)));
      if (!bounds.isEmpty()) map.fitBounds(bounds, 30);
    } catch (geoError) {
      setError(geoError.message || 'Não foi possível desenhar a camada geográfica oficial.');
    }
  }, [activeGeojson, activeTotals, showMunicipalities, showIntensity, status]);

  useEffect(() => {
    const layer = dataLayerRef.current;
    const map = mapRef.current;
    if (status !== 'ready' || !layer || !map) return undefined;
    const listener = layer.addListener('click', event => {
      const code = featureCode(event.feature, showMunicipalities);
      const value = activeTotals.get(code) || 0;
      const name = event.feature.getProperty('nome')
        || event.feature.getProperty('name')
        || event.feature.getProperty('NM_UF')
        || `${showMunicipalities ? 'Município' : 'UF'} ${code || ''}`;
      const content = document.createElement('div');
      content.className = 'google-map-info';
      const title = document.createElement('strong'); title.textContent = name;
      const total = document.createElement('span');
      total.textContent = value ? `${value.toLocaleString('pt-BR')} ${String(indicatorLabel || 'registros').toLowerCase()}` : 'Sem registros disponíveis nesta consulta';
      const ibge = document.createElement('small'); ibge.textContent = `Código IBGE: ${code || 'não informado'}`;
      content.append(title, total, ibge);
      infoWindowRef.current?.setContent(content);
      infoWindowRef.current?.setPosition(event.latLng);
      infoWindowRef.current?.open({ map });
    });
    return () => window.google?.maps?.event?.removeListener(listener);
  }, [status, showMunicipalities, activeTotals, indicatorLabel]);

  if (!googleMapsConfigured) return <GoogleMapsSetupNotice />;
  if (status === 'loading') return <GoogleMapLoading />;
  if (status === 'error') return <>{fallback}<div className="google-map-error-overlay"><GoogleMapLoading error={error} /></div></>;

  return <div className="google-map-shell google-epidemiology-shell">
    <div className="google-map-controls" aria-label="Tipo de mapa">
      <div className="google-map-type-group" role="group" aria-label="Tipo de mapa">
        <button type="button" className={mapType === 'roadmap' ? 'active' : ''} onClick={() => setMapType('roadmap')}><MapIcon size={14} /> Mapa</button>
        <button type="button" className={mapType === 'satellite' ? 'active' : ''} onClick={() => setMapType('satellite')}><Satellite size={14} /> Satélite</button>
        <button type="button" className={mapType === 'hybrid' ? 'active' : ''} onClick={() => setMapType('hybrid')}><Layers3 size={14} /> Híbrido</button>
      </div>
    </div>
    {error && <div className="google-map-inline-warning" role="status"><AlertCircle size={14} /> {error}</div>}
    <div ref={hostRef} className="google-map-canvas" aria-label="Mapa epidemiológico interativo do Google" />
    {!activeGeojson?.features?.length && <div className="google-map-data-note">O mapa base está disponível. As áreas coloridas serão exibidas quando a camada territorial do IBGE estiver disponível.</div>}
  </div>;
}
