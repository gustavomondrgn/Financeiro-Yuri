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
deploy aplica sozinho. **Atenção**: o bootstrap só aplica migrações quando a tabela
`transactions` não existe. Para alterações futuras de schema, o passo seguinte é trocar
essa checagem por uma tabela de controle de migrações aplicadas.

## Decisões que valem lembrar

- **InfinitePay não tem API de extrato.** Só `POST /links` e `POST /payment_check`. Por
  isso a ingestão é multi-fonte com deduplicação: webhook, API, CSV e e-mail alimentam a
  mesma tabela, e trocar a fonte não mexe em nada a jusante.
- **Divisão dos sócios**: 10% do líquido para o caixa; do que sobra, 80% Yuri / 20%
  Gustavo. Versionada por vigência e tipo de produto — nunca editar uma regra existente,
  sempre criar vigência nova.
- **Regime duplo** (caixa e competência) em toda a camada analítica.
- **MEI acima do teto** é tratado como restrição do problema, não como sermão.
- **Piso do Yuri**: R$ 8.000/mês. Vira o cálculo de faturamento mínimo em várias telas.
- **Meta**: R$ 30k/mês até janeiro/2027.

## Próximos passos, em ordem

1. **Scheduled tasks no Coolify** para os crons:
   - `curl -fsS "https://gestao.yuridosanjos.com.br/api/cron/sync?token=$CRON_SECRET&dias=15"` (a cada hora)
   - `curl -fsS "https://gestao.yuridosanjos.com.br/api/cron/relatorio?token=$CRON_SECRET&tipo=semanal"` (segundas)
   - `curl -fsS "https://gestao.yuridosanjos.com.br/api/cron/relatorio?token=$CRON_SECRET&tipo=mensal"` (dia 1)
2. **Backup diário** do Postgres no Coolify com retenção.
3. **HAR do `app.infinitepay.io`** — decide se a ingestão dos 90% da receita vira
   automática ou fica no CSV. Passo a passo: abrir o app logado no navegador, F12 → aba
   Network → marcar "Preserve log" → navegar pelo extrato → botão de exportar HAR → salvar
   na pasta do projeto (o `.gitignore` já bloqueia `*.har`).
4. **Backfill do histórico real**: exportar CSV da InfinitePay desde o início e importar
   pela tela `/importar`.
5. Credenciais de Kiwify, Cakto, Google Calendar, SMTP e `ANTHROPIC_API_KEY` conforme
   forem saindo.
6. Considerar tornar o repositório privado (hoje é público; não há segredo no código, mas
   a lógica de negócio fica exposta). Exige deploy key ou GitHub App no Coolify.

## Verificações já feitas

Build de produção limpo; as 13 telas respondendo 200; rota protegida redirecionando sem
sessão; `/api/health` verde local e em produção; exportação CSV e XLSX; **deduplicação
confirmada** (reimportar o mesmo lote resulta em 0 criados e 3 duplicados; lote com
sobreposição parcial deixa entrar só o inédito); paleta de gráficos validada para
daltonismo e contraste.
