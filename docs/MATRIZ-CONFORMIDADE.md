# Matriz de conformidade — HealthData Brasil

**Atualizada em:** 25/11/2026  
**Escopo da validação:** cópia local de trabalho do projeto existente. Nenhum banco Supabase, repositório GitHub ou projeto Vercel foi alterado ou publicado nesta execução.

Estados usados:
- **CONCLUÍDO:** implementado e validado por teste executado.
- **PARCIAL:** parte da funcionalidade implementada, mas faltam escopo, integração ou validação.
- **PENDENTE:** ainda não implementado.
- **BLOQUEADO:** depende de permissão, credencial ou serviço externo não disponível.

| Requisito | Situação atual | Correção/implementação nesta revisão | Teste de validação |
|---|---|---|---|
| Catálogo DEMAS/Swagger | PARCIAL | O backend resolve caminho e parâmetros no Swagger em tempo de execução; catálogo ativo e restrito documentado. | Testes unitários de paginação/privacidade; consulta viva depende de DNS/serviço. |
| CNES assistência | PARCIAL | Mantido `/assistencia-a-saude/cnes-estabelecimentos`; `limit` por operação extraído do Swagger. | Teste de parser; não foi possível chamar a API de dentro deste ambiente. |
| Diretório CNES | PARCIAL | Incluído `/cnes/estabelecimentos`, com limite documentado de 20 por página. | Parser de máximo; chamada de integração pendente. |
| UBS, hospitais, leitos e equipamentos | PARCIAL | Preservados no catálogo; allowlist de campos e paginação dinâmica. | Testes unitários de sanitização; chamada upstream pendente. |
| Dengue, Zika e chikungunya | PARCIAL | Consulta pública restrita a campos territoriais/temporais e agregação por ano/município; grupos abaixo do limiar são suprimidos. | Teste de privacidade, agregação e distinção entre registros consultados e incidência aprovado. |
| Febre amarela | BLOQUEADO | Mantida em revisão até validar semântica (humano/primata), campos e agregação adequados. | Sem consulta pública; requer revisão de esquema. |
| PNI 2025/2026 | PARCIAL | Allowlist e agregação; cobertura não calculada sem denominador. | Sanitização coberta por teste básico; esquema/quantidade precisa validação upstream. |
| ESAVI | BLOQUEADO | Endpoint identificado, mas consulta pública bloqueada até validar campos e risco. | Não consultado. |
| SIM, SINASC, síndrome gripal, SRAG, SINAN | BLOQUEADO | Rotas identificadas no Swagger e mantidas no catálogo restrito por conterem ou poderem conter microdados pessoais/clínicos. | Revisão de campos/autorização pendente. |
| Paginação | PARCIAL | Navegação por página somente quando a operação documenta `offset`; `limit` máximo lido por endpoint do Swagger. Operações sem deslocamento não recebem `offset` inventado nem exibem controles inoperantes. | Testes unitários de máximo, metadados e ausência de `offset` aprovados; consultas upstream pendentes. |
| Normalização | PARCIAL | Extração de envelopes comuns e normalização para gráficos/mapa; metadados de fonte/consulta preservados. | Testes unitários de envelopes e coordenadas aprovados; validação de todos os esquemas pendente. |
| Dashboard | PARCIAL | Consulta real e indicadores restritos ao escopo/página consultada; gráficos de ano e UF com campos reconhecidos. | Teste unitário de analytics aprovado; métricas nacionais completas pendentes. |
| Mapa de estabelecimentos | PARCIAL | Leaflet/OSM, markercluster, heatmap de densidade de unidades, coordenadas válidas, geolocalização e tela cheia. | JSX transpila; não houve teste de navegador nem feed real da API. |
| Mapa coroplético estadual | PARCIAL | Malha GeoJSON do IBGE com agregação por UF; consulta nacional com fallback para endpoints por código de UF (sem rota inválida /estados sem identificador). | Código e integração implementados; download do IBGE não pôde ser validado por DNS nesta sessão. |
| Mapa coroplético municipal | PARCIAL | Consulta controlada de até 25 malhas municipais IBGE por códigos presentes na página atual. | Implementação de rota e visualização; sem teste de rede/navegador. Não equivale a um mapa nacional completo. |
| Heatmap epidemiológico | PARCIAL | Camada epidemiológica agregada por centroide de UF, em separado do heatmap de estabelecimentos. | Código implementado; precisa validação cartográfica visual. |
| Geocodificação de endereços | PENDENTE | Não foi adicionada geocodificação automática para evitar inventar coordenadas ou gerar volume sem controle. | Não aplicável nesta revisão. |
| Visualização 3D | PENDENTE | Adiada até mapas 2D e geometrias serem validados; não há relevo/edificações simulados. | Não aplicável nesta revisão. |
| Backend REST | PARCIAL | Rotas específicas `/api/overview`, `/api/estabelecimentos`, `/api/map/points`, `/api/indicadores/*`, `/api/geo/*`; erros padronizados, retry, cache e rate limit. Contratos verificados com testes puros de normalização, paginação, privacidade e status. | `npm run check` aprovado; sem testes HTTP de integração neste ambiente. |
| CORS | PARCIAL | Allowlist explícita `CORS_ORIGINS`, sem wildcard de Vercel; origem não autorizada retorna 403. | Revisão estática; teste HTTP em runtime pendente. |
| Monitoramento de status | PARCIAL | Swagger + operação GET real; 401/403/404 não são classificados como disponível. | Revisão estática; chamada ao endpoint bloqueada pelo DNS da sessão. |
| Supabase Auth | PARCIAL | Cadastro, login, logout, recuperação e sessão no cliente. | Não há projeto HealthData conectado para executar autenticação. |
| Favoritos e filtros | PARCIAL | Salvar/listar/reabrir, renomear e excluir na tela de salvos. | Código presente; requer Supabase para teste real. |
| Histórico | PARCIAL | Registro e listagem/exclusão de consultas da conta. | Código presente; requer Supabase. |
| Visualizações do mapa | PARCIAL | Salvar centro, zoom, camadas, fonte e filtros; restauração pela URL e consulta da posição/camadas por usuário. | Correção de restauração revisada; requer Supabase e navegador para teste ponta a ponta. |
| Preferências | PARCIAL | Tema claro/escuro persistido em `user_preferences`. | Código presente; requer Supabase. |
| Migrations/RLS | PARCIAL | SQL inclui tabelas, índices, grants mínimos e políticas por `auth.uid()`; teste pgTAP ampliado. | Não aplicado nem executado em projeto real. |
| e-SUS Notifica | BLOQUEADO | Não integrado: manual descreve Basic Auth e campos pessoais/clínicos. | Habilitação, autorização e finalidade atuais não fornecidas. |
| Exportação CSV | PARCIAL | CSV contém metadados em colunas consistentes e somente linhas sanitizadas/agrupadas; conteúdo que poderia iniciar fórmula em planilha é prefixado para neutralização. | Testes de sanitização aprovados; fluxo de download no navegador não testado. |
| Lazy loading / divisão de código | PENDENTE | O aplicativo permanece concentrado em `App.jsx`; ainda não foi aplicada divisão dinâmica dos módulos/mapas. | Confirmar com análise de bundle após instalar dependências. |
| Debounce e cancelamento de consultas | PARCIAL | Consultas anteriores podem ser canceladas com `AbortController`; campos de pesquisa ainda não usam debounce. | Revisão de `frontend/src/api.js` e dos componentes; teste de navegador pendente. |
| Responsividade/acessibilidade | PARCIAL | Regras mobile, estados vazios, labels e aria em controles principais. | Revisão de código; não houve teste em dispositivos/leitor de tela. |
| Testes automatizados | PARCIAL | Dezessete testes unitários implementados. | `npm test`: 17/17 aprovados; inclui classificação de HTTP 2xx, 401/403, 429, 404 e 5xx. |
| Check de sintaxe backend | CONCLUÍDO | `node --check` para backend e handlers serverless. | `npm run check`: aprovado. |
| Sintaxe JSX | CONCLUÍDO | Transpilação sintática com TypeScript global, JSX React. | `frontend/src/App.jsx`: sem diagnósticos. |
| Build Vite | BLOQUEADO | Dependências não puderam ser instaladas no ambiente de edição por falha de DNS/timeout. | `npm install` expirou; `npm run build` foi tentado e falhou porque `vite` não estava instalado (`vite: not found`). |
| Supabase conectado/migration aplicada | BLOQUEADO | Nenhum projeto dedicado HealthData está conectado. Não foi usado o projeto SalaON nem outro banco existente. | Nenhuma migration aplicada. |
| GitHub | BLOQUEADO | Não foi encontrado repositório HealthData Brasil acessível; repositório SalaON preservado sem alterações. | Listagem do GitHub consultada. |
| Vercel/deploy | BLOQUEADO | Não foi encontrado projeto Vercel HealthData Brasil. | Busca de projetos Vercel retornou zero resultados. |
| AV2 Canva | BLOQUEADO | A página abriu somente o título/contêiner, sem os critérios completos. | Precisa PDF ou capturas da avaliação. |

## Observações de interpretação

1. Um recurso presente no catálogo é **configurado**, não prova que a fonte respondeu com sucesso.
2. A quantidade de linhas numa página não representa automaticamente o total nacional.
3. A supressão de grupos pequenos é uma salvaguarda técnica, não uma declaração automática de conformidade legal.
4. A disponibilidade do Swagger não comprova disponibilidade contínua dos endpoints de dados.
5. Fontes com microdados seguem bloqueadas até revisão do esquema, finalidade, acesso e proteção de dados.
