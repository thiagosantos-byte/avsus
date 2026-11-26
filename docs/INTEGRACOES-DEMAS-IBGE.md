# Integrações e documentação técnica

**Data da conferência:** 25/11/2026.  
**Fonte DEMAS:** `https://apidadosabertos.saude.gov.br/static/swagger.json`.  
**Versão identificada no Swagger:** 1.8.32.

O backend carrega o Swagger oficial e deriva a operação GET e seus parâmetros em execução. Por isso, a lista exata exibida na tela de cada recurso vem da especificação atual e não de uma cópia estática. A tabela abaixo resume o catálogo mantido no código. Os campos/limites dos endpoints variam e não se deve reutilizar a restrição de uma operação em outra.

## Operações DEMAS mantidas no catálogo público

| ID interno | Endpoint oficial | Método | Parâmetros/observações |
|---|---|---|---|
| `cnesEstablishments` | `/assistencia-a-saude/cnes-estabelecimentos` | GET | Parâmetros definidos no Swagger da operação; inclui filtros territoriais/competência e paginação. `limit` máximo documentado: 1.000. |
| `cnesDirectory` | `/cnes/estabelecimentos` | GET | `codigo_tipo_unidade`, `codigo_uf`, `codigo_municipio`, `status`, indicadores de centro cirúrgico/obstétrico, `data_atualizacao`, `limit`, `offset`. `limit` máximo documentado: 20 nesta operação. |
| `cnesLookup` | `/cnes/estabelecimentos/{codigo_cnes}` | GET | `codigo_cnes` obrigatório no caminho; tipo inteiro, segundo Swagger. |
| `tiposUnidade` | `/cnes/tipounidades` | GET | Sem parâmetros de consulta no esquema conferido. |
| `ubs` | `/assistencia-a-saude/unidade-basicas-de-saude` | GET | Parâmetros lidos do Swagger em tempo de execução; paginação conforme operação. |
| `hospitalsBeds` | `/assistencia-a-saude/hospitais-e-leitos` | GET | Filtro `uf` e paginação; limite máximo documentado: 1.000. |
| `cnesBeds` | `/assistencia-a-saude/cnes-leitos` | GET | Filtros de competência, território, CNES e tipo de leito; paginação conforme Swagger. |
| `cnesEquipment` | `/assistencia-a-saude/cnes-equipamentos` | GET | Filtros cadastrais/territoriais e paginação conforme Swagger. |
| `dengue` | `/arboviroses/dengue` | GET | `nu_ano`, `id_municip`, `limit` (máximo 1.000), `offset` (índice de página iniciado em zero), `campos`. O backend solicita apenas `nu_ano`, `sg_uf`, `id_municip` e agrega antes de retornar. |
| `zika` | `/arboviroses/zikavirus` | GET | `nu_ano`, `id_municip`, `limit` (máximo 1.000), `offset` (página iniciada em zero), `campos`; allowlist/agrupamento no backend. |
| `chikungunya` | `/arboviroses/chikungunya` | GET | `nu_ano`, `id_municip`, `limit` (máximo 1.000), `offset` (página iniciada em zero), `campos`; allowlist/agrupamento no backend. |
| `vaccination2025` | `/vacinacao/doses-aplicadas-pni-2025` | GET | Parâmetros dinâmicos do Swagger; allowlist e agregação no backend. |
| `vaccination2026` | `/vacinacao/doses-aplicadas-pni-2026` | GET | Parâmetros dinâmicos do Swagger; allowlist e agregação no backend. |

O Swagger indica respostas JSON e/ou CSV conforme cada operação. O sistema utiliza JSON para normalização. A presença do campo `security` na operação é verificada em runtime; o catálogo público não deve ser interpretado como autorização para qualquer conjunto de dados externo.

## Operações documentadas, mas não liberadas para consulta pública

| ID interno | Endpoint | Motivo do bloqueio atual |
|---|---|---|
| `yellowFever` | `/arboviroses/febre-amarela-humanos-primatas-nao-humanos` | Validar distinção entre registros humanos e não humanos e os campos disponíveis antes de definir indicador. |
| `esavi` | `/vacinacao/esavi` | Revisão dos campos pessoais/clínicos e risco de reidentificação. |
| `sim` | `/vigilancia-e-meio-ambiente/sistema-de-informacao-sobre-mortalidade` | Revisão de microdados, permissões e método de agregação. |
| `sinasc` | `/vigilancia-e-meio-ambiente/sistema-de-informacao-sobre-nascidos-vivos` | Revisão de microdados e risco de identificação indireta. |
| `sg2021`–`sg2024` | `/vigilancia-e-meio-ambiente/notificacoes-de-sindrome-gripal-leve-{ano}` | Dados derivados de notificação; não expor registros individuais. |
| `srag2019_2026` | `/vigilancia-e-meio-ambiente/srag-2019-2026` | O Swagger descreve atributos demográficos, clínicos e hospitalares. |
| `sinanMpox` | `/vigilancia-e-meio-ambiente/mpox` | Revisão de microdados e autorização. |
| `sinanHanseniase` | `/vigilancia-e-meio-ambiente/sinan-hanseniase` | Revisão de campos demográficos, clínicos e epidemiológicos. |

## Paginação

- `limit` é validado pelo máximo específico da operação, obtido no Swagger; não existe um máximo universal.
- `offset` segue a descrição DEMAS como índice da página iniciado em zero (por exemplo, zero é a primeira página).
- Quando a fonte não fornece total confiável, `hasNext` é inferido pela quantidade bruta recebida na página (antes da supressão de privacidade). A interface não apresenta isso como total nacional.
- Quando a fonte fornece total de resultados, esse valor só é apresentado em conjuntos que não passaram por supressão de microdados.

## Privacidade e agregação

- As operações de arboviroses são tratadas como fontes de notificação em nível de registro. O backend solicita somente ano, UF e código municipal, agrega por ano/município/UF e suprime grupos com menos de cinco registros. O código do município fica como filtro avançado; se a consulta retornar somente grupos suprimidos, a interface informa isso e oferece refazer sem município.
- Não é devolvida contagem nacional exata a partir de microdados suprimidos.
- Dados de vacinação passam por allowlist e agregação; o valor de doses só é emitido quando existe uma coluna quantitativa reconhecida no payload.
- CSV usa apenas os registros sanitizados que já foram retornados à interface.
- O limiar de cinco é uma salvaguarda técnica inicial, não prova anonimização robusta nem substitui avaliação institucional/encarregado LGPD.

## e-SUS Notifica

O manual DATASUS (fevereiro de 2022) documenta chamadas REST por `GET`, com proxy Elasticsearch e paths como `_search`/`_count`, Basic Auth e consultas para dados de notificações. O manual inclui CPF, CNS, nome, endereço, telefone e sintomas. No projeto atual não há endpoint, credencial ou autorização para o e-SUS Notifica. A integração permanece bloqueada até confirmação formal das condições atuais de acesso, finalidade, responsabilidade e controles de segurança.

## Geometrias IBGE

- Estados: `GET https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=UF&formato=application/vnd.geo+json&qualidade=minima`. Se o serviço nacional não devolver as divisões por UF, o backend consulta as 27 rotas documentadas `GET /api/v3/malhas/estados/{id}`. A rota sem identificador (`/estados`) não é válida e retornava HTTP 404.
- Município: `GET https://servicodados.ibge.gov.br/api/v3/malhas/municipios/{codigo_ibge}?formato=application/vnd.geo+json&qualidade=minima`.
- A rota interna de município aceita no máximo 25 códigos por requisição e executa até cinco downloads em paralelo. A tela indica que o resultado municipal cobre somente os códigos presentes na página consultada (até 25 por volume), não um censo nacional do mapa.
- Atribuição OpenStreetMap é exibida no mapa de base.

## Fonte e autorização

O Swagger e as respostas publicamente disponíveis não substituem validação de disponibilidade em produção, análise institucional, termos de uso, avaliação LGPD ou habilitação específica. O status de cada integração é verificado em consulta e os recursos restritos permanecem bloqueados no backend.
