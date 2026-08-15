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
- [x] **Sonda da API interna do `app.infinitepay.io`** — HAR analisado, rotas mapeadas em [docs/infinitepay-api.md](./docs/infinitepay-api.md). **Existe API de extrato e de vendas**, com janela desde 2020: a ingestão da InfinitePay vira automática, não fica no CSV

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
- [x] InfinitePay — adaptador de API interna (vendas + extrato), confirmado com 401 real contra 404 de controle
- [x] InfinitePay — backfill desde 2020 pelo mesmo endpoint do sync (`?dias=3000`)
- [x] InfinitePay — token colado na hora, porque o access token dura só 30 minutos
- [x] InfinitePay — atalho de navegador que captura o token sozinho e reenvia a cada renovação
- [x] Segredos cifrados em repouso (AES-256-GCM) — `ENCRYPTION_KEY` finalmente em uso
- [ ] **InfinitePay — rota de renovação do access token** (a sessão dura 9 dias; achar isso tira a dependência de aba aberta)
- [ ] InfinitePay — ingestão por e-mail (IMAP / Cloudflare Email Routing) — vira plano B, o A agora é a API
- [ ] InfinitePay — worker Playwright no Coolify — só se o token de sessão se mostrar curto demais na prática
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
- [x] Importar — sincronização e backfill da InfinitePay por botão, sem terminal
- [x] Configurações (usuários, produtos, contas, integrações, metas, marcadores)

## Fase 7 — Inteligência

- [x] Simulador de cenários interativo (ticket, volume, custo, split, agenda)
- [x] Cálculo de meses até a meta por crescimento composto
- [x] Analista de IA com retrato numérico fechado (não inventa dado)
- [x] Histórico de análises geradas
- [x] Resumo semanal (números do banco, funciona mesmo sem chave de IA)
- [x] Cron de análise mensal com envio por e-mail

## Fase 8 — API e automações

- [x] Rota de importação com validação (Zod) e modo simulação
- [x] Webhooks das plataformas de infoproduto (token na URL)
- [x] Cron de sincronização (Kiwify + Cakto, janela sobreposta)
- [x] Cron do resumo semanal e do fechamento mensal
- [x] Exportação em CSV (ponto-e-vírgula + BOM) e Excel
- [x] Rota de saúde para monitoramento
- [ ] Sincronização do Google Calendar

## Verificações executadas

- [x] Build de produção sem erros e sem avisos de tipo
- [x] As 13 telas respondem 200 com sessão válida
- [x] Rota protegida sem sessão redireciona para `/login`
- [x] `/api/health` conecta no banco (122 ms)
- [x] Exportação de transações e DRE em CSV e XLSX
- [x] **Deduplicação**: reimportar o mesmo lote → 0 criados, 3 duplicados
- [x] **Sobreposição**: lote parcialmente novo → só o inédito entra
- [x] Paleta dos gráficos validada para daltonismo e contraste
- [x] Dados de teste do smoke test removidos do banco

## Fase 9 — Produção

- [x] Repositório Git inicializado, commits e push para o GitHub
- [x] Postgres de produção no Coolify (`financeiro-db`, sem porta pública)
- [x] Aplicação criada no projeto "Yuri dos Anjos", ambiente `production`
- [x] Variáveis de ambiente e segredos de produção configurados pela API
- [x] Deploy concluído e rodando
- [x] Domínio `gestao.yuridosanjos.com.br` respondendo em HTTPS (proxy da Cloudflare funcionou)
- [x] Bootstrap idempotente no start: aplica schema e cria estrutura mínima
- [x] `/api/health` verde em produção (banco a 1 ms pela rede interna)
- [x] Controle de migrações por arquivo (`schema_migrations`) — alteração de schema agora chega ao banco
- [x] Scheduled tasks dos crons: sync de hora em hora, relatório semanal (segundas 8h) e mensal (dia 1, 8h)
- [x] Backup diário do Postgres às 3h, retenção de 30 dias / 30 arquivos / 2 GB
- [ ] Worker Playwright como segundo container

---

## Fase 10 — Plataforma "Gestão" (futuro, não agora)

> Registrado a pedido do Gustavo, nas palavras dele:
>
> "Além desse sistema de finanças, eu quero fazer meio que um sistema de produtividade
> também. Que obviamente não vai ser dentro de finanças, vai ser fora. Como se fosse um
> to-do list, um Trello da vida, só que eu ainda vou delimitar melhor isso. Mas eu queria
> manter tudo dentro do mesmo local.
>
> Depois, em terceiro lugar, pode surgir uma terceira coisa, como se fosse um painel de
> gestão de conteúdo. Que eu conecto o Instagram, que eu conecto o YouTube, e aí ele
> consegue fazer análises robustas e ideias de conteúdo pra vídeo de YouTube, ele consegue
> fazer análises robustas de performance de carrosséis que a gente postou, de reels que a
> gente postou da nossa conta, e trazer insights melhores do que o Instagram.
>
> E enfim, manter sempre as coisas importantes de gestão do negócio no mesmo lugar. E eu
> chamei de Gestão. Então é possível que em breve esse repositório mude de nome,
> localmente, talvez até lá no GitHub, e vire Gestão. E a gente vai criando esses lugares.
>
> Por enquanto só o financeiro tá bom, mas futuramente teria que ter um lugar ali de
> entrada que eu seleciono, por exemplo, o financeiro, aí vai pro financeiro. Seleciona o
> sistema de produtividade, tarefas da empresa, e aí vai pra esse sistema."

### Módulos previstos

- [ ] **Financeiro** — o que existe hoje
- [ ] **Produtividade** — tarefas e quadros da empresa (escopo a definir)
- [ ] **Conteúdo** — Instagram e YouTube conectados, análise de performance e ideias de pauta
- [ ] **Entrada** — tela inicial em `gestao.yuridosanjos.com.br` onde se escolhe o módulo

### Como eu faria (quando chegar a hora)

Uma aplicação só, um banco só, um login só — módulos como áreas dentro dela, não como
projetos separados. Concretamente: renomear o repositório para `Gestao`, mover as telas
atuais para `app/(app)/financeiro/*`, abrir `app/(app)/produtividade/*` e
`app/(app)/conteudo/*` ao lado, e transformar a raiz numa tela de entrada com os módulos.
O schema ganha prefixo por módulo (`fin_`, `task_`, `content_`) no mesmo Postgres, e o
`lib/` se organiza por domínio.

Sessão, design system, camada de banco e infraestrutura são reaproveitados inteiros — é
por isso que vale manter tudo junto em vez de subir três aplicações. Nenhum dado
financeiro precisa mudar de lugar: só o caminho da URL muda.

O módulo de conteúdo é o único que exige investigação prévia — a API do Instagram exige
conta Business vinculada a uma página do Facebook e passa por revisão do app; a do YouTube
é mais direta. Quando for a hora, faço o mesmo levantamento de viabilidade que fiz com as
plataformas de pagamento antes de desenhar qualquer coisa.

---

## O que preciso de você

| # | Item | Destrava |
| --- | --- | --- |
| 1 | **Token de sessão do `app.infinitepay.io`** | Ingestão automática e backfill desde 2020 — o passo aberto de maior impacto ([como pegar](./docs/infinitepay-api.md#autenticação)) |
| 2 | Credenciais Kiwify (client id, secret, account id) | Sync automático de infoproduto |
| 3 | Token da Cakto | Sync automático de infoproduto |
| 4 | Google OAuth + calendário do Yuri | Capacidade e ocupação reais |
| 5 | Lista de serviços com preços atuais | Classificação automática afinada |
| 6 | SMTP (ou conta Resend) | Resumo semanal por e-mail |
| 7 | `ANTHROPIC_API_KEY` | Analista de IA |

Resolvidos: URL do Coolify, push para o GitHub e o HAR do `app.infinitepay.io`.
Os extratos históricos em CSV deixaram de ser necessários — o backfill vem pela
API assim que o token de sessão existir.

---

## Como rodar

```bash
npm run dev          # sobe em http://localhost:3000
npm run db:push      # aplica o schema
npm run db:seed      # estrutura (adicione -- --demo para dados fictícios)
npm run db:reset     # limpa dados, preserva estrutura
npm run db:studio    # inspeciona o banco
```
