# Financeiro — Yuri dos Anjos

Painel financeiro, DRE e inteligência estratégica da operação.
Meta: **R$ 30k/mês recorrentes até janeiro de 2027**.

O progresso está em [ROADMAP.md](./ROADMAP.md).

## Rodar localmente

```bash
npm install
cp .env.example .env.local     # preencha DATABASE_URL e os segredos
npm run db:push                # aplica o schema
npm run db:seed -- --demo      # dados de demonstração (opcional)
npm run dev                    # http://localhost:3000
```

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` / `npm start` | Build e execução em produção |
| `npm run db:push` | Aplica o schema no banco |
| `npm run db:generate` | Gera uma migration a partir do schema |
| `npm run db:seed` | Cria estrutura (`-- --demo` adiciona dados fictícios) |
| `npm run db:reset` | Apaga dados transacionais e preserva a estrutura |
| `npm run db:studio` | Inspetor visual do banco |

## Arquitetura

```
app/(app)/          telas do painel (server components)
app/api/            webhooks, crons, importação, exportação, saúde
lib/db/             schema Drizzle e cliente Postgres
lib/ingest/         pipeline de ingestão + adaptadores por plataforma
lib/analytics/      DRE, split, metas, fiscal, caixa, clientes, capacidade
lib/actions/        server actions (classificação, despesas, sócios, config)
lib/ai/             analista financeiro de IA
components/         design system, gráficos e componentes de tela
scripts/            seed e reset
```

### Ingestão

Toda entrada de dinheiro — webhook, API, CSV, e-mail ou robô — passa pelo mesmo
pipeline: o payload cru é guardado em `raw_events`, a transação é deduplicada por
chave natural + hash, classificada por regras e só então gravada. É isso que
permite importar períodos sobrepostos sem duplicar e trocar a fonte da InfinitePay
depois sem tocar em nada a jusante.

### Regime duplo

Toda transação guarda a data da venda **e** a data de recebimento. O DRE alterna
entre caixa e competência sem recalcular nada à mão — a diferença entre os dois é
exatamente o parcelado a receber.

### Divisão entre sócios

As regras são versionadas por vigência e por tipo de produto. A regra atual (10%
para o caixa; do que sobra, 80% Yuri / 20% Gustavo) tem data de início; quando os
percentuais mudarem, cria-se uma nova vigência e os meses já fechados não mudam.

## Rotas de automação

| Rota | Uso |
|---|---|
| `POST /api/webhooks/kiwify?token=…` | Webhook da Kiwify |
| `POST /api/webhooks/cakto?token=…` | Webhook da Cakto |
| `GET /api/cron/sync?token=…&dias=15` | Sincroniza Kiwify e Cakto |
| `GET /api/cron/relatorio?token=…&tipo=semanal\|mensal` | Resumo por e-mail |
| `GET /api/export/transacoes?formato=csv\|xlsx` | Exportação de lançamentos |
| `GET /api/export/dre?regime=caixa\|competencia` | Exportação do DRE |
| `GET /api/health` | Sonda de saúde |

Os tokens vêm de `WEBHOOK_SECRET` e `CRON_SECRET`.

## Segurança

Sessão em JWT dentro de cookie httpOnly, senhas com bcrypt, segredos apenas em
variáveis de ambiente, webhooks e crons protegidos por token, e `audit_log` de
toda alteração financeira.
