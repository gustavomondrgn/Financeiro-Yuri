# API interna da InfinitePay

Mapa das rotas que o painel `app.infinitepay.io` consome, levantado a partir do
HAR de uma sessão real em 15/08/2026. **Não é API pública** — não tem contrato,
não tem versionamento e pode mudar sem aviso. O adaptador
([lib/ingest/adapters/infinitepay-api.ts](../lib/ingest/adapters/infinitepay-api.ts))
converte tudo para o formato interno, então uma mudança aqui não vaza para o
resto do sistema.

O HAR fica fora do repositório (`.gitignore` bloqueia `*.har`) e foi exportado
já sanitizado pelo Chrome — sem `Cookie` e sem `Authorization`.

## Autenticação

Header `Authorization` com o token de sessão do painel. As rotas também recebem
`x-source`, `x-correlation-id` e, no extrato, `x-timezone`.

Como pegar o token: abrir `app.infinitepay.io` logado, F12 → aba Network →
clicar em qualquer requisição para `*.services.production.infinitepay.io` →
copiar o valor do header `Authorization` → colar em `INFINITEPAY_SESSION_TOKEN`
(com ou sem o prefixo `Bearer`).

É **token de sessão, não credencial de integração**: expira. Quando expirar, o
job registra o erro em `job_runs` com a mensagem dizendo o que fazer, e o
`/api/health` continua verde — o sistema não quebra, só para de receber dados
novos dessa fonte até o token ser renovado.

## Rotas usadas

### Vendas — a fonte de receita

```
GET https://infinitepay-sales.services.production.infinitepay.io/v1/orders/reports/sales
    ?from_date=2020-01-01T03:00:00.000Z
    &to_date=2026-08-16T02:59:59.999Z
    &pg=true&limit=100
```

Aceita janela desde 2020 — é por aqui que o backfill do histórico acontece.
Paginação: `pagination.next_page` já vem como URL absoluta pronta.

Campos por venda:

| Campo | Observação |
|---|---|
| `id` | Vira o `externalId` e a chave de deduplicação |
| `datetime` | ISO em **UTC** — converter para São Paulo antes de virar data de negócio |
| `amount`, `net_amount` | **Em centavos**, já inteiros |
| `fee_percentage` | Só o percentual; a taxa em reais é `amount - net_amount` |
| `method` | `pix`, `credit`, `bank_slip` |
| `brand` | Vazio no Pix |
| `installments` | 1 a 12 |
| `status` | `approved`, `complete`, `denied`, `expired`, `refunded` |
| `transaction_origin` | `social_commerce`, `invoice`, `link`, `other` |
| `buyer.name` | Sem e-mail, telefone ou documento |

Rota irmã `/v1/orders/reports/sales/counted` devolve os totais por status e por
método — útil para conferir se o backfill trouxe tudo.

### Extrato — só as saídas

```
GET https://cloudwalk-statement-api.services.production.infinitepay.io/api/statements
    ?from_date=…&to_date=…&limit=100
```

Paginação por cursor em `pagination.nextPage`. Campos: `rawAmount` (centavos,
sempre positivo), `direction` (`in`/`out`), `type` (`Pix`, `Depósito de vendas`),
`title`, `subtitle`, `dateTime` (já com offset `-03:00`).

**As entradas do extrato são ignoradas de propósito.** O Pix recebido é a mesma
venda que já veio pelo relatório de vendas, e o "Depósito de vendas" é a
liquidação de vendas de cartão que também já vieram. Ingerir os dois dobraria o
faturamento — e com ele o DRE, o teto do MEI e a divisão dos sócios. Do extrato
entram apenas as saídas.

O custo dessa escolha: uma entrada que não seja venda (um aporte, uma devolução
de fornecedor) não é capturada e precisa ser lançada à mão. É deliberado —
errar para menos é recuperável, errar para mais contamina todo o resto.

### Saldo diário

```
GET …/api/balance/daily?start_date=2026-07-13&final_date=2026-08-14
```

Devolve `[{ date, balance }]`, saldo em centavos. Ainda não consumido; serve
para conferir a posição de caixa calculada contra a que a InfinitePay mostra.

## Rotas mapeadas e não usadas

`/transaction_payments/payments_overview`, `/devices`, `/invoices`,
`/plans/subscriptions`, `/sales-index/v1/sales/{search,counted,analytics}`.
A `sales-index` cobre o mesmo que o relatório de vendas com outro recorte; a
`invoices` interessa se as cobranças recorrentes virarem produto.

## Como fazer o backfill

Com o token configurado, o backfill usa o mesmo endpoint do sync de toda hora,
só com a janela larga:

```
GET /api/cron/sync?dias=3000    (header x-cron-token, ou ?token=)
```

Ou pelo container:

```
node /app/scripts/cron.mjs sync --dias=3000
```

A deduplicação torna a operação repetível: rodar de novo não duplica nada, e
vendas que mudaram de status desde a última passada são corrigidas.
