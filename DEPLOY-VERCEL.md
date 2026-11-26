# Deploy do HealthData Brasil na Vercel

Este projeto está preparado para publicar a interface Vite e as rotas Node.js em `api/` no mesmo domínio Vercel. O navegador chama `/api` por caminho relativo; não configure `localhost` nem um backend separado na Vercel.

## Configuração do projeto

Ao importar o repositório no Vercel:

- **Framework Preset:** Vite
- **Root Directory:** `.` (raiz do repositório; deve conter `package.json` e `vercel.json`)
- **Install Command:** `npm install`
- **Build Command:** `npm run build`
- **Output Directory:** `frontend/dist`
- **Node.js Version:** `22.x`

O `vercel.json` já declara o build, a pasta de saída, as funções em `api/`, a região `gru1` (São Paulo), duração de até 60 segundos por função e o fallback das rotas do React Router. As consultas externas usam timeout curto e duas tentativas para não exceder o limite de execução nem deixar a interface presa por muito tempo.

## Variáveis de ambiente

**Não é necessário criar `.env` nem cadastrar variáveis na Vercel para executar as consultas públicas.** O sistema já usa a API oficial DEMAS como padrão, chama o backend pelo caminho relativo `/api` e permite a própria origem automaticamente. A implantação básica funciona sem credenciais Supabase.

As variáveis abaixo são opcionais e só devem ser cadastradas em **Settings → Environment Variables** quando houver necessidade de personalizar o comportamento:

| Nome | Valor sugerido | Obrigatória |
|---|---|---|
| `HEALTH_API_BASE_URL` | `https://apidadosabertos.saude.gov.br` | Não; já existe padrão no código |
| `HEALTH_API_SWAGGER_URL` | `https://apidadosabertos.saude.gov.br/static/swagger.json` | Não; já existe padrão no código |
| `HEALTH_API_TIMEOUT_MS` | `12000` | Não |
| `HEALTH_API_CACHE_TTL_SECONDS` | `600` | Não |
| `HEALTH_MIN_AGGREGATE_COUNT` | `5` | Não |
| `CORS_ORIGINS` | origens externas confiáveis, uma por vírgula | Só para frontend/API em domínios diferentes |

A API permite a própria origem automaticamente. Se a interface e a API forem chamadas pelo mesmo domínio Vercel, `CORS_ORIGINS` não precisa incluir URLs de preview. Para consumo cross-origin, informe apenas origens exatas, incluindo `https://`.

### Google Maps (opcional; não exige arquivo `.env`)

O mapa continua acessível pelo OpenStreetMap quando não há chave Google. Para ativar Google Maps com modos **Mapa**, **Satélite**, **Híbrido** e **3D** na Vercel, cadastre estas variáveis diretamente em **Project → Settings → Environment Variables**:

| Variável | Obrigatória | Conteúdo |
|---|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | Sim, para Google Maps | Chave pública da Maps JavaScript API |
| `VITE_GOOGLE_MAPS_MAP_ID` | Recomendável | Map ID criado no Google Cloud; se omitido, usa `DEMO_MAP_ID` para teste |

Passos no Google Cloud:

1. Crie ou selecione um projeto no Google Cloud Console e associe uma conta de faturamento.
2. Habilite **Maps JavaScript API**.
3. Crie uma API key e restrinja **Application restrictions → Websites (HTTP referrers)** aos domínios usados, por exemplo `https://SEU-PROJETO.vercel.app/*`, seu domínio personalizado e `http://localhost:5173/*` para desenvolvimento.
4. Em **API restrictions**, limite a chave à **Maps JavaScript API**.
5. Crie um **Map ID** para JavaScript e cadastre-o em `VITE_GOOGLE_MAPS_MAP_ID`.
6. Cadastre as duas variáveis na Vercel nos ambientes Preview e Production e faça um novo deploy. Variáveis `VITE_*` são incorporadas durante o build.

A chave `VITE_GOOGLE_MAPS_API_KEY` é entregue ao navegador por definição; não é uma senha. Proteja-a com restrições de domínio e API, monitore uso e configure cotas/alertas de faturamento. A Maps JavaScript API padrão requer faturamento habilitado. A Maps Demo Key é gratuita para prototipagem com limites e não é indicada para produção. A cobertura de edifícios fotorealistas em 3D varia conforme a região; fora das áreas cobertas, o Google ainda pode exibir imagem aérea/terreno sem edifícios 3D.

**Não crie `.env` para publicar.** A configuração é feita diretamente no painel da Vercel. Em desenvolvimento local, a chave pode ser fornecida pelo ambiente do terminal ou por um `.env.local` opcional ignorado pelo Git; sem ela, o mapa alternativo continua operacional.

### Recursos opcionais que dependem do Supabase

Sem estas variáveis, consultas oficiais continuam funcionando, mas login, favoritos, filtros salvos, histórico persistente, preferências sincronizadas e cache persistente ficam desativados. Para habilitá-los, configure:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

Use a chave publishable no frontend e a chave secret somente no backend. Nunca coloque `SUPABASE_SECRET_KEY` em uma variável `VITE_` nem em código do navegador. Aplique primeiro a migration `supabase/migrations/202611240001_healthdata_schema.sql` no projeto Supabase correto. Depois de alterar variáveis `VITE_*`, faça um novo deploy, pois elas são incorporadas durante o build.

## Deploy pelo terminal

Na pasta que contém `package.json`:

```bash
npm install
npm run check
npm test
npm run build
npx vercel
```

O primeiro `npx vercel` cria uma implantação de Preview e solicita o vínculo com a conta/projeto. Após testar a URL de Preview:

```bash
npx vercel --prod
```

## Verificação após o deploy

Abra estes endereços, substituindo pelo domínio real do projeto:

- `/` — interface
- `/api/health` — deve responder JSON com `status: "ok"`
- `/api/sources` — catálogo de fontes
- `/api/sources/status` — status da API DEMAS e do Swagger

Depois, faça uma consulta real de CNES e teste a navegação direta para páginas internas. O sucesso do build, sozinho, não comprova que a API externa ou o Supabase estão disponíveis.

## Observações da arquitetura

- `backend/server.js` é o servidor local de desenvolvimento; não é iniciado como processo permanente na Vercel.
- As funções da Vercel importam `backend/app.js` por meio dos arquivos em `api/`.
- A Vercel executa funções sob demanda e pode reutilizar ou encerrar instâncias. O cache em memória é temporário; para cache e logs persistentes, configure o Supabase e aplique a migration.
- O projeto não contém credenciais reais nem exige um arquivo `.env`. Configure credenciais somente no painel da Vercel, nunca em um repositório público. `backend/server.js` carrega `.env` local opcional via `dotenv`; na Vercel, as variáveis são fornecidas pelo próprio ambiente da plataforma.
