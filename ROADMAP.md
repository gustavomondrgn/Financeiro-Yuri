# Roadmap — Financeiro Yuri dos Anjos

Sistema de gestão financeira, DRE e inteligência estratégica.
Meta do negócio: **R$ 30k/mês recorrentes até janeiro/2027**.

---

## Fase 0 — Descoberta e decisões

- [x] Mapear a API de cada plataforma de recebimento (InfinitePay, Kiwify, Cakto)
- [x] Confirmar que a InfinitePay **não tem** API de extrato (só `POST /links` e `POST /payment_check`)
- [x] Descartar Open Finance via Pluggy (R$ 2.500/mês) e Meu Pluggy (proíbe uso comercial)
- [x] Levantar endpoint de vendas da Kiwify (`GET /v1/sales`, janela de 90 dias, OAuth2)
- [x] Levantar endpoint de pedidos da Cakto (`GET /public_api/orders/`, com UTM por pedido)
- [x] Definir estratégia multi-fonte com deduplicação como resposta à ausência de API
- [x] Fechar as regras de negócio com o Gustavo (split, piso do Yuri, meta, fiscal)
- [ ] **Sonda da API interna do `app.infinitepay.io`** — depende do HAR (ver "O que preciso de você")

## Fase 1 — Fundação

- [x] Projeto Next.js 16 + TypeScript + Tailwind 4
- [x] Banco Postgres de desenvolvimento (Neon `financeiro-yuri-dev`)
- [x] Schema completo em Drizzle — 19 tabelas, enums, índices
- [x] Migrations geradas e aplicadas
- [x] Cliente de banco com pool cacheado (sobrevive ao hot reload)
- [x] Camada de ambiente tipada (`lib/env.ts`) com falha explícita no boot
- [x] Helpers de dinheiro em centavos (rateio sem perder centavo, parser de "R$ 1.234,56")
- [x] Helpers de data no fuso de São Paulo (sem o bug de `new Date('2026-08-15')`)
- [x] Autenticação própria (JWT em cookie httpOnly, bcrypt, 2 usuários)
- [x] Middleware de rota protegida
- [x] Tela de login
- [x] Seed de estrutura (usuários, contas, regra 10/80-20, produtos, categorias, meta)
- [x] Seed de demonstração (763 transações, 335 clientes, 54 despesas, 18 meses)
- [x] Script de reset (limpa dados, preserva estrutura)

## Fase 2 — Design system

- [x] Paleta validada para daltonismo e contraste (ΔE CVD ≥ 8 entre pares adjacentes)
- [x] Tokens de tema claro e escuro
- [x] Primitivos de UI (Card, Stat, Badge, Table, Button, Input, ProgressBar)
- [x] Componentes de gráfico (mensal, diário, composição, fluxo de caixa, projeção, taxa efetiva)
- [x] Shell com navegação lateral e responsividade mobile
- [x] Impressão limpa (Ctrl+P gera o PDF do DRE)

## Fase 3 — Pipeline de ingestão

- [x] Tabela `raw_events` imutável (payload cru de toda fonte)
- [x] Deduplicação por chave natural + hash, com índice de ocorrência
- [x] Pipeline único (`ingestBatch`) para webhook, API, CSV, e-mail e robô
- [x] Envelope de execução com registro em `job_runs`
- [x] Motor de classificação por regras (texto, faixa de valor, método, plataforma)
- [x] Criação de regra a partir de uma classificação manual
- [x] Reaplicação de regras à fila pendente
- [x] Unificação de identidade de cliente (documento > e-mail > telefone > nome)
- [x] Recálculo de agregados de cliente (LTV, recompra, primeira/última compra)

## Fase 4 — Adaptadores

- [x] InfinitePay — parser de CSV com detecção automática de colunas e mapeamento manual
- [x] InfinitePay — detecção de natureza (venda, taxa, transferência, estorno, saque)
- [x] OFX — parser próprio (serve InfinitePay e qualquer banco)
- [x] Kiwify — OAuth2, `GET /v1/sales`, fatiamento automático em janelas de 90 dias
- [x] Cakto — Bearer, `GET /public_api/orders/`, paginação e UTM
- [x] Webhook da Kiwify
- [x] Webhook da Cakto
- [ ] InfinitePay — adaptador de API interna (bloqueado pelo HAR)
- [ ] InfinitePay — ingestão por e-mail (IMAP / Cloudflare Email Routing)
- [ ] InfinitePay — worker Playwright no Coolify
- [ ] Banco Inter PJ — API oficial (quando a conta migrar)

## Fase 5 — Camada analítica

- [x] Receita por período, dia, mês, plataforma, produto, tipo e origem
- [x] Regime duplo (caixa e competência) em todas as consultas
- [x] Taxa efetiva de adquirência por método e parcelamento
- [x] DRE gerencial completo (bruta → líquida → contribuição → operacional → líquido → retido)
- [x] Ponto de equilíbrio em reais e em número de atendimentos
- [x] Motor de divisão versionado (10% caixa → 80/20, por vigência e tipo de produto)
- [x] Faturamento necessário para o Yuri bater o piso
- [x] Posição de caixa, runway e previsão de 90 dias
- [x] Monitor do teto do MEI (excesso, tolerância de 20%, projeção)
- [x] Simulador do Simples Nacional (Anexo III × V, Fator R)
- [x] Projeção do mês e regressão de tendência até a meta
- [x] Métricas de cliente (LTV, recompra, concentração, coortes)
- [x] Lista de reativação (clientes vencidos, ordenada por valor)
- [x] Capacidade da agenda e teto físico do serviço
- [x] Motor de alertas com limiares explícitos

## Fase 6 — Telas

- [x] Visão geral (KPIs, meta, alertas, divisão, mix, comparativos)
- [x] Receitas (filtros, taxa efetiva, origem, tabela paginada)
- [x] Fila de classificação (com criação de regra em 2 cliques)
- [x] Despesas e contas a pagar (recorrência, vencimento, previsão de caixa)
- [x] DRE (regime alternável, comparativo, ponto de equilíbrio)
- [x] Sócios (divisão, regras versionadas, retiradas, piso)
- [x] Clientes (reativação, coortes, novos × recorrentes, maiores clientes)
- [x] Metas e projeção (tendência, caminho até 30k, tradução em ações)
- [x] Capacidade (ocupação, receita por hora, teto do serviço)
- [x] Fiscal (teto MEI, simulador do Simples, provisões)
- [x] Inteligência (simulador de cenários + analista de IA)
- [x] Importar (upload, mapeamento, prévia, histórico de execuções)
- [ ] Configurações (usuários, produtos, integrações, jobs, backups)

## Fase 7 — Inteligência

- [x] Simulador de cenários interativo (ticket, volume, custo, split, agenda)
- [x] Cálculo de meses até a meta por crescimento composto
- [x] Analista de IA com retrato numérico fechado (não inventa dado)
- [x] Histórico de análises geradas
- [ ] Resumo automático semanal por e-mail
- [ ] Cron de análise mensal

## Fase 8 — API e automações

- [x] Rota de importação com validação (Zod) e modo simulação
- [x] Webhooks das plataformas de infoproduto
- [x] Cron de sincronização (Kiwify + Cakto)
- [x] Cron do resumo semanal
- [x] Exportação em CSV e Excel
- [x] Rota de saúde para monitoramento
- [ ] Sincronização do Google Calendar

## Fase 9 — Produção

- [x] Repositório Git inicializado e enviado ao GitHub
- [ ] Deploy no Coolify (bloqueado: falta a URL da instância)
- [ ] Domínio `financeiro.yuridosanjos.com.br` com TLS
- [ ] Postgres em produção + variáveis de ambiente
- [ ] Scheduled tasks dos crons
- [ ] Backup diário com retenção
- [ ] Worker Playwright como segundo container

---

## O que preciso de você

| # | Item | Destrava |
|---|------|----------|
| 1 | **URL da instância Coolify** | Deploy inteiro (o token já tenho) |
| 2 | **HAR do `app.infinitepay.io` logado** | Ingestão automática da InfinitePay |
| 3 | **Extratos históricos da InfinitePay** (CSV) | Backfill do histórico real |
| 4 | Credenciais Kiwify (client id, secret, account id) | Sync automático de infoproduto |
| 5 | Token da Cakto | Sync automático de infoproduto |
| 6 | Google OAuth + calendário do Yuri | Capacidade e ocupação reais |
| 7 | Lista de serviços com preços atuais | Classificação automática afinada |
| 8 | SMTP (ou conta Resend) | Resumo semanal por e-mail |
| 9 | `ANTHROPIC_API_KEY` | Analista de IA |

---

## Como rodar

```bash
npm run dev          # sobe em http://localhost:3000
npm run db:push      # aplica o schema
npm run db:seed      # estrutura (adicione -- --demo para dados fictícios)
npm run db:reset     # limpa dados, preserva estrutura
npm run db:studio    # inspeciona o banco
```
