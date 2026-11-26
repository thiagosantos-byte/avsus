/**
 * Catálogo público habilitado. Os caminhos são conferidos contra o Swagger
 * oficial antes de cada operação. Recursos com microdados sensíveis ficam no
 * catálogo de pendências e não podem ser consultados pela API pública.
 */
export const RESOURCES = {
  cnesEstablishments: {
    label: 'Estabelecimentos CNES', group: 'Rede de saúde', profile: 'facilities',
    path: '/cnes/estabelecimentos',
    description: 'Diretório oficial CNES com dados cadastrais, territoriais e coordenadas dos estabelecimentos.',
    dataReference: 'Data de atualização informada pela fonte em data_atualizacao. O Swagger atual não documenta nu_comp nesta operação.'
  },
  cnesDirectory: {
    label: 'Diretório CNES — estabelecimentos', group: 'Rede de saúde', profile: 'facilities',
    path: '/cnes/estabelecimentos',
    description: 'Consulta geral do diretório CNES. O limite por página é definido no Swagger desta operação.'
  },
  cnesLookup: {
    label: 'Consulta por código CNES', group: 'Rede de saúde', profile: 'facilities',
    path: '/cnes/estabelecimentos/{codigo_cnes}',
    description: 'Consulta cadastral de estabelecimento por código CNES.'
  },
  tiposUnidade: {
    label: 'Tipos de unidade', group: 'Rede de saúde', profile: 'unitTypes',
    path: '/cnes/tipounidades', description: 'Catálogo oficial de tipos de unidade.'
  },
  ubs: {
    label: 'Unidades Básicas de Saúde', group: 'Rede de saúde', profile: 'facilities',
    path: '/assistencia-a-saude/unidade-basicas-de-saude',
    description: 'Relação de UBS cadastradas no CNES.'
  },
  hospitalsBeds: {
    label: 'Hospitais e leitos', group: 'Rede de saúde', profile: 'facilities',
    path: '/assistencia-a-saude/hospitais-e-leitos',
    description: 'Informações de hospitais e quantitativos de leitos. Dados de contato de pessoas físicas não são expostos.'
  },
  cnesBeds: {
    label: 'Leitos CNES', group: 'Rede de saúde', profile: 'facilities',
    path: '/assistencia-a-saude/cnes-leitos', description: 'Quantitativos de leitos por estabelecimento e tipo.'
  },
  cnesEquipment: {
    label: 'Equipamentos CNES', group: 'Rede de saúde', profile: 'facilities',
    path: '/assistencia-a-saude/cnes-equipamentos', description: 'Equipamentos de saúde cadastrados por estabelecimento.'
  },
  dengue: {
    label: 'Dengue', group: 'Arboviroses', profile: 'arbovirus',
    path: '/arboviroses/dengue', safeQueryFields: ['nu_ano', 'id_municip'],
    description: 'Registros de notificação de dengue por ano e município. A contagem da plataforma é da página consultada, não total nacional.'
  },
  zika: {
    label: 'Zika', group: 'Arboviroses', profile: 'arbovirus',
    path: '/arboviroses/zikavirus', safeQueryFields: ['nu_ano', 'id_municip'],
    description: 'Registros de notificação de Zika por ano e município.'
  },
  chikungunya: {
    label: 'Chikungunya', group: 'Arboviroses', profile: 'arbovirus',
    path: '/arboviroses/chikungunya', safeQueryFields: ['nu_ano', 'id_municip'],
    description: 'Registros de notificação de chikungunya por ano e município.'
  },
  vaccination2025: {
    label: 'Doses aplicadas PNI — 2025', group: 'Vacinação', profile: 'vaccination',
    path: '/vacinacao/doses-aplicadas-pni-2025',
    description: 'Registros de doses aplicadas do PNI em 2025. A plataforma não calcula cobertura sem denominador compatível.'
  },
  vaccination2026: {
    label: 'Doses aplicadas PNI — 2026', group: 'Vacinação', profile: 'vaccination',
    path: '/vacinacao/doses-aplicadas-pni-2026',
    description: 'Registros de doses aplicadas do PNI em 2026. A plataforma não calcula cobertura sem denominador compatível.'
  }
};

/**
 * Endpoints existentes no Swagger, mas bloqueados de consulta pública até a
 * revisão de esquema, finalidade, autorização e risco de identificação.
 * Permanecem visíveis no catálogo de fontes para transparência.
 */
export const RESTRICTED_RESOURCES = [
  { id: 'yellowFever', label: 'Febre amarela', group: 'Arboviroses', path: '/arboviroses/febre-amarela-humanos-primatas-nao-humanos', status: 'review_required', reason: 'Revisão dos campos de notificação necessária antes de liberar consulta e exportação.' },
  { id: 'esavi', label: 'ESAVI', group: 'Vacinação', path: '/vacinacao/esavi', status: 'review_required', reason: 'O Swagger não define um esquema de resposta suficiente para excluir dados pessoais/clínicos.' },
  { id: 'sim', label: 'Sistema de Informação sobre Mortalidade (SIM)', group: 'Vigilância', path: '/vigilancia-e-meio-ambiente/sistema-de-informacao-sobre-mortalidade', status: 'review_required', reason: 'Base de registros individuais; requer análise dos campos e de agregação segura.' },
  { id: 'sinasc', label: 'Sistema de Informação sobre Nascidos Vivos (SINASC)', group: 'Vigilância', path: '/vigilancia-e-meio-ambiente/sistema-de-informacao-sobre-nascidos-vivos', status: 'review_required', reason: 'Base de registros de nascimento; requer análise de campos e risco de reidentificação.' },
  { id: 'sg2021', label: 'Síndrome gripal — 2021', group: 'Vigilância', path: '/vigilancia-e-meio-ambiente/notificacoes-de-sindrome-gripal-leve-2021', status: 'review_required', reason: 'Base derivada do e-SUS Notifica; não liberar microdados por consulta pública.' },
  { id: 'sg2022', label: 'Síndrome gripal — 2022', group: 'Vigilância', path: '/vigilancia-e-meio-ambiente/notificacoes-de-sindrome-gripal-leve-2022', status: 'review_required', reason: 'Base derivada do e-SUS Notifica; não liberar microdados por consulta pública.' },
  { id: 'sg2023', label: 'Síndrome gripal — 2023', group: 'Vigilância', path: '/vigilancia-e-meio-ambiente/notificacoes-de-sindrome-gripal-leve-2023', status: 'review_required', reason: 'Base derivada do e-SUS Notifica; não liberar microdados por consulta pública.' },
  { id: 'sg2024', label: 'Síndrome gripal — 2024', group: 'Vigilância', path: '/vigilancia-e-meio-ambiente/notificacoes-de-sindrome-gripal-leve-2024', status: 'review_required', reason: 'Base derivada do e-SUS Notifica; não liberar microdados por consulta pública.' },
  { id: 'srag2019_2026', label: 'SRAG — 2019 a 2026', group: 'Vigilância', path: '/vigilancia-e-meio-ambiente/srag-2019-2026', status: 'review_required', reason: 'A descrição do Swagger inclui perfil do paciente, sinais, sintomas, fatores de risco e dados de hospitalização.' },
  { id: 'sinanMpox', label: 'e-SUS Sinan — Mpox', group: 'Vigilância', path: '/vigilancia-e-meio-ambiente/mpox', status: 'review_required', reason: 'O endpoint descreve microdados de notificação; revisão de campos e acesso necessária.' },
  { id: 'sinanHanseniase', label: 'SINAN — Hanseníase', group: 'Vigilância', path: '/vigilancia-e-meio-ambiente/sinan-hanseniase', status: 'review_required', reason: 'O endpoint descreve microdados demográficos, clínicos e epidemiológicos.' }
];

export const RESOURCE_GROUPS = [...new Set(Object.values(RESOURCES).map(item => item.group))];
