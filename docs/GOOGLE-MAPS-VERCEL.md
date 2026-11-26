# Ativar Google Maps no HealthData Brasil (sem arquivo `.env`)

O projeto usa Google Maps JavaScript API para mapas incorporados ao sistema. A tela oferece mapa de ruas, satélite, híbrido e uma opção de visualização 3D. O mapa alternativo OpenStreetMap/Leaflet permanece disponível enquanto não houver uma chave Google válida.

## 1. Criar a chave

1. Abra https://console.cloud.google.com/google/maps-apis/credentials.
2. Selecione ou crie um projeto no Google Cloud.
3. Associe uma conta de faturamento ao projeto e habilite **Maps JavaScript API**.
4. Crie uma chave de API.
5. Em **Application restrictions**, escolha **Websites (HTTP referrers)** e adicione apenas os domínios que realmente hospedam o projeto. Exemplo:
   - `https://SEU-PROJETO.vercel.app/*`
   - `https://seu-dominio-personalizado.com/*`
   - `http://localhost:5173/*` (somente se for usar o ambiente local)
6. Em **API restrictions**, restrinja a chave à **Maps JavaScript API**.
7. Para o mapa avançado, crie também um **Map ID** para JavaScript no Google Cloud. O projeto usa `DEMO_MAP_ID` quando nenhum ID é fornecido; um ID próprio é recomendado para a publicação.

A chave `VITE_GOOGLE_MAPS_API_KEY` é incluída no JavaScript do navegador por definição. Ela não é uma senha. A proteção correta é restringi-la por referenciador HTTP e pela API utilizada, além de monitorar o consumo e configurar alertas/cotas.

## 2. Cadastrar na Vercel (não criar `.env`)

1. Abra o projeto na Vercel.
2. Entre em **Settings → Environment Variables**.
3. Cadastre:

| Nome | Valor |
|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | A chave criada no Google Cloud |
| `VITE_GOOGLE_MAPS_MAP_ID` | O Map ID JavaScript criado (opcional, mas recomendado) |

4. Marque **Production** e **Preview** conforme os domínios que foram liberados nas restrições da chave.
5. Salve e faça um novo deployment. Variáveis com prefixo `VITE_` são incorporadas pelo Vite no momento do build.

**Não é necessário criar, enviar ou versionar um arquivo `.env`.**

## 3. Como o sistema se comporta

- Com chave válida: Google Maps, satélite, híbrido, agrupamento de marcadores e visualização 3D.
- Sem chave: OpenStreetMap/Leaflet continua ativo, com marcadores e agrupamento.
- Se a chave estiver incorreta ou o Google estiver indisponível: o mapa alternativo continua como fallback e a interface informa a causa provável.
- Marcadores são desenhados somente para pontos com latitude/longitude válidas retornadas pelos dados públicos. O sistema não inventa coordenadas.
- A vista 3D amostra até 250 marcadores para evitar degradar o desempenho. A cobertura de edifícios fotorealistas 3D depende da região; o mapa 3D ainda pode apresentar imagem aérea/terreno sem malha de edifícios.
- Os polígonos epidemiológicos continuam vindo das malhas territoriais oficiais do IBGE e não representam a posição de pacientes.

## 4. Billing e prototipagem

A Maps JavaScript API padrão exige uma conta de faturamento habilitada. O Google oferece uma Demo Key sem custo para prototipagem com recursos/quota limitados; a documentação não a recomenda para produção. Consulte os termos e preços atuais antes de publicar para visitantes, monitore o uso e configure alertas/cotas no Google Cloud.

Documentação oficial:

- https://developers.google.com/maps/documentation/javascript/get-api-key
- https://developers.google.com/maps/documentation/javascript/3d/overview
- https://developers.google.com/maps/documentation/javascript/advanced-markers/start
- https://developers.google.com/maps/documentation/javascript/usage-and-billing
