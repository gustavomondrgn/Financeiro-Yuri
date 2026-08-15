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

Header `Authorization` com o access token do painel. As rotas também recebem
`x-source`, `x-visitor-hash`, `x-correlation-id` e, no extrato, `x-timezone`.

### O atalho de navegador (caminho normal)

Em **Importar → Conectar a InfinitePay** há um link para arrastar até a barra de
favoritos. Com o painel da InfinitePay aberto, um clique nele instala uma
interceptação de `fetch` e `XMLHttpRequest` que lê o `Authorization` que a
própria página já envia e o repassa para `POST /api/infinitepay/token`.

Enquanto a aba ficar aberta, **cada token novo é enviado assim que o painel o
gera** — inclusive a renovação de 30 em 30 minutos. Ou seja: aba aberta, o sync
de hora em hora funciona sozinho.

O código vive em [lib/infinitepay-bookmarklet.ts](../lib/infinitepay-bookmarklet.ts)
e não lê senha, não toca em cookie e não guarda nada no navegador. Ele só
observa um header que a página já está mandando.

Detalhe que quebra em silêncio se esquecido: as linhas são coladas sem
separador para virar uma URL, então **nenhum comentário `//` pode existir** no
código do atalho — ele comentaria o resto do programa inteiro. `buildBookmarklet`
falha explicitamente se encontrar um.

### À mão (alternativa)

Abrir `app.infinitepay.io` logado, F12 → aba Network → clicar em qualquer
requisição para `*.services.production.infinitepay.io` → copiar o valor do
header `Authorization` e colar em **Importar → Sincronizar → Colar o token à
mão**.

### O access token dura 30 minutos

Medido no JWT: `exp - iat = 1800`. É um ES256 assinado pela InfinitePay, com
escopos de leitura (`dashboard/financial/read`, `dashboard/banking/read`,
`nf/sales/read`, entre outros) — leitura só, nenhum escopo de escrita.

Por isso **o token não mora em variável de ambiente**: é colado na tela de
importação e usado só naquela execução, sem ficar guardado. Trinta minutos
sobram para o backfill do histórico inteiro, que é a operação que importa.

### A sessão, essa dura muito

O mesmo JWT traz `signed_in_at` e `session_id`. Num token capturado em
15/08/2026, o `signed_in_at` era **05/08/2026** — nove dias antes. Ou seja, a
sessão do navegador sobrevive muito além dos 30 minutos, e existe alguma rota
que troca a sessão por um access token novo.

Essa rota **não** está no HAR: a captura foi feita 25 minutos depois da emissão
do token, ainda dentro da validade, então nenhuma renovação aconteceu durante a
gravação. Achá-la é o que separa "colar token quando quiser puxar" de
"sincronizar sozinho de hora em hora".

Como achar, quando valer a pena: deixar o painel aberto e o DevTools gravando
por mais de 30 minutos, com "Preserve log" ligado, e exportar o HAR depois que
uma chamada nova voltar a funcionar. A requisição de renovação vai estar ali —
provavelmente em `auth.infinitepay.io` ou numa rota `/api/*` do próprio
`app.infinitepay.io`, que guarda a sessão num cookie httpOnly
(`POST /api/session/login` aparece no HAR e devolve só `{"isFinancialManager":false}`,
o que tem cara de "a sessão foi para o cookie").

### Verificação sem token válido

Com um token expirado, os dois endpoints respondem **401** e uma URL inventada
no mesmo host responde **404**. Isso confirma que os caminhos e o formato das
requisições estão certos e que só falta credencial viva.

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

Em **Importar → Sincronizar com a InfinitePay**: colar o token no campo e
clicar em **Histórico completo**. A tela lê o `exp` do próprio token e mostra
quantos minutos restam antes de você gastar a corrida.

O caminho é o mesmo do sync de toda hora, só com a janela larga — dá para
disparar pela API se preferir:

```
GET /api/cron/sync?dias=3000    (header x-cron-token, ou ?token=)
```

Ou pelo container:

```
node /app/scripts/cron.mjs sync --dias=3000
```

A deduplicação torna a operação repetível: rodar de novo não duplica nada, e
vendas que mudaram de status desde a última passada são corrigidas.
