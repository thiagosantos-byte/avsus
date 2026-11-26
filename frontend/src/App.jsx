import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, AlertCircle, ArrowDownToLine, ArrowRight, BarChart3, Bell, BookOpen,
  Building2, CalendarDays, CheckCircle2, ChevronDown, CircleHelp, ClipboardList,
  Database, Download, ExternalLink, Filter, Globe2, HeartPulse, Home, Layers3,
  LocateFixed, LogIn, LogOut, Map as MapIcon, MapPinned, Menu, Moon, RefreshCw,
  Search, Settings2, ShieldCheck, SlidersHorizontal, Stethoscope, Sun, Syringe,
  Users, X
} from 'lucide-react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import { GoogleFacilityMap, GoogleEpidemiologyMap, GoogleMapsSetupNotice, googleMapsConfigured } from './GoogleMaps.jsx';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.heat';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  BarChart, Bar, Legend, AreaChart, Area, PieChart as RechartsPieChart, Pie, Cell
} from 'recharts';
import {
  getResourceData, getResourceSchema, getSources, getSourceStatus, getHealth,
  getGeoStates, getGeoMunicipalities
} from './api';
import { supabase, authReady } from './supabase';
import { buildSafeCsv } from '../../shared/csv.js';

const navItems = [
  { to: '/', label: 'Visão geral', icon: Home, end: true },
  { to: '/mapa', label: 'Mapa interativo', icon: MapIcon },
  { to: '/rede', label: 'Rede de saúde', icon: Building2 },
  { to: '/epidemiologia', label: 'Epidemiologia', icon: Activity },
  { to: '/vacinacao', label: 'Vacinação', icon: Syringe },
  { to: '/analises', label: 'Infográfico', icon: BarChart3 },
  { to: '/fontes', label: 'Fontes e metodologia', icon: Database },
  { to: '/salvos', label: 'Consultas salvas', icon: HeartPulse }
];

function formatDate(value) {
  if (!value) return 'Não informada';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('pt-BR');
}
function formatNumber(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}
function recordsFrom(result) {
  return Array.isArray(result?.records) ? result.records : [];
}
function getField(row, candidates) {
  if (!row || typeof row !== 'object') return undefined;
  const entries = Object.entries(row);
  for (const wanted of candidates) {
    const exact = row[wanted];
    if (exact !== undefined && exact !== null && exact !== '') return exact;
    const found = entries.find(([key]) => key.toLowerCase() === wanted.toLowerCase());
    if (found && found[1] !== undefined && found[1] !== null && found[1] !== '') return found[1];
  }
  return undefined;
}
function numericCoordinate(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}
function facilityPoint(row, index) {
  const lat = numericCoordinate(getField(row, ['latitude', 'lat', 'nu_latitude', 'co_latitude', 'vl_latitude', 'lat_estabelecimento', 'latitude_estabelecimento_decimo_grau']));
  const lng = numericCoordinate(getField(row, ['longitude', 'lng', 'lon', 'nu_longitude', 'co_longitude', 'vl_longitude', 'long_estabelecimento', 'longitude_estabelecimento_decimo_grau']));
  if (lat === null || lng === null || lat < -34 || lat > 6 || lng < -75 || lng > -32) return null;
  return {
    id: String(getField(row, ['codigo_cnes', 'codigo_estabelecimento_saude', 'cnes', 'co_cnes', 'nu_cnes', 'id']) ?? index),
    name: String(getField(row, ['nome_fantasia', 'nome_razao_social', 'nome_estabelecimento', 'no_fantasia', 'nome', 'ds_nome']) ?? 'Estabelecimento sem nome informado'),
    category: String(getField(row, ['tipo_unidade', 'ds_tipo_unidade', 'descricao_tipo_unidade', 'codigo_tipo_unidade', 'categoria']) ?? 'Estabelecimento de saúde'),
    city: String(getField(row, ['municipio', 'no_municipio', 'nome_municipio', 'codigo_municipio', 'cidade']) ?? 'Município não informado'),
    uf: String(getField(row, ['uf', 'sg_uf', 'codigo_uf', 'estado']) ?? ''),
    lat, lng, raw: row
  };
}
function downloadCsv(rows, name = 'healthdata-consulta.csv', metadata = {}) {
  if (!rows.length) return;
  const blob = new Blob(['\ufeff', buildSafeCsv(rows, metadata)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}


const RESOURCE_SECTIONS = {
  map: ['cnesEstablishments', 'ubs', 'hospitalsBeds'],
  network: ['ubs', 'cnesEstablishments', 'hospitalsBeds', 'cnesBeds', 'cnesEquipment'],
  epidemiology: ['dengue', 'zika', 'chikungunya'],
  vaccination: ['vaccination2025', 'vaccination2026']
};

const SYSTEM_PARAMETERS = new Set(['limit', 'offset', 'campos']);
const BASIC_FILTER_ORDER = {
  cnesEstablishments: ['codigo_uf', 'status'],
  ubs: [],
  hospitalsBeds: ['uf'],
  cnesBeds: ['co_ibge', 'nu_comp'],
  cnesEquipment: ['co_ibge', 'nu_comp'],
  // O código municipal é um filtro avançado: na consulta inicial, priorizamos
  // uma página mais ampla para evitar suprimir todos os grupos pequenos.
  dengue: ['nu_ano'],
  zika: ['nu_ano'],
  chikungunya: ['nu_ano'],
  vaccination2025: ['uf_estabelecimento', 'uf_paciente'],
  vaccination2026: []
};

const PARAMETER_LABELS = {
  codigo_uf: 'Estado', status: 'Situação do estabelecimento',
  codigo_municipio: 'Código IBGE do município', codigo_tipo_unidade: 'Tipo de unidade (código)',
  estabelecimento_possui_centro_cirurgico: 'Possui centro cirúrgico?',
  estabelecimento_possui_centro_obstetrico: 'Possui centro obstétrico?',
  data_atualizacao: 'Atualizado a partir de', uf: 'Estado',
  uf_estabelecimento: 'UF do estabelecimento', uf_paciente: 'UF do paciente',
  nu_ano: 'Ano de referência', id_municip: 'Código IBGE do município',
  co_ibge: 'Código IBGE do município', nu_comp: 'Competência (AAAA-MM)',
  co_cnes: 'Código CNES do estabelecimento'
};

const UF_NAMES_BY_CODE = {
  '11': 'Rondônia', '12': 'Acre', '13': 'Amazonas', '14': 'Roraima', '15': 'Pará', '16': 'Amapá', '17': 'Tocantins',
  '21': 'Maranhão', '22': 'Piauí', '23': 'Ceará', '24': 'Rio Grande do Norte', '25': 'Paraíba', '26': 'Pernambuco', '27': 'Alagoas',
  '28': 'Sergipe', '29': 'Bahia', '31': 'Minas Gerais', '32': 'Espírito Santo', '33': 'Rio de Janeiro', '35': 'São Paulo',
  '41': 'Paraná', '42': 'Santa Catarina', '43': 'Rio Grande do Sul', '50': 'Mato Grosso do Sul', '51': 'Mato Grosso',
  '52': 'Goiás', '53': 'Distrito Federal'
};
const UF_NAMES_BY_ABBR = {
  RO: 'Rondônia', AC: 'Acre', AM: 'Amazonas', RR: 'Roraima', PA: 'Pará', AP: 'Amapá', TO: 'Tocantins',
  MA: 'Maranhão', PI: 'Piauí', CE: 'Ceará', RN: 'Rio Grande do Norte', PB: 'Paraíba', PE: 'Pernambuco', AL: 'Alagoas',
  SE: 'Sergipe', BA: 'Bahia', MG: 'Minas Gerais', ES: 'Espírito Santo', RJ: 'Rio de Janeiro', SP: 'São Paulo',
  PR: 'Paraná', SC: 'Santa Catarina', RS: 'Rio Grande do Sul', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', GO: 'Goiás', DF: 'Distrito Federal'
};
function stateDisplayName(value) {
  const raw = String(value ?? '').trim().toUpperCase();
  const digits = raw.replace(/\D/g, '');
  const code = digits ? digits.slice(-2).padStart(2, '0') : null;
  const abbreviation = UF_OPTIONS.find(([ufCode]) => ufCode === code)?.[1] || raw;
  const name = (code && UF_NAMES_BY_CODE[code]) || UF_NAMES_BY_ABBR[raw];
  return name ? `${name} (${abbreviation})` : String(value ?? 'UF não identificada');
}

const UF_OPTIONS = [
  ['12', 'AC'], ['27', 'AL'], ['13', 'AM'], ['16', 'AP'], ['29', 'BA'], ['23', 'CE'],
  ['53', 'DF'], ['32', 'ES'], ['52', 'GO'], ['21', 'MA'], ['31', 'MG'], ['50', 'MS'],
  ['51', 'MT'], ['15', 'PA'], ['25', 'PB'], ['26', 'PE'], ['22', 'PI'], ['41', 'PR'],
  ['33', 'RJ'], ['24', 'RN'], ['11', 'RO'], ['14', 'RR'], ['43', 'RS'], ['42', 'SC'],
  ['28', 'SE'], ['35', 'SP'], ['17', 'TO']
];

function isDateParameter(parameter) {
  return parameter.format === 'date'
    || parameter.name === 'data_atualizacao'
    || /YYYY-MM-DD/i.test(String(parameter.description || ''));
}

function parameterLabel(parameter) {
  return PARAMETER_LABELS[parameter.name] || parameter.description || parameter.name;
}

function splitQueryFields(resource, schema) {
  const queryFields = (schema?.parameters || []).filter(parameter =>
    parameter.in === 'query' && !SYSTEM_PARAMETERS.has(parameter.name)
  );
  const preferred = BASIC_FILTER_ORDER[resource] || queryFields.slice(0, 2).map(parameter => parameter.name);
  const byName = new Map(queryFields.map(parameter => [parameter.name, parameter]));
  const basic = preferred.map(name => byName.get(name)).filter(Boolean);
  const basicNames = new Set(basic.map(parameter => parameter.name));
  const advanced = queryFields.filter(parameter => !basicNames.has(parameter.name));
  return { basic, advanced };
}

function displaySavedFilters(filters = {}) {
  const next = { ...filters };
  if (typeof next.data_atualizacao === 'string' && /^\d{8}$/.test(next.data_atualizacao)) {
    next.data_atualizacao = `${next.data_atualizacao.slice(0, 4)}-${next.data_atualizacao.slice(4, 6)}-${next.data_atualizacao.slice(6, 8)}`;
  }
  return next;
}

function validateVisibleFilters(params, schema) {
  const dateField = (schema?.parameters || []).find(parameter => isDateParameter(parameter) && params[parameter.name]);
  if (dateField) {
    const value = String(params[dateField.name]);
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
    if (!match || date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
      return `A data precisa estar no formato AAAA-MM-DD. Exemplo: 2026-01-05.`;
    }
  }
  return '';
}

function QueryField({ parameter, value, onChange }) {
  const label = parameterLabel(parameter);
  const id = `param-${parameter.name}`;
  const isUfCode = parameter.name === 'codigo_uf';
  const isUfAcronym = ['uf', 'uf_estabelecimento', 'uf_paciente', 'sg_uf'].includes(parameter.name);
  const enumValue = parameter.enum?.map(String) || null;
  const enumLabels = parameter.name === 'status'
    ? { '0': 'Inativo', '1': 'Ativo' }
    : ['estabelecimento_possui_centro_cirurgico', 'estabelecimento_possui_centro_obstetrico'].includes(parameter.name)
      ? { '0': 'Não', '1': 'Sim' } : {};
  const options = isUfCode
    ? UF_OPTIONS.map(([code, sigla]) => [code, `${sigla} (${code})`])
    : isUfAcronym ? UF_OPTIONS.map(([, sigla]) => [sigla, sigla])
      : enumValue?.map(item => [item, enumLabels[item] || item]);
  const inputType = isDateParameter(parameter) ? 'date'
    : ['integer', 'number'].includes(parameter.type) ? 'number' : 'text';
  return <div className="field-wrap" key={`${parameter.in}-${parameter.name}`}>
    <label htmlFor={id}>{label}{parameter.required ? ' *' : ''}</label>
    {options ? <select id={id} className="form-select" value={value || ''} onChange={event => onChange(parameter.name, event.target.value)}>
      <option value="">Todos</option>
      {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
    </select> : <input
      id={id}
      className="form-control"
      type={inputType}
      inputMode={inputType === 'number' ? 'numeric' : undefined}
      min={parameter.minimum ?? undefined}
      max={parameter.maximum ?? undefined}
      step={parameter.type === 'integer' ? '1' : parameter.type === 'number' ? 'any' : undefined}
      placeholder={inputType === 'date' ? 'AAAA-MM-DD' : parameter.name === 'id_municip' || parameter.name === 'codigo_municipio' || parameter.name === 'co_ibge' ? 'Ex.: 2927408' : 'Digite para filtrar'}
      value={value || ''}
      onChange={event => onChange(parameter.name, event.target.value)}
    />}
    {parameter.name === 'codigo_municipio' || parameter.name === 'id_municip' || parameter.name === 'co_ibge'
      ? <small className="field-hint">Use o código IBGE do município. Este filtro é opcional.</small> : null}
    {isDateParameter(parameter) ? <small className="field-hint">A data é escolhida no calendário e enviada no formato exigido pela fonte oficial.</small> : null}
  </div>;
}

function useAuth() {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
      setUser(data.session?.user || null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next || null);
      setUser(next?.user || null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);
  return { user, session };
}

function App() {
  const { user } = useAuth();
  const [theme, setTheme] = useState(() => localStorage.getItem('healthdata-theme') || 'light');
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('healthdata-theme', theme);
  }, [theme]);
  useEffect(() => {
    let active = true;
    if (!user || !supabase) { setPreferencesLoaded(false); return () => { active = false; }; }
    setPreferencesLoaded(false);
    supabase.from('user_preferences').select('theme').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { if (active && data?.theme) setTheme(data.theme); })
      .finally(() => { if (active) setPreferencesLoaded(true); });
    return () => { active = false; };
  }, [user?.id]);
  useEffect(() => {
    if (!user || !supabase || !preferencesLoaded) return;
    supabase.from('user_preferences').upsert({
      user_id: user.id, theme, updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
  }, [theme, user?.id, preferencesLoaded]);
  useEffect(() => setMobileNav(false), [location.pathname]);

  const toggleTheme = () => setTheme(value => value === 'light' ? 'dark' : 'light');
  return (
    <div className="app-shell">
      <main className="main-area">
        <header className={`topbar ${mobileNav ? 'topbar-menu-open' : ''}`}>
          <div className="topbar-inner">
            <div className="topbar-brand-group">
              <Link to="/" className="brand-lockup" aria-label="HealthData Brasil — início">
                <span className="brand-emblem"><img src="/healthdata-logo-mark.webp" alt="" /></span>
                <span><strong>HealthData <em>Brasil</em></strong><small>DADOS PÚBLICOS · SAÚDE</small></span>
              </Link>
              <span className="breadcrumb" aria-live="polite">
                <span className="breadcrumb-separator">/</span>
                <b>{navItems.find(item => item.to === location.pathname)?.label || 'Plataforma'}</b>
              </span>
            </div>

            <button
              className="icon-button mobile-menu"
              type="button"
              onClick={() => setMobileNav(value => !value)}
              aria-label={mobileNav ? 'Recolher navegação' : 'Abrir navegação'}
              aria-expanded={mobileNav}
              aria-controls="primary-navigation"
            >
              {mobileNav ? <X size={19} /> : <Menu size={19} />}
            </button>

            <nav id="primary-navigation" className={`main-nav ${mobileNav ? 'main-nav-open' : ''}`} aria-label="Navegação principal">
              {navItems.map(item => {
                const Icon = item.icon;
                return <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMobileNav(false)}
                  className={({ isActive }) => `nav-link-item ${isActive ? 'active' : ''}`}
                >
                  <Icon size={16} strokeWidth={1.85} />
                  <span>{item.label}</span>
                  {item.to === '/mapa' && <span className="nav-dot" aria-hidden="true" />}
                </NavLink>;
              })}
            </nav>

            <div className="topbar-actions">
              <span className="topbar-env"><span className="env-dot" /> DADOS OFICIAIS</span>
              <button className="icon-button" type="button" onClick={toggleTheme} title={theme === 'light' ? 'Ativar modo escuro' : 'Ativar modo claro'} aria-label="Alternar tema">
                {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
              </button>
              <button className="profile-button" type="button" onClick={() => setAuthOpen(true)}>
                <span className="profile-avatar">{user?.email?.slice(0, 1).toUpperCase() || <Users size={16} />}</span>
                <span className="profile-label">{user ? user.email.split('@')[0] : 'Acessar conta'}</span>
                <ChevronDown size={14} />
              </button>
            </div>
          </div>
        </header>
        <div className="page-content">
          <Routes>
            <Route path="/" element={<DashboardPage onOpenAuth={() => setAuthOpen(true)} />} />
            <Route path="/mapa" element={<MapPage user={user} onOpenAuth={() => setAuthOpen(true)} />} />
            <Route path="/rede" element={<NetworkPage user={user} onOpenAuth={() => setAuthOpen(true)} />} />
            <Route path="/epidemiologia" element={<EpidemiologyPage user={user} onOpenAuth={() => setAuthOpen(true)} />} />
            <Route path="/vacinacao" element={<VaccinationPage user={user} onOpenAuth={() => setAuthOpen(true)} />} />
            <Route path="/analises" element={<AnalyticsPage />} />
            <Route path="/fontes" element={<SourcesPage />} />
            <Route path="/salvos" element={<SavedQueriesPage user={user} onOpenAuth={() => setAuthOpen(true)} />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
        <footer className="global-footer"><span>© {new Date().getFullYear()} HealthData Brasil</span><span>Dados públicos · Transparência · LGPD</span><a href="https://dadosabertos.saude.gov.br/" target="_blank" rel="noreferrer">Portal de Dados Abertos do SUS <ExternalLink size={12} /></a></footer>
      </main>
      {authOpen && <AuthDialog user={user} onClose={() => setAuthOpen(false)} />}
    </div>
  );
}

function PageHeading({ eyebrow, title, description, right }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{right && <div className="heading-right">{right}</div>}</div>;
}
function StatusPill({ status }) {
  const labels = { online: 'Disponível', ok: 'Operacional', cached: 'Em cache', cached_stale: 'Cache desatualizado', restricted: 'Acesso restrito', limited: 'Limitada', unavailable: 'Indisponível', unverified: 'Não verificada' };
  const tone = status === 'online' || status === 'ok' ? 'status-online' : status === 'restricted' || status === 'limited' ? 'status-warning' : 'status-muted';
  return <span className={`status-pill ${tone}`}><span />{labels[status] || 'Verificar fonte'}</span>;
}
function Loading({ label = 'Consultando fonte oficial…' }) {
  return <div className="loading-state"><span className="spinner-border spinner-border-sm" role="status" /><span>{label}</span></div>;
}
function ErrorPanel({ error, onRetry }) {
  const message = error?.message || 'A fonte oficial não respondeu à consulta.';
  const help = error?.code === 'INVALID_DATE' || error?.code === 'INVALID_QUERY_PARAMETER' || error?.code === 'UPSTREAM_INVALID_FILTER'
    ? 'Revise os filtros selecionados. Datas devem seguir o padrão AAAA-MM-DD; os campos avançados podem ficar vazios.'
    : error?.code === 'UPSTREAM_RATE_LIMIT'
      ? 'Aguarde alguns instantes antes de consultar novamente. Os filtros preenchidos foram mantidos.'
      : error?.code === 'UPSTREAM_TIMEOUT' || error?.code === 'UPSTREAM_UNAVAILABLE'
        ? 'O serviço oficial pode estar lento ou temporariamente indisponível. Tente novamente sem alterar seus filtros.'
        : error?.code === 'UPSTREAM_RESTRICTED'
          ? 'Este conjunto de dados pode estar com acesso temporariamente limitado pela fonte oficial.'
          : 'Se o problema continuar, consulte o estado das integrações em “Fontes e metodologia”.';
  return <div className="error-panel" role="alert">
    <AlertCircle size={20} />
    <div><b>Não foi possível concluir esta consulta</b><p>{message}</p><small>{help}</small>
      {error?.upstreamStatus ? <details className="error-technical"><summary>Detalhe técnico</summary><span>A fonte oficial retornou HTTP {error.upstreamStatus}.</span></details> : null}
    </div>
    {onRetry && <button className="btn btn-sm btn-outline-secondary" onClick={onRetry}>Tentar novamente</button>}
  </div>;
}

function DashboardPage({ onOpenAuth }) {
  const [sourceStatus, setSourceStatus] = useState(null);
  const [health, setHealth] = useState(null);
  const [sourceError, setSourceError] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedResource, setSelectedResource] = useState('cnesEstablishments');
  const [schema, setSchema] = useState(null);
  const [params, setParams] = useState({});
  const [queryError, setQueryError] = useState(null);
  const queryController = useRef(null);
  useEffect(() => {
    Promise.all([getSourceStatus(), getHealth()]).then(([source, apiHealth]) => {
      setSourceStatus(source); setHealth(apiHealth);
    }).catch(error => setSourceError(error.message));
  }, []);
  useEffect(() => {
    let active = true;
    setSchema(null);
    setQueryError(null);
    getResourceSchema(selectedResource)
      .then(value => { if (active) setSchema(value); })
      .catch(error => { if (active) setQueryError(error); });
    return () => { active = false; };
  }, [selectedResource]);
  const run = async (override = params) => {
    queryController.current?.abort();
    queryController.current = null;
    const normalized = displaySavedFilters(override);
    const validationMessage = validateVisibleFilters(normalized, schema);
    if (validationMessage) {
      setData(null);
      setLoading(false);
      setQueryError({ message: validationMessage, code: 'INVALID_DATE' });
      return;
    }
    const controller = new AbortController();
    queryController.current = controller;
    const cleanFilters = Object.fromEntries(Object.entries(normalized).filter(([, value]) => String(value ?? '').trim() !== ''));
    setParams(normalized);
    setData(null);
    setLoading(true);
    setQueryError(null);
    try { setData(await getResourceData(selectedResource, cleanFilters, { signal: controller.signal })); }
    catch (error) { if (error.name !== 'AbortError') setQueryError(error); }
    finally { if (queryController.current === controller) setLoading(false); }
  };
  useEffect(() => () => queryController.current?.abort(), [selectedResource]);
  const rows = recordsFrom(data);
  const total = rows.length;
  return <>
    <PageHeading eyebrow="CENTRO DE INTELIGÊNCIA · BRASIL" title="Saúde pública, em perspectiva." description="Explore a estrutura da rede de saúde e os indicadores públicos do SUS a partir de fontes oficiais e rastreáveis." right={<div className="heading-date"><CalendarDays size={15} /> {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>} />
    <section className="hero-panel">
      <div className="hero-copy"><span className="hero-kicker"><span className="hero-kicker-dot" /> INTELIGÊNCIA TERRITORIAL EM SAÚDE</span><h2>Dados que revelam<br /><em>o território.</em></h2><p>Uma visão integrada de serviços, vigilância e vacinação para apoiar pesquisa, gestão e transparência pública.</p><div className="hero-actions"><Link to="/mapa" className="btn-primary-custom">Explorar mapa <ArrowRight size={16} /></Link><Link to="/fontes" className="btn-link-custom">Conhecer as fontes <ArrowRight size={15} /></Link></div></div>
      <div className="hero-graphic" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-center"><HeartPulse size={45} strokeWidth={1.2} /></div><div className="orbit-node node-one"><Activity size={16} /></div><div className="orbit-node node-two"><MapPinned size={16} /></div><div className="orbit-node node-three"><Syringe size={16} /></div><span className="graphic-coord coord-a">BR · 05°</span><span className="graphic-coord coord-b">DADOS ABERTOS</span></div>
    </section>
    <section className="quick-access-section" aria-labelledby="quick-access-title">
      <div className="quick-access-heading">
        <div><span className="eyebrow">COMECE POR AQUI</span><h2 id="quick-access-title">O que deseja explorar?</h2><p>Acesse diretamente os principais módulos da plataforma.</p></div>
      </div>
      <div className="quick-access-grid">
        <Link to="/rede" className="quick-access-card"><span className="quick-access-icon"><Building2 size={19} /></span><span className="quick-access-copy"><b>Rede de saúde</b><small>UBS, hospitais e estabelecimentos</small></span><ArrowRight size={16} /></Link>
        <Link to="/epidemiologia" className="quick-access-card"><span className="quick-access-icon"><Activity size={19} /></span><span className="quick-access-copy"><b>Epidemiologia</b><small>Dengue, Zika e chikungunya</small></span><ArrowRight size={16} /></Link>
        <Link to="/vacinacao" className="quick-access-card"><span className="quick-access-icon"><Syringe size={19} /></span><span className="quick-access-copy"><b>Vacinação</b><small>Doses aplicadas pelo PNI</small></span><ArrowRight size={16} /></Link>
        <Link to="/mapa" className="quick-access-card"><span className="quick-access-icon"><MapPinned size={19} /></span><span className="quick-access-copy"><b>Mapa interativo</b><small>Distribuição territorial dos serviços</small></span><ArrowRight size={16} /></Link>
        <Link to="/analises" className="quick-access-card"><span className="quick-access-icon"><BarChart3 size={19} /></span><span className="quick-access-copy"><b>Infográfico</b><small>Transforme consultas em leituras visuais</small></span><ArrowRight size={16} /></Link>
      </div>
    </section>
    <div className="section-title-row"><div><span className="eyebrow">MONITORAMENTO DE FONTES</span><h2>Estado das integrações</h2></div><button className="text-action" onClick={() => { setSourceStatus(null); getSourceStatus().then(setSourceStatus).catch(error => setSourceError(error.message)); }}><RefreshCw size={14} /> Atualizar status</button></div>
    <div className="metric-grid metric-grid-three">
      <div className="metric-card"><div className="metric-head"><span>API do Ministério da Saúde</span><Globe2 size={17} /></div><div className="metric-status-row"><strong>{sourceStatus?.api === 'online' ? 'Disponível' : sourceStatus?.api === 'restricted' ? 'Acesso restrito' : sourceStatus?.api === 'limited' ? 'Limitação de requisições' : sourceStatus ? 'Indisponível / não verificada' : 'Verificando…'}</strong><StatusPill status={sourceStatus?.api} /></div><small>Base DEMAS · serviço de dados abertos</small></div>
      <div className="metric-card"><div className="metric-head"><span>Documentação Swagger</span><BookOpen size={17} /></div><div className="metric-status-row"><strong>{sourceStatus?.swagger === 'online' ? `v${sourceStatus.version}` : sourceStatus ? 'Não acessível' : 'Verificando…'}</strong><StatusPill status={sourceStatus?.swagger} /></div><small>{sourceStatus?.resourcesDocumented ?? '—'} operações documentadas na especificação obtida</small></div>
      <div className="metric-card"><div className="metric-head"><span>API da plataforma</span><Database size={17} /></div><div className="metric-status-row"><strong>{health?.status === 'ok' ? 'Operacional' : health ? 'Verificar serviço' : 'Verificando…'}</strong><StatusPill status={health?.status} /></div><small>{health?.cache?.activeEntries ?? 0} itens em cache nesta instância</small></div>
    </div>
    <section className="data-query-card">
      <div className="query-card-header"><div><span className="eyebrow">CONSULTA DIRETA</span><h2>Comece por uma fonte oficial</h2><p>Os indicadores só aparecem depois de uma consulta real. Nenhum número demonstrativo é apresentado como dado do SUS.</p></div><span className="query-index">01 / 04</span></div>
      <div className="query-controls"><div className="field-wrap flex-grow-1"><label htmlFor="dashboard-source">Conjunto de dados</label><select id="dashboard-source" className="form-select" value={selectedResource} onChange={event => { setSelectedResource(event.target.value); setParams({}); setData(null); setQueryError(null); }}><option value="cnesEstablishments">Estabelecimentos CNES</option><option value="ubs">Unidades Básicas de Saúde</option><option value="hospitalsBeds">Hospitais e leitos</option><option value="dengue">Dengue</option><option value="vaccination2026">Doses aplicadas PNI — 2026</option></select></div>
        {splitQueryFields(selectedResource, schema).basic.map(parameter => <QueryField key={parameter.name} parameter={parameter} value={params[parameter.name] || ''} onChange={(name, value) => setParams(previous => ({ ...previous, [name]: value }))} />)}
        <button className="btn-primary-custom query-submit" disabled={loading || !schema} onClick={() => run(params)}>{loading ? <span className="spinner-border spinner-border-sm" /> : <Search size={16} />} {loading ? 'Consultando…' : !schema ? 'Preparando consulta…' : 'Consultar dados'}</button></div>
      {queryError && <ErrorPanel error={queryError} onRetry={run} />}
      {data && <div className="query-result-summary"><div className="query-result-count"><strong>{formatNumber(total)}</strong><span>registros identificados nesta resposta</span></div><div className="query-result-meta"><StatusPill status={data.sourceStatus === 'online' ? 'online' : 'cached'} /><span>{data.source?.label || selectedResource}</span><span>Referência: {data.source?.competence || 'não informada'}</span><span>Consultado em {formatDate(data.fetchedAt)}</span><span>{data.elapsedMs} ms · {data.cache?.hit ? 'cache' : 'fonte ao vivo'}</span></div><button className="btn-outline-custom" onClick={() => downloadCsv(rows)}><Download size={15} /> Exportar CSV</button></div>}
      {data?.analytics && <div className="dashboard-indicator-grid">
        <div className="metric-card"><div className="metric-head"><span>Linhas visíveis na página</span><ClipboardList size={16} /></div><strong>{formatNumber(data.analytics.pageRecords)}</strong><small>Após allowlist/agregação e supressão de pequenos grupos</small></div>
        <div className="metric-card"><div className="metric-head"><span>Total informado pela fonte</span><Database size={16} /></div><strong>{data.totalRecordsReported === null || data.totalRecordsReported === undefined ? '—' : formatNumber(data.totalRecordsReported)}</strong><small>{data.totalRecordsReported === null || data.totalRecordsReported === undefined ? 'Não divulgado ou suprimido por privacidade' : 'Total para os filtros declarados pela fonte'}</small></div>
        <div className="metric-card"><div className="metric-head"><span>Grupos suprimidos</span><ShieldCheck size={16} /></div><strong>{formatNumber(data.privacy?.suppressedGroups || 0)}</strong><small>Supressão técnica de grupos pequenos, quando aplicável</small></div>
        {data.analytics.totalMeasureInPage !== null && <div className="metric-card"><div className="metric-head"><span>{data.analytics.measureLabel}</span><Activity size={16} /></div><strong>{formatNumber(data.analytics.totalMeasureInPage)}</strong><small>Valor somado somente dos registros devolvidos nesta página</small></div>}
      </div>}
      {data?.analytics && <div className="analytics-grid dashboard-analytics-grid">
        <div className="chart-card"><div className="chart-title"><div><span className="eyebrow">SÉRIE DA PÁGINA CONSULTADA</span><h3>Distribuição por ano</h3></div><Activity size={18} /></div>{data.analytics.byYear?.length ? <ResponsiveContainer width="100%" height={220}><LineChart data={data.analytics.byYear}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" /><YAxis /><Tooltip formatter={value => formatNumber(value)} /><Line type="monotone" dataKey="value" name={data.analytics.measureLabel} stroke="#177b94" strokeWidth={2.5} /></LineChart></ResponsiveContainer> : <div className="empty-state chart-empty"><b>Sem série por ano</b><span>A fonte não trouxe campo temporal reconhecido nesta página.</span></div>}</div>
        <div className="chart-card"><div className="chart-title"><div><span className="eyebrow">COMPARAÇÃO TERRITORIAL</span><h3>Distribuição por UF</h3></div><Globe2 size={18} /></div>{data.analytics.byState?.length ? <ResponsiveContainer width="100%" height={220}><BarChart data={data.analytics.byState}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" /><YAxis /><Tooltip formatter={value => formatNumber(value)} /><Bar dataKey="value" name={data.analytics.measureLabel} fill="#1a7894" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <div className="empty-state chart-empty"><b>Sem dados por UF</b><span>A fonte não trouxe campo territorial reconhecido nesta página.</span></div>}</div>
      </div>}
      {data && <DataTable rows={rows.slice(0, 8)} />}
      {data?.pagination?.canNavigate && <div className="pagination-controls"><button className="btn-outline-custom" disabled={!data.pagination.hasPrevious || loading} onClick={() => run({ ...params, limit: String(data.pagination.limit), [data.pagination.offsetParameter]: String(data.pagination.previousOffset) })}>Página anterior</button><span>Página {data.pagination.page}</span><button className="btn-outline-custom" disabled={!data.pagination.hasNext || loading} onClick={() => run({ ...params, limit: String(data.pagination.limit), [data.pagination.offsetParameter]: String(data.pagination.nextOffset) })}>Próxima página</button></div>}
    </section>
    <div className="dashboard-bottom-grid">
      <div className="info-card"><div className="info-icon"><MapPinned size={19} /></div><div><h3>Visão territorial</h3><p>Localize unidades que possuam coordenadas geográficas válidas na base consultada. Registros sem latitude e longitude permanecem disponíveis na tabela.</p><Link to="/mapa">Abrir mapa interativo <ArrowRight size={14} /></Link></div></div>
      <div className="info-card"><div className="info-icon"><ShieldCheck size={19} /></div><div><h3>Privacidade em primeiro lugar</h3><p>A plataforma trabalha com bases públicas e agregadas. Dados pessoais ou clínicos identificáveis de pacientes não são exibidos nem armazenados.</p><Link to="/fontes">Ver metodologia e limitações <ArrowRight size={14} /></Link></div></div>
    </div>
    {sourceError && <div className="small text-danger mt-3">Status das integrações: {sourceError}</div>}
  </>;
}

function DataTable({ rows, compact = false, onRowClick, selectedId = null }) {
  if (!rows?.length) return <div className="empty-state"><ClipboardList size={21} /><b>Nenhum registro disponível nesta resposta</b><span>A fonte não retornou registros públicos para os filtros utilizados, ou alguns grupos foram suprimidos por privacidade.</span></div>;
  const columns = [...new Set(rows.flatMap(row => Object.keys(row || {})))].slice(0, compact ? 5 : 10);
  return <div className="table-responsive data-table-wrap"><table className="table data-table"><thead><tr>{columns.map(column => <th key={column}>{column.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{rows.map((row, index) => {
    const rowId = String(getField(row, ['codigo_cnes', 'codigo_estabelecimento_saude', 'cnes', 'co_cnes', 'nu_cnes', 'id']) ?? index);
    return <tr key={index} className={selectedId === rowId ? 'row-selected' : ''} onClick={onRowClick ? () => onRowClick(rowId, row, index) : undefined} onKeyDown={onRowClick ? event => event.key === 'Enter' && onRowClick(rowId, row, index) : undefined} tabIndex={onRowClick ? 0 : undefined}>
      {columns.map(column => {
    const value = row?.[column];
    return <td key={column}>{value === null || value === undefined || value === '' ? '—' : ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '—'}</td>;
  })}</tr>;
  })}</tbody></table></div>;
}

function MapViewport({ points }) {
  const map = useMap();
  useEffect(() => {
    const id = window.setTimeout(() => {
      map.invalidateSize();
      if (points.length > 0) {
        const bounds = L.latLngBounds(points.map(point => [point.lat, point.lng]));
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 9 });
      }
    }, 120);
    return () => window.clearTimeout(id);
  }, [map, points]);
  return null;
}
function MapControls() {
  const map = useMap();
  const [message, setMessage] = useState('');
  const locate = () => {
    if (!navigator.geolocation) { setMessage('Geolocalização não disponível neste navegador.'); return; }
    setMessage('Solicitando autorização de localização…');
    navigator.geolocation.getCurrentPosition(
      position => {
        map.flyTo([position.coords.latitude, position.coords.longitude], 13, { duration: 0.8 });
        setMessage('Localização exibida conforme a autorização do navegador.');
      },
      error => setMessage(error.code === 1 ? 'Permissão de localização negada.' : 'Não foi possível obter sua localização.'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  };
  return <div className="map-floating-controls">
    <button type="button" onClick={locate} title="Usar minha localização" aria-label="Usar minha localização"><LocateFixed size={15} /> Localizar</button>
    <button type="button" onClick={() => { map.flyTo([-14.2, -51.9], 4, { duration: 0.7 }); setMessage('Visualização nacional do Brasil.'); }} title="Voltar à visão do Brasil"><Globe2 size={14} /> Brasil</button>
    {message && <span role="status">{message}</span>}
  </div>;
}

function ClusteredFacilityMarkers({ points, selectedId, onSelectPoint }) {
  const map = useMap();
  const clusterRef = useRef(null);
  const markerById = useRef(new Map());
  useEffect(() => {
    if (typeof L.markerClusterGroup !== 'function') return undefined;
    markerById.current.clear();
    const cluster = L.markerClusterGroup({
      chunkedLoading: true,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      maxClusterRadius: 55,
      iconCreateFunction(group) {
        return L.divIcon({ className: 'health-cluster-icon', html: `<span>${group.getChildCount()}</span>`, iconSize: [42, 42] });
      }
    });
    for (const point of points) {
      const marker = L.marker([point.lat, point.lng], {
        title: point.name,
        icon: L.divIcon({ className: 'health-facility-marker', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] })
      });
      const popup = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = point.name;
      const type = document.createElement('div'); type.textContent = point.category;
      const locality = document.createElement('small'); locality.textContent = `${point.city}${point.uf ? ` · ${point.uf}` : ''}`;
      const code = document.createElement('small'); code.textContent = `CNES: ${point.id}`;
      popup.append(title, type, locality, code);
      marker.bindPopup(popup);
      marker.on('click', () => onSelectPoint?.(point.id));
      cluster.addLayer(marker);
      markerById.current.set(String(point.id), marker);
    }
    clusterRef.current = cluster;
    map.addLayer(cluster);
    return () => { map.removeLayer(cluster); cluster.clearLayers(); markerById.current.clear(); clusterRef.current = null; };
  }, [map, points, onSelectPoint]);
  useEffect(() => {
    if (!selectedId || !clusterRef.current) return;
    const marker = markerById.current.get(String(selectedId));
    if (marker) clusterRef.current.zoomToShowLayer(marker, () => marker.openPopup());
  }, [selectedId, points]);
  return null;
}

function FacilityHeatLayer({ points, enabled }) {
  const map = useMap();
  useEffect(() => {
    if (!enabled || typeof L.heatLayer !== 'function' || !points.length) return undefined;
    const layer = L.heatLayer(points.map(point => [point.lat, point.lng, 0.7]), { radius: 24, blur: 18, maxZoom: 12, minOpacity: 0.22 });
    layer.addTo(map);
    return () => map.removeLayer(layer);
  }, [map, points, enabled]);
  return null;
}

function MapStateCapture({ onChange }) {
  const map = useMap();
  useEffect(() => {
    const capture = () => {
      const center = map.getCenter();
      onChange({ center_lat: center.lat, center_lng: center.lng, zoom: map.getZoom() });
    };
    capture();
    map.on('moveend', capture);
    return () => map.off('moveend', capture);
  }, [map, onChange]);
  return null;
}

function RestoreSavedMapView({ userId, viewId, onRestore }) {
  const map = useMap();
  useEffect(() => {
    let active = true;
    if (!userId || !supabase) return () => { active = false; };
    let query = supabase.from('saved_map_views').select('center_lat,center_lng,zoom,layers').eq('user_id', userId);
    query = viewId ? query.eq('id', viewId) : query.order('created_at', { ascending: false }).limit(1);
    query.maybeSingle()
      .then(({ data }) => {
        if (!active || !data || !Number.isFinite(data.center_lat) || !Number.isFinite(data.center_lng)) return;
        map.setView([data.center_lat, data.center_lng], Number(data.zoom) || 4, { animate: false });
        onRestore?.(data.layers || []);
      });
    return () => { active = false; };
  }, [map, userId, viewId, onRestore]);
  return null;
}

function FacilityMap({ rows, full = false, user, onOpenAuth, filters = {}, mapViewId, selectedId, onSelectPoint }) {
  const [showHeat, setShowHeat] = useState(false);
  const [mapView, setMapView] = useState({ center_lat: -14.2, center_lng: -51.9, zoom: 4 });
  const [mapSaveMessage, setMapSaveMessage] = useState('');
  const [initialMapView, setInitialMapView] = useState(null);
  const [facilitySearch, setFacilitySearch] = useState('');
  const frameRef = useRef(null);
  const allPoints = useMemo(() => rows.map(facilityPoint).filter(Boolean), [rows]);
  const matchingPoints = useMemo(() => {
    const term = facilitySearch.trim().toLocaleLowerCase('pt-BR');
    if (!term) return allPoints;
    return allPoints.filter(point => [point.name, point.category, point.city, point.uf, point.id]
      .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(term)));
  }, [allPoints, facilitySearch]);
  const points = useMemo(() => matchingPoints.slice(0, 1500), [matchingPoints]);
  const captureMapView = useCallback(view => setMapView(view), []);
  const restoreLayers = useCallback(layers => setShowHeat(Boolean(layers?.find(layer => layer.key === 'facility-density')?.enabled)), []);
  useEffect(() => {
    let active = true;
    if (!user?.id || !supabase) return () => { active = false; };
    let query = supabase.from('saved_map_views').select('center_lat,center_lng,zoom,layers').eq('user_id', user.id);
    query = mapViewId ? query.eq('id', mapViewId) : query.order('created_at', { ascending: false }).limit(1);
    query.maybeSingle().then(({ data }) => {
      if (!active || !data || !Number.isFinite(Number(data.center_lat)) || !Number.isFinite(Number(data.center_lng))) return;
      setInitialMapView({ center_lat: Number(data.center_lat), center_lng: Number(data.center_lng), zoom: Number(data.zoom) || 4 });
      restoreLayers(data.layers || []);
    });
    return () => { active = false; };
  }, [user?.id, mapViewId, restoreLayers]);
  const saveMapView = async () => {
    if (!user) { onOpenAuth?.(); return; }
    if (!supabase) { setMapSaveMessage('Salvar visualizações exige uma conta conectada ao Supabase. O mapa continua disponível.'); return; }
    const name = window.prompt('Nome desta visualização do mapa:', 'Minha visualização');
    if (!name?.trim()) return;
    const { error } = await supabase.from('saved_map_views').insert({
      user_id: user.id, name: name.trim().slice(0, 120),
      center_lat: mapView.center_lat, center_lng: mapView.center_lng,
      zoom: Math.max(2, Math.min(18, Math.round(mapView.zoom))),
      layers: [{ key: 'facility-density', enabled: showHeat }], filters
    });
    setMapSaveMessage(error ? 'Não foi possível salvar a visualização na sua conta.' : 'Visualização salva na sua conta.');
  };
  const fallbackMap = <MapContainer center={[-14.2, -51.9]} zoom={4} minZoom={3} maxZoom={18} scrollWheelZoom preferCanvas>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <MapViewport points={points} />
    <MapControls />
    <MapStateCapture onChange={captureMapView} />
    <RestoreSavedMapView userId={user?.id} viewId={mapViewId} onRestore={restoreLayers} />
    <ClusteredFacilityMarkers points={points} selectedId={selectedId} onSelectPoint={onSelectPoint} />
    <FacilityHeatLayer points={points} enabled={showHeat} />
  </MapContainer>;
  const missingCoordinates = Math.max(0, rows.length - allPoints.length);
  return <>
    <GoogleMapsSetupNotice />
    <div className="map-command-strip">
      <label className="map-command-search"><Search size={17} /><input value={facilitySearch} onChange={event => setFacilitySearch(event.target.value)} placeholder="Buscar unidade, município, tipo ou CNES…" aria-label="Buscar estabelecimento no mapa" />{facilitySearch && <button type="button" onClick={() => setFacilitySearch('')} aria-label="Limpar busca"><X size={15} /></button>}</label>
      <div className="map-command-stats" aria-live="polite">
        <span><b>{formatNumber(matchingPoints.length)}</b><small>com coordenadas</small></span>
        <span><b>{formatNumber(rows.length)}</b><small>na consulta</small></span>
        <span><b>{formatNumber(missingCoordinates)}</b><small>sem coordenadas</small></span>
      </div>
    </div>
    <div ref={frameRef} className={`map-frame map-frame-immersive ${full ? 'map-frame-full' : ''} ${googleMapsConfigured ? 'map-frame-google' : ''}`}>
      <GoogleFacilityMap points={points} selectedId={selectedId} onSelectPoint={onSelectPoint} onViewChange={captureMapView} initialView={initialMapView} showDensity={showHeat} fallback={fallbackMap} />
      <div className="map-toolbar">
        <label><input type="checkbox" checked={showHeat} onChange={event => setShowHeat(event.target.checked)} /> Concentração de unidades</label>
        <div><button type="button" onClick={saveMapView}>Salvar vista</button><button type="button" onClick={() => frameRef.current?.requestFullscreen?.()}>Tela cheia</button></div>
      </div>
      {mapSaveMessage && <div className="map-save-message" role="status">{mapSaveMessage}</div>}
      <div className="map-floating-legend"><span><i className="legend-point" /> Estabelecimento</span><span><i className="legend-cluster" /> Agrupamento</span></div>
    </div>
    <div className="map-attribution-note map-immersive-note">{matchingPoints.length > points.length ? `Exibindo ${formatNumber(points.length)} de ${formatNumber(matchingPoints.length)} estabelecimentos encontrados nesta página da consulta. ` : ''}{facilitySearch && matchingPoints.length === 0 ? 'Nenhum estabelecimento desta página corresponde à busca.' : ''} Marcadores usam apenas coordenadas publicadas na base consultada. A camada de concentração representa a distribuição dos estabelecimentos, não incidência de doenças.</div>
  </>;
}

const UF_CODES = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17',
  MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27',
  SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41',
  SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53'
};

function stateCodeFromFeature(feature) {
  const properties = feature?.properties || {};
  const raw = properties.codarea ?? properties.CD_UF ?? properties.cd_uf ?? feature?.id ?? properties.id;
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits ? digits.slice(-2).padStart(2, '0') : null;
}

function EpidemiologicalMap({ rows, indicatorLabel = 'Registros agregados' }) {
  const [geojson, setGeojson] = useState(null);
  const [municipalityGeojson, setMunicipalityGeojson] = useState(null);
  const [geoError, setGeoError] = useState('');
  const [showHeat, setShowHeat] = useState(true);
  const [showMunicipalities, setShowMunicipalities] = useState(false);
  useEffect(() => {
    let active = true;
    getGeoStates().then(data => { if (active) setGeojson(data); }).catch(error => { if (active) setGeoError(error.message); });
    return () => { active = false; };
  }, []);
  const totals = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const raw = getField(row, ['id_municip', 'id_municipio', 'co_ibge', 'codigo_municipio']);
      const digits = String(raw ?? '').replace(/\D/g, '');
      const uf = getField(row, ['sg_uf', 'uf']);
      const code = digits.length === 7 ? digits.slice(0, 2) : UF_CODES[String(uf || '').toUpperCase()] || (/^\d+$/.test(String(uf || '')) ? String(uf).padStart(2, '0') : null);
      if (!code) continue;
      const value = Number(getField(row, ['registros_na_pagina', 'doses_aplicadas'])) || 1;
      map.set(code, (map.get(code) || 0) + value);
    }
    return map;
  }, [rows]);
  const municipalityTotals = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const raw = getField(row, ['id_municip', 'id_municipio', 'co_ibge', 'codigo_municipio']);
      const code = String(raw ?? '').replace(/\D/g, '');
      if (code.length !== 7) continue;
      const value = Number(getField(row, ['registros_na_pagina', 'doses_aplicadas'])) || 1;
      map.set(code, (map.get(code) || 0) + value);
    }
    return map;
  }, [rows]);
  const selectedMunicipalityCodes = useMemo(() => [...municipalityTotals.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 25).map(([code]) => code), [municipalityTotals]);
  useEffect(() => {
    let active = true;
    setMunicipalityGeojson(null);
    if (!showMunicipalities || !selectedMunicipalityCodes.length) return () => { active = false; };
    getGeoMunicipalities(selectedMunicipalityCodes)
      .then(data => { if (active) setMunicipalityGeojson(data); })
      .catch(error => { if (active) setGeoError(error.message); });
    return () => { active = false; };
  }, [showMunicipalities, selectedMunicipalityCodes.join(',')]);
  const maxValue = Math.max(1, ...totals.values());
  const maxMunicipalityValue = Math.max(1, ...municipalityTotals.values());
  const styleFeature = feature => {
    const value = totals.get(stateCodeFromFeature(feature)) || 0;
    const intensity = value ? value / maxValue : 0;
    return { color: '#ffffff', weight: 1.1, fillColor: value ? `rgba(17, 123, 148, ${0.25 + intensity * 0.68})` : '#d9e4e8', fillOpacity: 0.9 };
  };
  const onEachFeature = (feature, layer) => {
    const code = stateCodeFromFeature(feature);
    const value = totals.get(code) || 0;
    const name = feature?.properties?.nome ?? feature?.properties?.name ?? feature?.properties?.NM_UF ?? `UF ${code || ''}`;
    const popup = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = name;
    const amount = document.createElement('div'); amount.textContent = value ? `${formatNumber(value)} ${indicatorLabel.toLowerCase()}` : 'Sem registros disponíveis nesta consulta';
    popup.append(title, amount);
    layer.bindPopup(popup);
  };
  const municipalStyle = feature => {
    const code = String(feature?.properties?.codarea ?? feature?.id ?? '').replace(/\D/g, '');
    const value = municipalityTotals.get(code) || 0;
    const intensity = value ? value / maxMunicipalityValue : 0;
    return { color: '#ffffff', weight: 0.8, fillColor: value ? `rgba(17, 123, 148, ${0.22 + intensity * 0.7})` : '#e3eaed', fillOpacity: 0.9 };
  };
  const onEachMunicipality = (feature, layer) => {
    const code = String(feature?.properties?.codarea ?? feature?.id ?? '').replace(/\D/g, '');
    const value = municipalityTotals.get(code) || 0;
    const name = feature?.properties?.nome ?? feature?.properties?.name ?? `Município ${code}`;
    const popup = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = name;
    const amount = document.createElement('div'); amount.textContent = value ? `${formatNumber(value)} ${indicatorLabel.toLowerCase()}` : 'Sem registros nesta consulta';
    popup.append(title, amount);
    layer.bindPopup(popup);
  };
  const activeGeojson = showMunicipalities ? municipalityGeojson : geojson;
  return <section className="epidemiology-map-card">
    <div className="map-result-heading"><span><MapPinned size={16} /> Distribuição territorial {showMunicipalities ? 'por município' : 'por UF'}</span><div className="map-layer-toggles"><label><input type="checkbox" checked={showMunicipalities} onChange={event => setShowMunicipalities(event.target.checked)} disabled={!municipalityTotals.size} /> Municípios (até 25 da página)</label><label><input type="checkbox" checked={showHeat} onChange={event => setShowHeat(event.target.checked)} disabled={showMunicipalities} /> Intensidade agregada</label></div></div>
      {geoError && <div className="methodology-warning"><AlertCircle size={16} /> Não foi possível carregar as malhas territoriais do IBGE: {geoError}</div>}
    {showMunicipalities && !municipalityGeojson && selectedMunicipalityCodes.length > 0 && <Loading label="Carregando malhas dos municípios da página…" />}
    {googleMapsConfigured ? <GoogleEpidemiologyMap
      geojson={geojson}
      municipalityGeojson={municipalityGeojson}
      showMunicipalities={showMunicipalities}
      showIntensity={showHeat}
      totals={totals}
      municipalityTotals={municipalityTotals}
      indicatorLabel={indicatorLabel}
      fallback={activeGeojson?.features ? <div className="map-frame epidemiology-map-frame"><MapContainer center={[-14.2, -51.9]} zoom={showMunicipalities ? 5 : 4} minZoom={3} maxZoom={12} scrollWheelZoom preferCanvas><TileLayer attribution='Malhas territoriais: IBGE · &copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />{showMunicipalities ? <GeoJSON data={municipalityGeojson} style={municipalStyle} onEachFeature={onEachMunicipality} /> : <><GeoJSON data={geojson} style={styleFeature} onEachFeature={onEachFeature} /><StateHeatLayer features={geojson.features} totals={totals} maxValue={maxValue} enabled={showHeat} /></>}</MapContainer></div> : null}
    /> : <>
      <GoogleMapsSetupNotice />
      {activeGeojson?.features && <div className="map-frame epidemiology-map-frame"><MapContainer center={[-14.2, -51.9]} zoom={showMunicipalities ? 5 : 4} minZoom={3} maxZoom={12} scrollWheelZoom preferCanvas><TileLayer attribution='Malhas territoriais: IBGE · &copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />{showMunicipalities ? <GeoJSON data={municipalityGeojson} style={municipalStyle} onEachFeature={onEachMunicipality} /> : <><GeoJSON data={geojson} style={styleFeature} onEachFeature={onEachFeature} /><StateHeatLayer features={geojson.features} totals={totals} maxValue={maxValue} enabled={showHeat} /></>}</MapContainer></div>}
    </>}
    <div className="map-attribution-note">Dados epidemiológicos agregados. {showMunicipalities ? `Mapa limitado aos ${selectedMunicipalityCodes.length} municípios com maiores contagens na página atual; a paginação e os filtros alteram essa seleção.` : 'O mapa estadual agrega municípios por UF.'} Nenhum polígono ou centroide representa localização individual de pacientes. Fonte dos limites territoriais: IBGE; base cartográfica: {googleMapsConfigured ? 'Google Maps' : 'OpenStreetMap'}. Valores referem-se somente à página consultada.</div>
    {!rows.length && <div className="empty-state"><Activity size={20} /><b>Consulte uma base epidemiológica para gerar a camada</b></div>}
  </section>;
}

function StateHeatLayer({ features, totals, maxValue, enabled }) {
  const map = useMap();
  useEffect(() => {
    if (!enabled || typeof L.heatLayer !== 'function') return undefined;
    const points = [];
    for (const feature of features || []) {
      const value = totals.get(stateCodeFromFeature(feature)) || 0;
      if (!value) continue;
      const bounds = L.geoJSON(feature).getBounds();
      if (bounds.isValid()) {
        const center = bounds.getCenter();
        points.push([center.lat, center.lng, Math.max(0.1, value / maxValue)]);
      }
    }
    if (!points.length) return undefined;
    const layer = L.heatLayer(points, { radius: 38, blur: 28, maxZoom: 7, minOpacity: 0.25 });
    layer.addTo(map);
    return () => map.removeLayer(layer);
  }, [map, features, totals, maxValue, enabled]);
  return null;
}

function ResourceExplorer({ initialResource, allowedResources, user, onOpenAuth, withMap = false, immersiveMap = false, title = 'Explorar dados' }) {
  const location = useLocation();
  const mapViewId = new URLSearchParams(location.search).get('mapview');
  const [resource, setResource] = useState(initialResource);
  const [available, setAvailable] = useState([]);
  const [schema, setSchema] = useState(null);
  const [params, setParams] = useState({});
  const [result, setResult] = useState(null);
  const [loadingSchema, setLoadingSchema] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState(null);
  const [saveMessage, setSaveMessage] = useState('');
  const [selectedFacilityId, setSelectedFacilityId] = useState(null);
  const requestController = useRef(null);
  const restoredQueryKey = useRef(null);
  const allowedSet = useMemo(() => new Set(allowedResources || [initialResource]), [allowedResources, initialResource]);

  useEffect(() => {
    let active = true;
    getSources().then(data => { if (active) setAvailable(data.resources || []); }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!location.search) return;
    const query = new URLSearchParams(location.search);
    const sourceFromUrl = query.get('source');
    const sourceIsAllowed = !sourceFromUrl || allowedSet.has(sourceFromUrl);
    if (sourceFromUrl && sourceIsAllowed) {
      setResource(sourceFromUrl);
    } else if (sourceFromUrl) {
      setParams({});
      setSaveMessage('Esta consulta pertence a outra seção. Escolha uma fonte disponível nesta página.');
    }
    const encoded = query.get('filters');
    if (encoded && sourceIsAllowed) {
      try { setParams(displaySavedFilters(JSON.parse(encoded))); }
      catch { setSaveMessage('Os filtros salvos não puderam ser interpretados.'); }
    }
  }, [location.search, allowedSet]);

  useEffect(() => {
    let active = true;
    setLoadingSchema(true);
    setSchema(null);
    setResult(null);
    setError(null);
    getResourceSchema(resource)
      .then(data => { if (active) setSchema(data); })
      .catch(err => { if (active) setError(err); })
      .finally(() => { if (active) setLoadingSchema(false); });
    return () => { active = false; };
  }, [resource]);

  useEffect(() => () => requestController.current?.abort(), [resource]);

  const run = useCallback(async (override = params) => {
    requestController.current?.abort();
    requestController.current = null;
    const normalized = displaySavedFilters(override);
    const validationMessage = validateVisibleFilters(normalized, schema);
    if (validationMessage) {
      setResult(null);
      setLoadingData(false);
      setError({ message: validationMessage, code: 'INVALID_DATE' });
      return;
    }
    const controller = new AbortController();
    requestController.current = controller;
    setParams(normalized);
    setLoadingData(true);
    setError(null);
    setResult(null);
    setSaveMessage('');
    const cleanFilters = Object.fromEntries(Object.entries(normalized).filter(([, value]) => String(value ?? '').trim() !== ''));
    try {
      const data = await getResourceData(resource, cleanFilters, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setResult(data);
      if (user && supabase) {
        const { error: historyError } = await supabase.from('search_history').insert({ user_id: user.id, source_key: resource, filters: cleanFilters, result_count: data.records?.length || 0 });
        if (historyError) setSaveMessage('Consulta concluída, mas não foi possível registrar no histórico da conta.');
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err);
    } finally {
      if (requestController.current === controller) setLoadingData(false);
    }
  }, [resource, params, schema, user]);

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    if (query.get('execute') !== '1') return;
    const sourceFromUrl = query.get('source');
    const filtersFromUrl = query.get('filters');
    if (!sourceFromUrl || !filtersFromUrl || !allowedSet.has(sourceFromUrl) || restoredQueryKey.current === location.search) return;
    let restoredFilters;
    try { restoredFilters = displaySavedFilters(JSON.parse(filtersFromUrl)); }
    catch { setSaveMessage('Os filtros salvos não puderam ser interpretados.'); return; }
    if (resource !== sourceFromUrl || loadingSchema || !schema) return;
    restoredQueryKey.current = location.search;
    setParams(restoredFilters);
    run(restoredFilters);
  }, [location.search, resource, run, allowedSet, loadingSchema, schema]);

  const rows = recordsFrom(result);
  const visibleResources = useMemo(() => {
    const filtered = available.filter(item => allowedSet.has(item.id));
    if (filtered.length) return filtered;
    return [{ id: initialResource, label: initialResource, group: 'Fonte selecionada' }];
  }, [available, allowedSet, initialResource]);
  const selectedLabel = visibleResources.find(item => item.id === resource)?.label || title;
  const save = async () => {
    if (!user) { onOpenAuth(); return; }
    if (!supabase) { setSaveMessage('O salvamento de filtros exige a conexão com o Supabase.'); return; }
    const label = visibleResources.find(item => item.id === resource)?.label || resource;
    const cleanFilters = Object.fromEntries(Object.entries(params).filter(([, value]) => String(value ?? '').trim() !== ''));
    const [savedFilter, favorite] = await Promise.all([
      supabase.from('saved_filters').insert({ user_id: user.id, name: label, source_key: resource, filters: cleanFilters }),
      supabase.from('favorite_searches').insert({ user_id: user.id, name: label, source_key: resource, filters: cleanFilters })
    ]);
    setSaveMessage(savedFilter.error || favorite.error
      ? 'Não foi possível salvar todos os itens. Confira a conexão da conta.'
      : 'Filtro e favorito salvos na sua conta.');
  };

  const { basic: basicFields, advanced: advancedFields } = splitQueryFields(resource, schema);
  const pagination = result?.pagination;
  const source = result?.source;
  const isEpidemiological = ['dengue', 'zika', 'chikungunya'].includes(resource);
  const csvMetadata = { 'Fonte oficial': source?.label || resource, 'Endpoint': source?.endpoint, 'Competência / referência': source?.competence, 'Consultado em': result?.fetchedAt, 'Observação': result?.privacy?.note || 'Campos públicos permitidos' };
  const onParameterChange = (name, value) => {
    setParams(previous => ({ ...previous, [name]: value }));
    setError(null);
  };

  return <div className={`explorer-layout ${immersiveMap ? 'map-explorer-layout' : ''}`}>
    <section className="filter-panel">
      <div className="filter-panel-heading">
        <div className="filter-icon"><SlidersHorizontal size={17} /></div>
        <div><b>Consulta simplificada</b><small>Escolha a base. Os filtros são opcionais.</small></div>
        <span className="query-step-chip">1 etapa</span>
      </div>
      <div className="field-wrap source-select-wrap">
        <label htmlFor="resource-select">O que deseja consultar?</label>
        <select id="resource-select" className="form-select" value={resource} onChange={event => {
          setResource(event.target.value); setParams({}); setResult(null); setError(null); setSaveMessage('');
        }}>
          {visibleResources.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>
      <div className="query-help-line"><CheckCircle2 size={14} /><span>Não é necessário preencher todos os filtros. Em branco, usamos os parâmetros padrão da fonte oficial.</span></div>
      {loadingSchema ? <Loading label="Preparando os filtros…" /> : <>
        {basicFields.length > 0 ? <div className="dynamic-fields query-basic-fields">
          {basicFields.map(parameter => <QueryField key={parameter.name} parameter={parameter} value={params[parameter.name] || ''} onChange={onParameterChange} />)}
        </div> : <div className="no-filters query-no-filters">
          <Search size={17} /><span>{resource.startsWith('vaccination')
            ? 'Esta base de vacinação não exige filtros. Clique em consultar para buscar os registros publicados pelo PNI.'
            : 'Esta fonte não exige filtros para iniciar. A primeira página será carregada automaticamente.'}</span>
        </div>}
        {advancedFields.length > 0 && <details className="advanced-filters">
          <summary><Filter size={14} /> Mais filtros <span>{advancedFields.length} opcionais</span></summary>
          <div className="dynamic-fields advanced-filter-grid">
            {advancedFields.map(parameter => <QueryField key={parameter.name} parameter={parameter} value={params[parameter.name] || ''} onChange={onParameterChange} />)}
          </div>
        </details>}
      </>}
      <button className="btn-primary-custom w-100 justify-content-center query-main-button" onClick={() => run(params)} disabled={loadingData || loadingSchema}>
        {loadingData ? <><span className="spinner-border spinner-border-sm" /> Consultando dados oficiais…</> : <><Search size={16} /> Consultar {resource.startsWith('vaccination') ? 'doses aplicadas' : selectedLabel.toLowerCase()}</>}
      </button>
      <div className="filter-secondary-actions">
        <button className="btn-outline-custom" onClick={save}><HeartPulse size={14} /> Salvar consulta</button>
        {rows.length > 0 && <button className="btn-outline-custom" onClick={() => downloadCsv(rows, 'healthdata-consulta.csv', csvMetadata)}><Download size={14} /> Exportar CSV</button>}
        <button className="btn-outline-custom" onClick={() => { setParams({}); setResult(null); setError(null); }}><RefreshCw size={14} /> Limpar</button>
      </div>
      {saveMessage && <div className="save-feedback" role="status"><CheckCircle2 size={14} />{saveMessage}</div>}
      {schema && <details className="source-technical-details">
        <summary>Detalhes da fonte (equipe técnica)</summary>
        <div><b>Operação:</b> GET {schema.path}<br /><b>Documentação:</b> Swagger {schema.swaggerVersion || 'não informada'}<br /><b>Paginação automática:</b> {schema.pagination ? `até ${schema.pagination.maxLimit || schema.pagination.defaultLimit} registros por página` : 'não documentada'}<br /><b>Descrição:</b> {schema.summary || schema.description}</div>
      </details>}
    </section>

    <section className={`explorer-results ${immersiveMap ? 'map-explorer-results' : ''}`}>
      {immersiveMap && <section className="map-stage-section" aria-label="Explorador geográfico de estabelecimentos">
        <div className="map-stage-heading">
          <div><span className="eyebrow">INTELIGÊNCIA TERRITORIAL</span><h2>Explore a rede de saúde no território</h2><p>Movimente o mapa, aproxime regiões e selecione um estabelecimento para ver seus dados cadastrais.</p></div>
          <span className="map-stage-status"><i /> {googleMapsConfigured ? 'Google Maps conectado' : 'Mapa alternativo ativo'}</span>
        </div>
        <FacilityMap rows={rows} full user={user} onOpenAuth={onOpenAuth} filters={{ resource, query: params }} mapViewId={mapViewId} selectedId={selectedFacilityId} onSelectPoint={setSelectedFacilityId} />
      </section>}
      <div className="results-header">
        <div><span className="eyebrow">RESULTADO DA CONSULTA</span><h2>{title}</h2>
          <p>{result ? (rows.length
            ? `${formatNumber(rows.length)} grupos agregados exibidos nesta página. A fonte retornou ${formatNumber(result.sourceRecordCount ?? rows.length)} registros brutos.`
            : (Number(result.sourceRecordCount || 0) > 0 && Number(result.privacy?.suppressedGroups || 0) > 0
              ? `${formatNumber(result.sourceRecordCount)} registros recebidos. Todos os grupos ficaram abaixo do mínimo de ${result.privacy.minimumGroupSize || 5} registros e foram ocultados por privacidade.`
              : 'A fonte não encontrou registros para os filtros informados. Remova o filtro municipal ou teste outro ano.'))
            : `Os dados de ${selectedLabel.toLowerCase()} aparecerão aqui após a consulta.`}</p>
        </div>
        {result && <div className="results-stamp"><StatusPill status={result.sourceStatus} /><small>{formatDate(result.fetchedAt)}</small></div>}
      </div>
      {loadingData && <Loading label="Conectando à fonte oficial do Ministério da Saúde…" />}
      {error && <ErrorPanel error={error} onRetry={() => run(params)} />}
      {!loadingData && !error && !result && <div className="empty-state explorer-empty">
        <Search size={24} /><b>Sua consulta está pronta</b>
        <span>{resource.startsWith('vaccination') && basicFields.length === 0
          ? 'Esta base não exige filtros. Clique em consultar para carregar os dados publicados pelo Programa Nacional de Imunizações.'
          : 'Escolha apenas os filtros necessários e clique em consultar. Os resultados são carregados diretamente das fontes oficiais.'}</span>
      </div>}
      {result && <>
        {result.warning && <div className="cache-warning"><AlertCircle size={15} /> {result.warning}</div>}
        {result.privacy?.note && <div className="methodology-warning"><ShieldCheck size={16} /> <span>{result.privacy.note}</span></div>}
        {isEpidemiological && rows.length === 0 && <div className="zero-results-guidance" role="status">
          <div><b>{Number(result.sourceRecordCount || 0) > 0 ? 'Resultado protegido por privacidade' : 'Nenhum registro encontrado com esses filtros'}</b>
            <span>{Number(result.sourceRecordCount || 0) > 0
              ? 'A fonte respondeu, mas a regra mínima de agrupamento impediu a publicação desses grupos. Experimente consultar sem limitar a um município.'
              : 'A fonte respondeu normalmente. Tente remover o filtro municipal ou selecionar outro ano de referência.'}</span>
          </div>
          {params.id_municip && <button className="btn-outline-custom" onClick={() => { const broader = { ...params }; delete broader.id_municip; run(broader); }} disabled={loadingData}>Consultar sem município</button>}
        </div>}
        {withMap && isEpidemiological && <EpidemiologicalMap rows={rows} indicatorLabel={resource} />}
        {withMap && !isEpidemiological && !immersiveMap && <><div className="map-result-heading"><span><MapPinned size={16} /> Estabelecimentos georreferenciados</span><small>{rows.map(facilityPoint).filter(Boolean).length} de {rows.length} registros com coordenadas válidas</small></div><FacilityMap rows={rows} user={user} onOpenAuth={onOpenAuth} filters={{ resource, query: params }} mapViewId={mapViewId} selectedId={selectedFacilityId} onSelectPoint={setSelectedFacilityId} /></>}
        <div className="table-heading"><b>Registros retornados</b><span>{pagination ? `Página ${pagination.page}${pagination.totalRecordsReported !== null ? ` · ${formatNumber(pagination.totalRecordsReported)} registros informados pela fonte` : ''}` : 'Resultado sem paginação documentada'}</span></div>
        <DataTable rows={rows.slice(0, 60)} onRowClick={withMap && !isEpidemiological ? setSelectedFacilityId : undefined} selectedId={selectedFacilityId} />
        {pagination?.canNavigate && <div className="pagination-controls">
          <button className="btn-outline-custom" disabled={!pagination.hasPrevious || loadingData} onClick={() => run({ ...params, limit: String(pagination.limit), [pagination.offsetParameter]: String(pagination.previousOffset) })}>Página anterior</button>
          <span>Página {pagination.page}{pagination.totalRecordsReported !== null ? ` de ${Math.max(1, Math.ceil(pagination.totalRecordsReported / pagination.limit))}` : ''}</span>
          <button className="btn-outline-custom" disabled={!pagination.hasNext || loadingData} onClick={() => run({ ...params, limit: String(pagination.limit), [pagination.offsetParameter]: String(pagination.nextOffset) })}>Próxima página</button>
        </div>}
        {pagination && !pagination.canNavigate && <div className="source-footnote">A fonte limita a quantidade por consulta, mas não documenta um parâmetro para avançar entre páginas.</div>}
        <div className="result-provenance">Fonte: {source?.label || resource} · referência {source?.competence || 'não informada'} · {result.elapsedMs} ms · {result.cache?.hit ? 'cache' : 'consulta direta'}.</div>
        {result.analytics && <div className="analysis-note">{result.analytics.note}</div>}
      </>}
      {!result && withMap && mapViewId && <><div className="map-result-heading"><span><MapPinned size={16} /> Visualização geográfica salva</span><small>Consulte os dados para carregar os marcadores desta visualização.</small></div><FacilityMap rows={[]} user={user} onOpenAuth={onOpenAuth} mapViewId={mapViewId} /></>}
    </section>
  </div>;
}
function MapPage({ user, onOpenAuth }) {
  return <div className="immersive-map-page"><PageHeading eyebrow="EXPLORAÇÃO GEOGRÁFICA" title="Mapa de inteligência em saúde" description="Uma visão territorial interativa da rede pública. Explore a distribuição dos estabelecimentos a partir das coordenadas publicadas nas bases oficiais." right={<span className="map-title-chip"><MapPinned size={15} /> {googleMapsConfigured ? 'Google Maps · Satélite + 3D' : 'Mapa alternativo · Google Maps opcional'}</span>} /><ResourceExplorer initialResource="cnesEstablishments" allowedResources={RESOURCE_SECTIONS.map} user={user} onOpenAuth={onOpenAuth} withMap immersiveMap title="Exploração territorial" /></div>;
}
function NetworkPage({ user, onOpenAuth }) {
  return <><PageHeading eyebrow="ESTRUTURA ASSISTENCIAL" title="Rede de saúde" description="Pesquise UBS, hospitais, estabelecimentos e informações cadastrais do CNES." /><ResourceExplorer initialResource="ubs" allowedResources={RESOURCE_SECTIONS.network} user={user} onOpenAuth={onOpenAuth} title="Estabelecimentos e serviços" /></>;
}
function EpidemiologyPage({ user, onOpenAuth }) {
  return <><PageHeading eyebrow="VIGILÂNCIA EM SAÚDE" title="Epidemiologia" description="Explore as bases de arboviroses e vigilância disponíveis no catálogo do Ministério da Saúde. Resultados municipais não representam a localização de pacientes." /><ResourceExplorer initialResource="dengue" allowedResources={RESOURCE_SECTIONS.epidemiology} user={user} onOpenAuth={onOpenAuth} withMap title="Indicadores epidemiológicos" /></>;
}
function VaccinationPage({ user, onOpenAuth }) {
  return <><PageHeading eyebrow="IMUNIZAÇÃO" title="Vacinação" description="Consulte as doses aplicadas pelo Programa Nacional de Imunizações e as bases relacionadas à segurança da vacinação." /><ResourceExplorer initialResource="vaccination2026" allowedResources={RESOURCE_SECTIONS.vaccination} user={user} onOpenAuth={onOpenAuth} title="Dados de vacinação" /></>;
}

function AnalyticsPage() {
  const [resource, setResource] = useState('dengue');
  const [schema, setSchema] = useState(null);
  const [params, setParams] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeView, setActiveView] = useState('territory');
  const [showTable, setShowTable] = useState(false);
  const requestRef = useRef(null);
  useEffect(() => {
    let active = true;
    requestRef.current?.abort();
    setResult(null); setParams({}); setSchema(null); setError(null); setLoading(false);
    getResourceSchema(resource).then(value => { if (active) setSchema(value); }).catch(err => { if (active) setError(err); });
    return () => { active = false; requestRef.current?.abort(); };
  }, [resource]);
  const run = async () => {
    requestRef.current?.abort();
    const validationMessage = validateVisibleFilters(params, schema);
    if (validationMessage) { setResult(null); setError({ message: validationMessage, code: 'INVALID_DATE' }); return; }
    const controller = new AbortController();
    requestRef.current = controller;
    const cleanFilters = Object.fromEntries(Object.entries(params).filter(([, value]) => String(value ?? '').trim() !== ''));
    setLoading(true); setError(null); setResult(null); setShowTable(false);
    try {
      const data = await getResourceData(resource, cleanFilters, { signal: controller.signal });
      if (!controller.signal.aborted) setResult(data);
    } catch (err) { if (err.name !== 'AbortError') setError(err); }
    finally { if (requestRef.current === controller) setLoading(false); }
  };
  const analytics = result?.analytics;
  const byState = (analytics?.byState || []).map(item => ({ ...item, name: stateDisplayName(item.name) }));
  const byYear = analytics?.byYear || [];
  const byCategory = analytics?.byCategory?.length ? analytics.byCategory : analytics?.byImmunobiological || [];
  const rows = recordsFrom(result);
  const seriesLabel = analytics?.measureLabel || 'Registros na página';
  const sumByState = byState.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  const leadingState = byState[0];
  const leadingCategory = byCategory[0];
  const stateShare = leadingState && sumByState ? Math.round((Number(leadingState.value) / sumByState) * 100) : null;
  const resourceOptions = [
    ['dengue', 'Dengue'], ['zika', 'Zika'], ['chikungunya', 'Chikungunya'],
    ['vaccination2025', 'Vacinação · 2025'], ['vaccination2026', 'Vacinação · 2026'],
    ['hospitalsBeds', 'Hospitais e leitos']
  ];
  const chartTabs = [
    ['territory', 'Território', Globe2], ['time', 'Série temporal', Activity], ['composition', 'Composição', BarChart3]
  ];
  const palette = ['#147b94', '#39a6a2', '#70bfaa', '#81a9ca', '#d3a45f', '#8d91bd', '#4d7797'];
  const chartUnavailable = activeView === 'territory' ? !byState.length : activeView === 'time' ? !byYear.length : !byCategory.length;
  const chartEmptyMessage = activeView === 'territory'
    ? 'A fonte não trouxe uma UF reconhecível nos registros desta página.'
    : activeView === 'time'
      ? 'A fonte não disponibilizou um campo de ano para construir a série temporal.'
      : 'A fonte não disponibilizou categorias ou imunobiológicos reconhecíveis neste recorte.';
  const printReport = () => window.print();
  return <div className="infographic-page">
    <PageHeading eyebrow="INTELIGÊNCIA ANALÍTICA · DADOS OFICIAIS" title="Infográfico de saúde pública" description="Transforme uma consulta real em uma leitura visual clara. Escolha a base, aplique filtros e explore os resultados por território, período ou composição." right={<button className="btn-outline-custom" type="button" onClick={printReport} disabled={!result}><Download size={14} /> Imprimir relatório</button>} />
    <section className="infographic-query-panel">
      <div className="infographic-query-title"><span className="infographic-query-icon"><SlidersHorizontal size={18} /></span><div><b>Monte seu recorte</b><small>Todos os filtros são opcionais. O painel só apresenta dados depois de consultar a fonte.</small></div></div>
      <div className="infographic-query-controls">
        <div className="field-wrap"><label htmlFor="infographic-resource">Conjunto de dados</label><select id="infographic-resource" className="form-select" value={resource} onChange={event => setResource(event.target.value)}>{resourceOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
        {splitQueryFields(resource, schema).basic.map(parameter => <QueryField key={parameter.name} parameter={parameter} value={params[parameter.name] || ''} onChange={(name, value) => setParams(previous => ({ ...previous, [name]: value }))} />)}
        <button type="button" className="btn-primary-custom" onClick={run} disabled={loading || !schema}>{loading ? <><span className="spinner-border spinner-border-sm" /> Consultando…</> : <><Search size={15} /> Gerar infográfico</>}</button>
        <button type="button" className="btn-outline-custom" onClick={() => { setParams({}); setResult(null); setError(null); setShowTable(false); }}><RefreshCw size={14} /> Limpar</button>
      </div>
      {splitQueryFields(resource, schema).advanced.length > 0 && <details className="infographic-advanced"><summary><Filter size={14} /> Filtros adicionais <span>{splitQueryFields(resource, schema).advanced.length} opcionais</span></summary><div className="infographic-advanced-grid">{splitQueryFields(resource, schema).advanced.map(parameter => <QueryField key={parameter.name} parameter={parameter} value={params[parameter.name] || ''} onChange={(name, value) => setParams(previous => ({ ...previous, [name]: value }))} />)}</div></details>}
    </section>
    {error && <ErrorPanel error={error} onRetry={run} />}
    {!result && !loading && !error && <section className="infographic-welcome"><div className="infographic-welcome-mark"><img src="/healthdata-logo-mark.webp" alt="" /></div><div><span className="eyebrow">LEITURA VISUAL, SEM DADOS FICTÍCIOS</span><h2>Seu painel começa com uma consulta.</h2><p>Selecione uma base e clique em <b>Gerar infográfico</b>. Os números, gráficos e destaques serão montados a partir da resposta oficial recebida.</p></div></section>}
    {loading && <section className="infographic-loading"><Loading label="Organizando os dados oficiais em gráficos e indicadores…" /></section>}
    {result && <>
      <div className="infographic-provenance"><span><CheckCircle2 size={14} /> Fonte consultada</span><b>{result.source?.label || resource}</b><span>Referência: {result.source?.competence || 'não informada'}</span><span>Atualizado em: {formatDate(result.fetchedAt)}</span><span>{result.cache?.hit ? 'Resposta em cache' : 'Consulta à fonte'}</span></div>
      {result.warning && <div className="cache-warning"><AlertCircle size={15} /> {result.warning}</div>}
      {result.privacy?.note && <div className="methodology-warning"><ShieldCheck size={16} /><span>{result.privacy.note}</span></div>}
      <section className="infographic-kpi-grid" aria-label="Indicadores do recorte consultado">
        <article className="infographic-kpi infographic-kpi-primary"><span>Registros nesta página</span><strong>{formatNumber(rows.length)}</strong><small>{analytics?.totalRecordsReported !== null && analytics?.totalRecordsReported !== undefined ? `${formatNumber(analytics.totalRecordsReported)} registros informados pela fonte` : 'Contagem da resposta atual, sem total nacional confirmado'}</small></article>
        <article className="infographic-kpi"><span>{seriesLabel}</span><strong>{analytics?.totalMeasureInPage === null || analytics?.totalMeasureInPage === undefined ? '—' : formatNumber(analytics.totalMeasureInPage)}</strong><small>{analytics?.totalMeasureInPage === null || analytics?.totalMeasureInPage === undefined ? 'A fonte não informou uma medida somável' : 'Soma calculada somente nos registros desta página'}</small></article>
        <article className="infographic-kpi"><span>UFs identificadas</span><strong>{formatNumber(byState.length)}</strong><small>Na distribuição territorial retornada</small></article>
        <article className="infographic-kpi"><span>Categorias identificadas</span><strong>{formatNumber(byCategory.length)}</strong><small>{analytics?.byImmunobiological?.length && !analytics?.byCategory?.length ? 'Imunobiológicos reconhecidos' : 'Na composição do recorte atual'}</small></article>
      </section>
      <section className="infographic-story-grid">
        <article className="infographic-story-card"><span className="eyebrow">DESTAQUE DO RECORTE</span><div className="infographic-story-value">{leadingState?.name || '—'}</div><p>{leadingState ? `Maior participação na distribuição territorial apresentada: ${formatNumber(leadingState.value)} registros/pesos na página${stateShare !== null ? ` (${stateShare}% da distribuição por UF)` : ''}.` : 'A resposta atual não possui informação territorial suficiente para destacar uma UF.'}</p></article>
        <article className="infographic-story-card infographic-story-secondary"><span className="eyebrow">COMPOSIÇÃO EM DESTAQUE</span><div className="infographic-story-value">{leadingCategory?.name || '—'}</div><p>{leadingCategory ? `Categoria com maior valor no conjunto exibido: ${formatNumber(leadingCategory.value)}. A leitura se limita à página consultada.` : 'Nenhuma categoria foi reconhecida na resposta atual.'}</p></article>
        <article className="infographic-method-card"><ShieldCheck size={19} /><div><b>Como ler estes números</b><p>Este infográfico descreve somente o recorte devolvido pela fonte. Não representa automaticamente totais nacionais, incidência, cobertura vacinal ou risco populacional.</p></div></article>
      </section>
      <section className="infographic-visual-panel">
        <div className="infographic-visual-heading"><div><span className="eyebrow">EXPLORAÇÃO VISUAL</span><h2>Veja os dados por outra perspectiva</h2><p>Alterne a visualização. Os gráficos mudam com a base e os filtros selecionados.</p></div><span className="infographic-live-tag"><i /> DADOS DA CONSULTA</span></div>
        <div className="infographic-tabs" role="tablist" aria-label="Tipo de visualização">
          {chartTabs.map(([key, label, Icon]) => <button key={key} type="button" role="tab" aria-selected={activeView === key} className={activeView === key ? 'active' : ''} onClick={() => setActiveView(key)}><Icon size={15} /> {label}</button>)}
        </div>
        <div className="infographic-chart-wrap">
          {chartUnavailable ? <div className="infographic-chart-empty"><BarChart3 size={25} /><b>Visualização indisponível para este recorte</b><span>{chartEmptyMessage}</span></div> : activeView === 'territory' ? <ResponsiveContainer width="100%" height={350}><BarChart data={byState.slice(0, 15)} layout="vertical" margin={{ top: 8, right: 24, bottom: 6, left: 8 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={value => new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value)} /><YAxis type="category" dataKey="name" width={142} tick={{ fontSize: 10 }} /><Tooltip formatter={value => formatNumber(value)} labelStyle={{ color: '#17364a' }} /><Bar dataKey="value" name={seriesLabel} fill="#177b94" radius={[0, 7, 7, 0]} maxBarSize={20} /></BarChart></ResponsiveContainer> : activeView === 'time' ? <ResponsiveContainer width="100%" height={350}><AreaChart data={byYear} margin={{ top: 10, right: 18, bottom: 8, left: 4 }}><defs><linearGradient id="infographicTimeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1a94a8" stopOpacity={0.28} /><stop offset="95%" stopColor="#1a94a8" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tickFormatter={value => new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value)} tick={{ fontSize: 10 }} /><Tooltip formatter={value => formatNumber(value)} /><Area type="monotone" dataKey="value" name={seriesLabel} stroke="#177b94" strokeWidth={3} fill="url(#infographicTimeFill)" activeDot={{ r: 6 }} /></AreaChart></ResponsiveContainer> : <div className="infographic-composition-layout"><div className="infographic-donut"><ResponsiveContainer width="100%" height={320}><RechartsPieChart><Pie data={byCategory.slice(0, 8)} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={72} outerRadius={116} paddingAngle={2} labelLine={false}>{byCategory.slice(0, 8).map((item, index) => <Cell key={`${item.name}-${index}`} fill={palette[index % palette.length]} />)}</Pie><Tooltip formatter={value => formatNumber(value)} /></RechartsPieChart></ResponsiveContainer></div><div className="infographic-category-legend">{byCategory.slice(0, 8).map((item, index) => <div key={`${item.name}-${index}`}><i style={{ background: palette[index % palette.length] }} /><span>{item.name}</span><b>{formatNumber(item.value)}</b></div>)}</div></div>}
        </div>
        <div className="infographic-chart-footnote">{analytics?.note || 'Valores calculados a partir da resposta atual.'} Os gráficos respeitam os campos disponíveis na fonte e as regras de privacidade da plataforma.</div>
      </section>
      <div className="infographic-actions"><button type="button" className="btn-outline-custom" onClick={() => setShowTable(value => !value)}><ClipboardList size={14} /> {showTable ? 'Ocultar tabela de dados' : 'Ver tabela de dados'}</button><button type="button" className="btn-outline-custom" onClick={() => downloadCsv(rows, 'healthdata-infografico.csv', { 'Fonte': result.source?.label, 'Referência': result.source?.competence, 'Consultado em': result.fetchedAt, 'Nota': analytics?.note })}><Download size={14} /> Exportar dados CSV</button><button type="button" className="btn-primary-custom" onClick={printReport}><Download size={14} /> Imprimir / salvar PDF</button></div>
      {showTable && <section className="infographic-table-panel"><div className="table-heading"><b>Registros que originaram as visualizações</b><span>{formatNumber(rows.length)} linhas nesta página</span></div>{rows.length ? <DataTable rows={rows.slice(0, 100)} /> : <div className="infographic-chart-empty">A fonte não retornou linhas para exibição.</div>}</section>}
      {result.privacy?.suppressedGroups > 0 && <div className="methodology-warning"><ShieldCheck size={16} /><span>{formatNumber(result.privacy.suppressedGroups)} grupos foram omitidos por regra de privacidade. Nenhum valor foi reconstruído ou estimado.</span></div>}
    </>}
  </div>;
}

function SourcesPage() {
  const [status, setStatus] = useState(null);
  const [sources, setSources] = useState([]);
  const [restrictedSources, setRestrictedSources] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = () => {
    setLoading(true); setError('');
    Promise.all([getSourceStatus(), getSources()]).then(([sourceStatus, list]) => { setStatus(sourceStatus); setSources(list.resources || []); setRestrictedSources(list.restricted || []); }).catch(err => setError(err.message)).finally(() => setLoading(false));
  };
  useEffect(refresh, []);
  const byGroup = useMemo(() => sources.reduce((groups, item) => { (groups[item.group] ||= []).push(item); return groups; }, {}), [sources]);
  return <><PageHeading eyebrow="RASTREABILIDADE E CONFIANÇA" title="Fontes e metodologia" description="Documentação, cobertura, atualização e limitações das fontes que alimentam a plataforma." right={<button className="btn-outline-custom" onClick={refresh}><RefreshCw size={14} /> Atualizar verificação</button>} />
    <div className="source-status-banner"><div className="source-status-icon"><Database size={22} /></div><div><b>API de Dados Abertos — DEMAS</b><span>{status?.title || 'Ministério da Saúde'} · versão {status?.version || '—'}</span></div><div className="ms-auto"><StatusPill status={status?.swagger} /><small>Verificado em {formatDate(status?.checkedAt)}</small></div></div>
    {error && <ErrorPanel error={{ message: error }} onRetry={refresh} />}{loading && <Loading label="Verificando documentação oficial…" />}
    <section className="methodology-grid"><div className="methodology-card"><span className="method-icon"><Database size={18} /></span><h3>Origem dos dados</h3><p>API pública de Dados Abertos do Ministério da Saúde (DEMAS), com documentação Swagger/OAS. Os endpoints são revalidados na documentação antes de cada tipo de consulta.</p><a href="https://apidadosabertos.saude.gov.br/" target="_blank" rel="noreferrer">Abrir documentação da API <ExternalLink size={13} /></a></div><div className="methodology-card"><span className="method-icon"><MapPinned size={18} /></span><h3>Cartografia</h3><p>{googleMapsConfigured ? 'Google Maps Platform com modos de ruas, satélite, híbrido e visualização 3D; as camadas epidemiológicas usam malhas oficiais do IBGE.' : 'Mapa alternativo baseado em OpenStreetMap. Google Maps pode ser ativado com uma chave restrita por domínio na Vercel; não é necessário criar arquivo .env.'} Marcadores aparecem exclusivamente quando a resposta contém latitude e longitude dentro da área geográfica brasileira.</p><a href={googleMapsConfigured ? "https://developers.google.com/maps/documentation/javascript/overview" : "https://console.cloud.google.com/google/maps-apis/credentials"} target="_blank" rel="noreferrer">{googleMapsConfigured ? 'Documentação do Google Maps' : 'Configurar Google Maps'} <ExternalLink size={13} /></a></div><div className="methodology-card"><span className="method-icon"><ShieldCheck size={18} /></span><h3>LGPD e dados sensíveis</h3><p>Não integramos registros individuais do e-SUS Notifica ao mapa público. CPF, CNS, nomes, contatos, endereços e sintomas de pacientes não são exibidos nem persistidos nesta plataforma.</p><a href="https://www.gov.br/esocial/pt-br/acesso-a-informacao/lgpd" target="_blank" rel="noreferrer">Referência LGPD <ExternalLink size={13} /></a></div></section>
    <section className="catalog-section"><div className="section-title-row"><div><span className="eyebrow">CATÁLOGO VALIDADO</span><h2>Operações configuradas</h2><p>Lista derivada do catálogo DEMAS; cada operação precisa existir no Swagger atual para ser chamada.</p></div><span className="catalog-count">{sources.length} fontes</span></div>
      {Object.entries(byGroup).map(([group, items]) => <div className="catalog-group" key={group}><h3>{group}</h3><div className="catalog-list">{items.map(item => <div className="catalog-item" key={item.id}><div><b>{item.label}</b><small>{item.description}</small><code>GET {item.path}</code></div><span className="catalog-ready"><CheckCircle2 size={14} /> Configurada · validar ao consultar</span></div>)}</div></div>)}
    </section>
    <section className="catalog-section restricted-catalog"><div className="section-title-row"><div><span className="eyebrow">REVISÃO DE ACESSO E PRIVACIDADE</span><h2>Fontes não liberadas para consulta pública</h2><p>Existem no catálogo oficial, mas permanecem bloqueadas até revisão de dados, finalidade e autorização.</p></div><span className="catalog-count">{restrictedSources.length} pendências</span></div>{restrictedSources.map(item => <div className="catalog-item" key={item.id}><div><b>{item.label}</b><small>{item.reason}</small><code>GET {item.path}</code></div><span className="status-pill status-warning">Em revisão</span></div>)}</section>
    <div className="methodology-warning"><AlertCircle size={18} /><div><b>Como interpretar os resultados</b><p>A atualização não é necessariamente em tempo real. Use a competência ou data de referência informada pelo conjunto de dados; consulte os metadados originais antes de comparar períodos. A ausência de um campo no payload não pode ser tratada como zero.</p></div></div>
  </>;
}

function SavedQueriesPage({ user, onOpenAuth }) {
  const navigate = useNavigate();
  const [items, setItems] = useState({ favorites: [], filters: [], history: [], mapViews: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const reload = useCallback(async () => {
    if (!user || !supabase) return;
    setLoading(true); setError('');
    const [favorites, filters, history, mapViews] = await Promise.all([
      supabase.from('favorite_searches').select('id,name,source_key,filters,created_at').order('created_at', { ascending: false }).limit(100),
      supabase.from('saved_filters').select('id,name,source_key,filters,created_at,updated_at').order('updated_at', { ascending: false }).limit(100),
      supabase.from('search_history').select('id,source_key,filters,result_count,created_at').order('created_at', { ascending: false }).limit(100),
      supabase.from('saved_map_views').select('id,name,center_lat,center_lng,zoom,layers,filters,created_at').order('created_at', { ascending: false }).limit(100)
    ]);
    const issue = favorites.error || filters.error || history.error || mapViews.error;
    if (issue) setError(issue.message);
    else setItems({ favorites: favorites.data || [], filters: filters.data || [], history: history.data || [], mapViews: mapViews.data || [] });
    setLoading(false);
  }, [user?.id]);
  useEffect(() => { reload(); }, [reload]);
  const destination = source => ['vaccination2025', 'vaccination2026'].includes(source) ? '/vacinacao' : ['dengue', 'zika', 'chikungunya'].includes(source) ? '/epidemiologia' : '/rede';
  const reopen = item => navigate(`${destination(item.source_key)}?source=${encodeURIComponent(item.source_key)}&filters=${encodeURIComponent(JSON.stringify(item.filters || {}))}&execute=1`);
  const rename = async (table, item) => {
    const nextName = window.prompt('Novo nome:', item.name || item.source_key);
    if (!nextName?.trim()) return;
    const { error: updateError } = await supabase.from(table).update({ name: nextName.trim().slice(0, 120) }).eq('id', item.id).eq('user_id', user.id);
    if (updateError) setMessage(updateError.message);
    else { setMessage('Nome atualizado.'); reload(); }
  };
  const remove = async (table, id) => {
    const { error: deleteError } = await supabase.from(table).delete().eq('id', id).eq('user_id', user.id);
    if (deleteError) setMessage(deleteError.message);
    else { setMessage('Registro removido da sua conta.'); reload(); }
  };
  if (!user) return <><PageHeading eyebrow="PREFERÊNCIAS PESSOAIS" title="Consultas salvas" description="Seus favoritos, filtros reutilizáveis e histórico de consultas." /><div className="empty-state"><HeartPulse size={25} /><b>Entre na sua conta para acessar seus registros</b><span>Os dados são isolados por usuário no banco, conforme as políticas RLS.</span><button className="btn-primary-custom" onClick={onOpenAuth}>Acessar conta</button></div></>;
  if (!supabase) return <div className="empty-state"><Database size={25} /><b>Supabase ainda não configurado</b><span>A persistência de favoritos e histórico depende de um projeto Supabase conectado.</span></div>;
  const section = (title, rows, table, history = false) => <section className="saved-list-section"><div className="section-title-row"><h2>{title}</h2><span>{rows.length} itens</span></div>{rows.length ? rows.map(item => <div className="saved-query-item" key={item.id}><div><b>{item.name || item.source_key}</b><small>{item.source_key} · {formatDate(item.created_at)}{history ? ` · ${item.result_count} linhas na resposta` : ''}</small><code>{JSON.stringify(item.filters || {})}</code></div><div>{!history && <button className="btn-outline-custom" onClick={() => rename(table, item)}>Renomear</button>}<button className="btn-outline-custom" onClick={() => reopen(item)}>Reabrir</button><button className="btn-outline-custom" onClick={() => remove(table, item.id)}>Excluir</button></div></div>) : <p className="text-secondary">Nenhum registro salvo.</p>}</section>;
  const openMapView = item => {
    const stored = item.filters && typeof item.filters === 'object' ? item.filters : {};
    const source = stored.resource || 'cnesEstablishments';
    const query = stored.query && typeof stored.query === 'object' ? stored.query : stored;
    const search = new URLSearchParams({ mapview: item.id, source, filters: JSON.stringify(query), execute: '1' });
    navigate(`/mapa?${search.toString()}`);
  };
  const mapViewsSection = <section className="saved-list-section"><div className="section-title-row"><h2>Visualizações do mapa</h2><span>{items.mapViews.length} itens</span></div>{items.mapViews.length ? items.mapViews.map(item => <div className="saved-query-item" key={item.id}><div><b>{item.name}</b><small>{formatDate(item.created_at)} · Zoom {item.zoom ?? '—'} · Centro {Number(item.center_lat).toFixed(3)}, {Number(item.center_lng).toFixed(3)}</small><code>Camadas: {JSON.stringify(item.layers || [])}</code></div><div><button className="btn-outline-custom" onClick={() => openMapView(item)}>Abrir mapa</button><button className="btn-outline-custom" onClick={() => remove('saved_map_views', item.id)}>Excluir</button></div></div>) : <p className="text-secondary">Nenhuma visualização salva.</p>}</section>;
  return <><PageHeading eyebrow="PREFERÊNCIAS PESSOAIS" title="Consultas salvas" description="Gerencie favoritos, filtros reutilizáveis e histórico. Cada registro pertence à sua conta." right={<button className="btn-outline-custom" onClick={reload}><RefreshCw size={14} /> Atualizar</button>} />
    {loading && <Loading label="Carregando seus registros…" />}{error && <ErrorPanel error={{ message: error }} onRetry={reload} />}{message && <div className="save-feedback">{message}</div>}
    {section('Favoritos', items.favorites, 'favorite_searches')}{section('Filtros salvos', items.filters, 'saved_filters')}{mapViewsSection}{section('Histórico de consultas', items.history, 'search_history', true)}
  </>;
}

function AuthDialog({ user, onClose }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const submit = async event => {
    event.preventDefault(); setLoading(true); setMessage('');
    if (!supabase) { setMessage('Supabase não configurado. Defina as variáveis públicas do projeto.'); setLoading(false); return; }
    try {
      let result;
      if (mode === 'login') result = await supabase.auth.signInWithPassword({ email, password });
      else if (mode === 'signup') result = await supabase.auth.signUp({ email, password });
      else result = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      setMessage(result?.error?.message || (mode === 'login' ? 'Login realizado.' : mode === 'signup' ? 'Cadastro iniciado. Confira seu e-mail se a confirmação estiver habilitada.' : 'Instruções de recuperação enviadas, caso o endereço esteja cadastrado.'));
      if (!result?.error && mode === 'login') window.setTimeout(onClose, 500);
    } catch (error) { setMessage(error.message || 'Não foi possível concluir a operação de autenticação.'); }
    finally { setLoading(false); }
  };
  const logout = async () => { if (supabase) await supabase.auth.signOut(); onClose(); };
  const title = mode === 'login' ? 'Acesse sua conta' : mode === 'signup' ? 'Criar conta' : 'Recuperar acesso';
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}><div className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title"><div className="auth-brand-lockup"><img src="/healthdata-logo-lockup.webp" alt="HealthData Brasil — Dados em saúde. Um Brasil mais informado." /></div><button className="dialog-close" onClick={onClose} aria-label="Fechar"><X size={18} /></button>{user ? <><span className="auth-icon"><Users size={22} /></span><h2 id="auth-title">Sua conta</h2><p className="auth-subtitle">Sessão conectada como {user.email}.</p><button className="btn-outline-custom w-100 justify-content-center" onClick={logout}><LogOut size={15} /> Sair da conta</button></> : <><span className="auth-icon"><ShieldCheck size={22} /></span><h2 id="auth-title">{title}</h2><p className="auth-subtitle">Salve filtros e consultas para continuar sua análise depois.</p><form onSubmit={submit}><div className="field-wrap"><label htmlFor="auth-email">E-mail</label><input id="auth-email" type="email" className="form-control" required value={email} onChange={event => setEmail(event.target.value)} /></div>{mode !== 'reset' && <div className="field-wrap"><label htmlFor="auth-password">Senha</label><input id="auth-password" type="password" minLength="8" className="form-control" required value={password} onChange={event => setPassword(event.target.value)} /></div>}<button className="btn-primary-custom w-100 justify-content-center" disabled={loading}>{loading ? <span className="spinner-border spinner-border-sm" /> : <LogIn size={15} />}{mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Cadastrar' : 'Enviar instruções'}</button></form><div className="auth-mode-links"><button className="auth-mode-toggle" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(''); }}>{mode === 'login' ? 'Ainda não tem conta? Criar acesso' : 'Voltar para entrar'}</button>{mode === 'login' && <button className="auth-mode-toggle" onClick={() => { setMode('reset'); setMessage(''); }}>Esqueci minha senha</button>}</div></>}{message && <div className="auth-message" role="status">{message}</div>}{!authReady && <small className="auth-config-note">Autenticação aguardando as variáveis públicas do Supabase.</small>}</div></div>;
}
function NotFound() { return <div className="empty-state not-found"><CircleHelp size={30} /><b>Página não encontrada</b><Link to="/">Voltar ao início <ArrowRight size={14} /></Link></div>; }

export default App;
