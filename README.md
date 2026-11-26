# HealthData Brasil — Inteligência em Saúde Pública

Aplicação full-stack evoluída sobre a estrutura existente do projeto. A interface utiliza React, Vite, Bootstrap, React Router, Recharts e React Leaflet; o backend é Node.js + Express e consulta a API de Dados Abertos do Ministério da Saúde (DEMAS). Supabase PostgreSQL/Auth é opcional para as consultas públicas, mas necessário para autenticação e persistência privada.

> **Integridade dos dados:** nenhum indicador demonstrativo é preenchido como dado real. As linhas são filtradas por allowlists; notificações de arboviroses são agregadas no backend por ano/município/UF e grupos com menos de cinco linhas são suprimidos. A contagem de registros recebidos numa página não é apresentada como total nacional nem como incidência. Para arboviroses, a plataforma informa “registros de notificação na página”, após agrupar por ano/município/UF e suprimir grupos abaixo do limiar. Fontes com microdados e/ou autorização pendente permanecem bloqueadas para consulta pública.


## Correção do endpoint CNES no Swagger 1.8.32

O Swagger atual não declara `host` nem `basePath` e lista o diretório como `/cnes/estabelecimentos`. Portanto, não acrescente `/v1` à URL-base. A operação CNES atual utiliza `codigo_municipio`, e não `co_ibge`; a resposta traz campos como `codigo_cnes`, `nome_fantasia`, `codigo_municipio`, `latitude_estabelecimento_decimo_grau` e `longitude_estabelecimento_decimo_grau`. O catálogo, a allowlist e o conversor de pontos foram alinhados a esses nomes. O limite documentado desta operação é 20 registros por página.

Exemplo de teste direto (Salvador):

```bash
curl -i "https://apidadosabertos.saude.gov.br/cnes/estabelecimentos?codigo_municipio=292740&limit=20&offset=0"
```

Use o teste acima antes de testar a rota local correspondente. O código municipal de seis dígitos deve ser conferido com o campo `codigo_municipio` da própria fonte; não reutilize automaticamente o código IBGE de sete dígitos.

## Módulos existentes

- Visão geral com status do Swagger, API DEMAS e API interna, consulta real e paginação por endpoint.
- Mapa de estabelecimentos com Google Maps JavaScript API opcional (ruas, satélite, híbrido e visualização 3D), marcadores avançados e clusterização; sem chave Google, usa OpenStreetMap/Leaflet como alternativa. A concentração de unidades usa círculos translúcidos e agrupamento, sem depender da antiga HeatmapLayer do Google, removida em 2026. Tela cheia, geolocalização mediante permissão e salvamento de posição/camadas no Supabase.
- Rede de Saúde com endpoints CNES/UBS/hospitais/leitos/equipamentos preservados.
- Epidemiologia com dengue, Zika e chikungunya agregadas no backend, mapa coroplético por UF e mapa municipal limitado aos 25 municípios com maior contagem da página atual.
- Vacinação PNI 2025/2026 com allowlist e agregação; não calcula cobertura sem denominador apropriado.
- Análises com gráficos nomeados por finalidade (série anual e comparação por UF); em bases de leitos/equipamentos/doses, soma uma coluna quantitativa explícita somente quando todos os registros da página possuem esse campo válido; caso contrário, exibe apenas a contagem de registros da página.
- Fontes e metodologia com catálogo de operações liberadas e bloqueadas para revisão.
- Consultas salvas com favoritos, filtros, histórico e visualizações do mapa.

## Arquitetura e contratos internos

O backend consulta e valida o Swagger oficial antes de aceitar parâmetros. Rotas internas incluem:

- `GET /api/health`
- `GET /api/sources`
- `GET /api/sources/status`
- `GET /api/sources/:resource/schema`
- `GET /api/data/:resource`
- `GET /api/overview`
- `GET /api/estabelecimentos`
- `GET /api/estabelecimentos/:cnes`
- `GET /api/map/points`
- `GET /api/indicadores/dengue`
- `GET /api/indicadores/epidemiologia`
- `GET /api/indicadores/vacinacao`
- `GET /api/geo/estados`
- `GET /api/geo/municipios?codigos=...` (máximo 25 códigos IBGE de sete dígitos)

Essas rotas são contratos do HealthData Brasil, não rotas inventadas do Ministério da Saúde.

O `limit` máximo é obtido por operação no Swagger. No Swagger 1.8.32, o diretório CNES usa `/cnes/estabelecimentos` e limita a página a 20 registros; operações de assistência à saúde e arboviroses podem ter limites diferentes, inclusive até 1.000. O parâmetro `offset` é o índice da página iniciado em zero, conforme a documentação.

Detalhes estão em `docs/INTEGRACOES-DEMAS-IBGE.md` e a matriz de aceitação em `docs/MATRIZ-CONFORMIDADE.md`.

## Fontes de dados

### Liberadas no catálogo público (consultadas sob demanda)

- CNES: `/cnes/estabelecimentos`, `/cnes/estabelecimentos/{codigo_cnes}`, `/cnes/tipounidades`, além das operações de UBS, hospitais/leitos, CNES leitos e equipamentos. O diretório CNES utiliza `codigo_municipio` (código municipal de seis dígitos no formato retornado pela base) e `codigo_tipo_unidade`; não utiliza `co_ibge` nesta operação.
- Arboviroses: dengue, Zika e chikungunya; campos reduzidos e agregação obrigatória.
- PNI: doses aplicadas 2025 e 2026; cobertura vacinal somente quando houver denominador compatível (não calculada nesta revisão).

### Identificadas, mas bloqueadas para liberação pública

- Febre amarela e ESAVI.
- SIM, SINASC, notificações de síndrome gripal, SRAG e bases SINAN listadas no catálogo.
- e-SUS Notifica: não integrado. O manual DATASUS de 2022 descreve autenticação Basic Auth, chamadas REST/Elasticsearch e campos pessoais/clínicos. É necessário confirmar habilitação e autorização atuais, finalidade, responsabilidades e controles institucionais antes de qualquer uso.

A existência de uma operação no Swagger não significa autorização para expor microdados no produto.

## Mapa e cartografia

- Base prioritária opcional: Google Maps JavaScript API, com modos de ruas, satélite, híbrido e mapa 3D quando habilitado por uma chave restrita por domínio.
- Alternativa sem chave: OpenStreetMap/Leaflet, com os créditos cartográficos correspondentes.
- Malhas de estados e municípios: API de Malhas do IBGE em GeoJSON; os polígonos epidemiológicos continuam sendo dados territoriais oficiais, não dados individuais de pacientes.
- Não é necessário criar `.env`: a chave Google é opcional e pode ser cadastrada diretamente nas variáveis de ambiente da Vercel como `VITE_GOOGLE_MAPS_API_KEY`; `VITE_GOOGLE_MAPS_MAP_ID` também é opcional, mas recomendado para produção.
- Marcadores de estabelecimento só são colocados com coordenadas válidas presentes na resposta da fonte. Não há geocodificação automática; ausência de coordenadas não é substituída por endereço aproximado.
- O heatmap de estabelecimentos mostra concentração de unidades, não casos epidemiológicos.
- O mapa epidemiológico usa agregados territoriais; o coroplético municipal mostra somente até 25 municípios com códigos disponíveis na página atual. Não representa localização de pacientes.
- O modo 3D e a cobertura cartográfica nacional por todos os municípios não estão concluídos.

## Segurança e LGPD

- CORS por lista explícita `CORS_ORIGINS`.
- Rate limiting, validação Zod, timeout e retry para falhas transitórias.
- Chave Supabase secreta apenas no backend; nunca utilize `VITE_` para chave secreta/service role.
- Tabelas expostas usam RLS por `auth.uid()`. Cache e logs operacionais são fechados para `anon`/`authenticated` e acessados com chave de backend.
- Allowlist de campos por perfil de fonte, supressão de grupos pequenos e CSV somente com conteúdo sanitizado.
- O limiar mínimo de cinco é uma salvaguarda técnica inicial, não declaração de conformidade legal; exige avaliação institucional e análise de risco de reidentificação.

## Instalação local

Requisitos: Node.js `>=20.19.0`. **Não é necessário ter um arquivo `.env` para instalar, abrir o sistema ou fazer consultas públicas.** O projeto usa por padrão a API oficial do Ministério da Saúde e a rota relativa `/api`. O arquivo `.env.example` é apenas um modelo opcional para personalizações.

```bash
npm install
npm run check
npm test
npm run build
npm run dev
```

A interface usa `http://localhost:5173`; API em `http://localhost:4000/api/health`.

No PowerShell, se `npm.ps1` estiver bloqueado, use `npm.cmd`. O backend carrega `dotenv` automaticamente quando um `.env` opcional existir; quando o arquivo não existe, segue com os padrões seguros do projeto.

## Variáveis de ambiente

Todas as variáveis abaixo são opcionais para consultas públicas. Só crie um `.env` local ou configure variáveis no painel da Vercel quando realmente precisar personalizar a integração:

- `HEALTH_API_BASE_URL` deve ser `https://apidadosabertos.saude.gov.br` (raiz do domínio, sem `/v1`). Os caminhos publicados no Swagger são concatenados diretamente nessa raiz. `HEALTH_API_SWAGGER_URL` aponta para a documentação oficial.
- `HEALTH_API_TIMEOUT_MS`, `HEALTH_API_CACHE_TTL_SECONDS` e `HEALTH_MIN_AGGREGATE_COUNT`.
- `CORS_ORIGINS`: origens locais e domínios exatos da implantação.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY`: somente backend.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`: cliente público.

Não compartilhe nem comite `.env`.

## Supabase

**Sem Supabase configurado, o sistema continua abrindo e as consultas públicas continuam disponíveis.** Nesse modo, autenticação, favoritos, filtros salvos, histórico entre sessões e cache/logs persistentes ficam indisponíveis; o cache em memória continua sendo usado temporariamente. A interface informa que a conta não está conectada, em vez de interromper as consultas públicas.

1. Crie/selecione um projeto dedicado ao HealthData Brasil; não reutilize o projeto SalaON.
2. Execute `supabase/migrations/202611240001_healthdata_schema.sql` no SQL Editor ou por migration controlada.
3. Configure Auth e variáveis públicas/privadas conforme `.env.example`.
4. Execute os testes em `supabase/tests/healthdata_rls.test.sql` em ambiente Supabase local com pgTAP, incluindo o cenário com duas contas.
5. Teste login, logout, favoritos, filtros, histórico e visualizações com duas contas antes de liberar.

**A migration não foi aplicada a um projeto remoto nesta revisão.** Não há projeto Supabase dedicado HealthData conectado neste momento.

## Vercel

O projeto pode ser publicado em um único domínio: frontend Vite em `frontend/dist` e rotas de API como Vercel Functions em `api/`. O navegador usa `/api` relativo, sem depender de `localhost` nem de um servidor Express permanente.

A raiz do projeto na Vercel deve conter `package.json`, `vercel.json`, `frontend/`, `backend/` e `api/`. Use `DEPLOY-VERCEL.md` para o passo a passo de configuração, variáveis de ambiente e verificações pós-deploy.

`backend/server.js` é usado somente no desenvolvimento local. Na Vercel, as rotas em `api/` importam o Express app de `backend/app.js` como funções serverless. A região padrão foi definida como São Paulo (`gru1`).

O cache em memória é temporário entre instâncias. Para cache e logs persistentes, configure o Supabase e aplique a migration indicada na seção Supabase. A autenticação e a persistência das consultas também dependem das variáveis públicas do Supabase.

Nenhum deploy foi realizado automaticamente nesta revisão.

## Testes e limitações

```bash
npm run check
npm test
npm run build
```

Nesta sessão, `npm run check` foi executado com sucesso e `npm test` passou com 17/17 testes. A sintaxe JSX foi verificada por transpilação sintática com TypeScript global. As consultas anteriores são canceladas por `AbortController`, mas o code splitting/lazy loading de módulos e debounce de campos de pesquisa ainda precisam ser implementados. A instalação de dependências nesta cópia de trabalho expirou por falha de DNS. A tentativa posterior de `npm run build` retornou `vite: not found`; portanto, build Vite e testes de navegador permanecem não validados. Como esta revisão acrescentou dependências de mapa (`leaflet.heat` e `leaflet.markercluster`) ao `package.json`, execute `npm install` novamente na cópia atualizada antes de rodar o build.

O acesso direto às APIs de dados e às malhas do IBGE não pôde ser validado em tempo real a partir do ambiente de edição por falha de resolução DNS. O Swagger foi consultado e seus parâmetros/limites foram incorporados dinamicamente; o runtime ainda deve confirmar as respostas reais.

## Referências

- DEMAS: <https://apidadosabertos.saude.gov.br/v1/>
- Swagger: <https://apidadosabertos.saude.gov.br/static/swagger.json>
- Manual e-SUS Notifica: <https://datasus.saude.gov.br/wp-content/uploads/2022/02/Manual-de-Utilizacao-da-API-e-Sus-Notifica.pdf>
- IBGE — Malhas: <https://servicodados.ibge.gov.br/api/docs/malhas?versao=3>
- OpenStreetMap: <https://www.openstreetmap.org/copyright>


## Correção das malhas do IBGE

A consulta de estados não usa mais a rota inválida `/api/v3/malhas/estados` sem identificador. O backend tenta a malha nacional `paises/BR?intrarregiao=UF` e possui fallback para as rotas por código das 27 UFs. Nas consultas de arboviroses, o código municipal passou a ser filtro avançado; quando grupos são ocultados pela regra mínima de privacidade, a interface informa a causa e permite refazer a consulta sem o município.


## Mapa imersivo e infográfico

A página **Mapa interativo** oferece busca nos estabelecimentos retornados pela consulta atual, métricas de georreferenciamento e visualização Google Maps/3D quando a chave está configurada. Sem chave, usa OpenStreetMap como alternativa. A rota **Infográfico** transforma a resposta real da fonte em indicadores, gráficos por território/período/composição, tabela, CSV e impressão em PDF. Visualizações sem campos suficientes são identificadas como indisponíveis; nenhum dado é inventado. Veja `docs/EXPERIENCIA-MAPA-INFOGRAFICO.md`.

Para ativar o Google Maps na Vercel, configure `VITE_GOOGLE_MAPS_API_KEY` e `VITE_GOOGLE_MAPS_MAP_ID` em **Settings → Environment Variables** e faça um novo deploy. Não é necessário criar um arquivo `.env`.
