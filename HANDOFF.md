# Estado do projeto — handoff

Última atualização: 15/08/2026. Leia junto com [ROADMAP.md](./ROADMAP.md).

## Onde está tudo

| Recurso | Endereço |
|---|---|
| Produção | https://gestao.yuridosanjos.com.br |
| Repositório | https://github.com/gustavomondrgn/Financeiro-Yuri (público, branch `main`) |
| Coolify | https://coolify.kandle.studio |
| Servidor | Hetzner, `87.99.142.152`, DNS na Cloudflare com proxy ligado |
| Banco de desenvolvimento | Neon, projeto `financeiro-yuri-dev` (`square-sea-66125482`) |

### UUIDs do Coolify

| Item | UUID |
|---|---|
| Servidor (`localhost`) | `vaur673aef258q0fqyhxqbg6` |
| Projeto "Yuri dos Anjos" | `anwurw57bvbacqk7af2o0lps` |
| Ambiente `production` | `bpd8dga4475da66nfquhgsl5` |
| Aplicação `financeiro-yuri` | `chskgova7zh4thecyry1r5p8` |
| Banco `financeiro-db` | `g3u786x3nxxf4l5ferkbgqpr` |

Deploy: `GET /api/v1/deploy?uuid=chskgova7zh4thecyry1r5p8&force=true` com
`Authorization: Bearer $COOLIFY_TOKEN`. O token está em `.env.local`.

## Acessos

Produção e desenvolvimento têm **bancos e senhas diferentes**. As senhas de produção estão
em `..\.financeiro-prod-secrets.txt` (fora do repositório) e nas variáveis de ambiente da
aplicação no Coolify.

- Produção: `gustavo@kandle.studio` e `yuri@yuridosanjos.com.br` — senhas no arquivo acima.
- Desenvolvimento (banco Neon, com dados fictícios): `gustavo@kandle.studio` / `44x0cNLGyqob`.

Trocar as senhas pela tela de Configurações no primeiro acesso.

## Como o deploy funciona

`npm start` roda `node scripts/bootstrap.mjs && next start`. O bootstrap é idempotente:
aplica o schema se as tabelas não existirem e cria a estrutura mínima (usuários, contas,
regra de divisão, categorias, produtos, meta, configurações). Existe porque o banco de
produção não tem porta pública — sem ele, a primeira migração exigiria abrir o firewall.

Ao alterar o schema: `npm run db:generate`, commitar o SQL em `drizzle/`, e o próximo
deploy aplica sozinho. O controle é por arquivo, na tabela `schema_migrations`: cada
`.sql` de `drizzle/` roda uma vez e fica registrado. Bancos que existiam antes dessa
tabela são reconhecidos e marcados como já aplicados no primeiro start, então ninguém
reexecuta a migração inicial.

## Decisões que valem lembrar

- **A InfinitePay não tem API *pública* de extrato** (só `POST /links` e
  `POST /payment_check`), mas o painel dela consome uma API interna que tem — mapeada em
  [docs/infinitepay-api.md](./docs/infinitepay-api.md) a partir do HAR. A ingestão
  multi-fonte com deduplicação continua sendo a arquitetura certa justamente por isso:
  quando esse token de sessão expirar, trocar para CSV ou e-mail não mexe em nada a
  jusante.
- **Extrato não vira receita.** O Pix recebido no extrato é a mesma venda que já veio
  pelo relatório de vendas, e o "Depósito de vendas" é a liquidação das vendas de cartão.
  Ingerir os dois dobraria o faturamento. Do extrato entram só as saídas.
- **Venda estornada continua `kind = 'sale'`**, com `status = 'refunded'`. Marcar como
  `refund` a tiraria da receita *e* a subtrairia de novo no DRE — desconto em dobro de um
  valor que nunca entrou.
- **Divisão dos sócios**: 10% do líquido para o caixa; do que sobra, 80% Yuri / 20%
  Gustavo. Versionada por vigência e tipo de produto — nunca editar uma regra existente,
  sempre criar vigência nova.
- **Regime duplo** (caixa e competência) em toda a camada analítica.
- **MEI acima do teto** é tratado como restrição do problema, não como sermão.
- **Piso do Yuri**: R$ 8.000/mês. Vira o cálculo de faturamento mínimo em várias telas.
- **Meta**: R$ 30k/mês até janeiro/2027.

## Automações no ar

Scheduled tasks do Coolify, na aplicação `financeiro-yuri`:

| Task | Quando | Comando |
| --- | --- | --- |
| `sync-plataformas` | `0 * * * *` (de hora em hora) | `node /app/scripts/cron.mjs sync` |
| `relatorio-semanal` | `0 8 * * 1` (segundas, 8h) | `node /app/scripts/cron.mjs semanal` |
| `relatorio-mensal` | `0 8 1 * *` (dia 1, 8h) | `node /app/scripts/cron.mjs mensal` |

O comando é um script do repositório, não um `curl` inline, por dois motivos: o campo
`command` do Coolify é `varchar(255)` e não cabe um curl com token e query, e a imagem
gerada pelo nixpacks não garante o `curl`. O segredo vai no header `x-cron-token`, não na
URL, para não aparecer no log de execução da task.

Backup do Postgres: diário às 3h, retenção de 30 dias / 30 arquivos / 2 GB local.

## Próximos passos, em ordem

1. **Token de sessão da InfinitePay** — é o de maior impacto. Destrava a ingestão
   automática de ~90% da receita e o backfill desde 2020, ambos já implementados e
   testados contra os payloads reais. Como pegar: [docs/infinitepay-api.md](./docs/infinitepay-api.md#autenticação).
   Depois de colar em `INFINITEPAY_SESSION_TOKEN` no Coolify, o backfill é uma chamada:
   `GET /api/cron/sync?dias=3000` com o header `x-cron-token`.
2. **Ver quanto tempo o token dura na prática.** Se durar semanas, está resolvido. Se
   durar horas, aí sim vale o worker Playwright que faz login sozinho — mas só aí,
   porque ele é bem mais caro de manter.
3. Credenciais de Kiwify, Cakto, Google Calendar, SMTP e `ANTHROPIC_API_KEY` conforme
   forem saindo.
4. Considerar tornar o repositório privado (hoje é público; não há segredo no código, mas
   a lógica de negócio fica exposta). Exige deploy key ou GitHub App no Coolify.

## Verificações já feitas

Desta sessão, contra os payloads reais do HAR e o banco de desenvolvimento:

- As 100 vendas do HAR mapeiam sem perda, com `bruto = líquido + taxa` fechando em todas.
- Conversão de fuso conferida no caso que importa: `2026-08-13T02:51:49Z` vira dia **12**
  em São Paulo, não 13.
- Do extrato, só as 48 saídas viram transação; nenhuma entrada vira receita.
- Reimportar o mesmo lote: 0 criados, 1 duplicado. Venda que muda para estornada:
  0 criados, 1 atualizado, e continua sendo **uma** linha.
- Efeito no DRE: a venda estornada sai da receita e **não** é subtraída de novo.

Build de produção limpo; as 13 telas respondendo 200; rota protegida redirecionando sem
sessão; `/api/health` verde local e em produção; exportação CSV e XLSX; **deduplicação
confirmada** (reimportar o mesmo lote resulta em 0 criados e 3 duplicados; lote com
sobreposição parcial deixa entrar só o inédito); paleta de gráficos validada para
daltonismo e contraste.
