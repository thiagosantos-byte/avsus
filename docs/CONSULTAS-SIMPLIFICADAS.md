# Consultas simplificadas — HealthData Brasil

## O que motivou a correção

A interface permitia que o seletor de fontes exibisse conjuntos de dados de outras áreas. Isso podia deixar uma página de vacinação com filtros de estabelecimentos CNES, causando uma combinação incoerente entre título, formulário e endpoint.

O formulário do CNES também expunha parâmetros técnicos de paginação e aceitava uma data compacta (`20260105`), enquanto o Swagger oficial documenta `data_atualizacao` no formato `YYYY-MM-DD`.

## Comportamento após a atualização

- Cada módulo lista somente fontes compatíveis com a seção aberta.
- A dashboard inicial ganhou atalhos visíveis para Rede de Saúde, Epidemiologia, Vacinação e Mapa interativo.
- A tela comum mostra primeiro os filtros essenciais; os demais ficam recolhidos em **Mais filtros**.
- `limit`, `offset` e `campos` são controlados pelo backend e não aparecem como campos de formulário.
- Datas são escolhidas pelo calendário do navegador e validadas no frontend e no backend.
- Filtros antigos salvos como `YYYYMMDD` são convertidos para `YYYY-MM-DD` ao serem carregados.
- A consulta de doses PNI 2026 não exibe filtros que não constam no Swagger; a paginação é automática.
- Uma nova consulta limpa a tabela anterior para impedir que resultados antigos sejam confundidos com a nova busca.
- Erros de filtro, lentidão, limite de requisições e restrição da fonte recebem mensagens próprias.
- O cache existente continua podendo entregar uma resposta previamente armazenada, identificada como desatualizada quando aplicável.

## Como verificar no ambiente local

Na pasta que contém este arquivo e o `package.json`, execute:

```bash
npm install
npm run check
npm test
npm run build
npm run dev
```

## Validações executadas durante a alteração

- `npm run check`: aprovado.
- `npm test`: 24 testes aprovados.
- Sintaxe JSX/JavaScript de `frontend/src/App.jsx` e `frontend/src/api.js`: aprovada.
- Parse do CSS `frontend/src/styles.css`: sem erros.
- O build Vite não pôde ser executado neste ambiente, porque as dependências não estavam instaladas (`vite: not found`). Execute `npm install` e `npm run build` no computador de desenvolvimento antes de promover a versão para produção.
- A documentação Swagger foi conferida, mas a consulta HTTP real aos endpoints de dados não pôde ser validada neste ambiente; o funcionamento em produção deve ser confirmado após o deploy.

## Referência oficial

Swagger DEMAS — API de Dados Abertos: https://apidadosabertos.saude.gov.br/static/swagger.json
