import { randomUUID } from 'node:crypto'
import { normalizeDate, type IsoDate } from '@/lib/dates'
import { env } from '@/lib/env'
import type { NormalizedTx, PaymentMethod, TxKind, TxStatus } from '../types'

/**
 * Adaptador da API interna do painel da InfinitePay.
 *
 * A InfinitePay não publica API de extrato — só `POST /links` e
 * `POST /payment_check`. O que existe é a API que o próprio painel
 * (`app.infinitepay.io`) consome, mapeada a partir do HAR de uma sessão real.
 * Duas rotas interessam:
 *
 *   GET infinitepay-sales…/v1/orders/reports/sales
 *       from_date, to_date (ISO), pg=true, limit, status
 *       → vendas, com bruto, líquido, bandeira, parcelas e comprador.
 *         Aceita janela desde 2020 — é por aqui que o backfill acontece.
 *
 *   GET cloudwalk-statement-api…/api/statements
 *       from_date, to_date, limit, cursor em pagination.nextPage
 *       → extrato da conta: Pix enviado/recebido e depósito de vendas.
 *
 * **Por que o extrato não vira receita.** O Pix recebido no extrato é a mesma
 * venda que já veio pelo relatório de vendas, e o "Depósito de vendas" é a
 * liquidação de vendas de cartão que também já vieram. Ingerir os dois
 * dobraria o faturamento — e com ele o DRE, o teto do MEI e a divisão dos
 * sócios. Então o relatório de vendas é a única fonte de receita, e do extrato
 * entram apenas as saídas (dinheiro que sai da conta). Entradas do extrato que
 * não sejam venda (aporte, devolução de fornecedor) ficam de fora de propósito
 * e são lançadas à mão — errar para menos aqui é recuperável, errar para mais
 * contamina todo o resto.
 *
 * Autenticação: `Authorization` com o token de sessão do painel
 * (`INFINITEPAY_SESSION_TOKEN`). É um token de sessão, não uma credencial de
 * integração: expira. Quando expirar, as rotas respondem 401 e o job registra
 * o erro em `job_runs` em vez de falhar silencioso.
 */

const SALES_URL = 'https://infinitepay-sales.services.production.infinitepay.io'
const STATEMENT_URL = 'https://cloudwalk-statement-api.services.production.infinitepay.io'

/** Identifica o cliente como o painel faz — algumas rotas recusam sem isso. */
const CLIENT_SOURCE = 'InfiniteDashboard/v2026.08.14-7038e28'

/**
 * O painel manda um `x-visitor-hash` fixo por navegador. Não parece ser
 * verificado, mas vai junto porque aparece em todo preflight — e um valor
 * estável é mais parecido com um cliente real do que um sorteado a cada
 * requisição. Dá para trocar por env se algum dia passar a ser validado.
 */
const VISITOR_HASH = process.env.INFINITEPAY_VISITOR_HASH || '7c1a5f28-3d9e-4b60-8a12-5f0c9e7d4b31'

export class InfinitePayAuthError extends Error {
  constructor() {
    super(
      'O token da InfinitePay expirou ou é inválido (401). Ele dura 30 minutos: ' +
        'abra app.infinitepay.io, copie o Authorization de novo e cole aqui.',
    )
    this.name = 'InfinitePayAuthError'
  }
}

/**
 * Token da requisição.
 *
 * O access token do painel **dura 30 minutos** (conferido no `exp` do JWT
 * contra o `iat`). Por isso o valor colado na tela tem prioridade sobre o do
 * ambiente: guardar um segredo de 30 minutos numa env var só serviria para a
 * primeira execução depois do deploy.
 */
export interface InfinitePayAuth {
  /** Token colado na hora; sem ele, cai no `INFINITEPAY_SESSION_TOKEN`. */
  token?: string
}

function resolveToken(auth?: InfinitePayAuth): string {
  const token = (auth?.token || env.infinitepay.sessionToken).trim()
  if (!token) throw new Error('Token de sessão da InfinitePay não informado.')
  // Aceita o valor colado com ou sem o prefixo "Bearer".
  return /^bearer /i.test(token) ? token : `Bearer ${token}`
}

/** Minutos restantes do token, lendo o `exp` sem validar assinatura. */
export function tokenMinutesLeft(token: string): number | null {
  try {
    const payload = token.replace(/^bearer /i, '').split('.')[1]
    if (!payload) return null
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp?: number }
    if (!claims.exp) return null
    return Math.round((claims.exp * 1000 - Date.now()) / 60000)
  } catch {
    return null
  }
}

function headers(auth?: InfinitePayAuth): Record<string, string> {
  return {
    Authorization: resolveToken(auth),
    Accept: 'application/json',
    'x-source': CLIENT_SOURCE,
    'x-correlation-id': randomUUID(),
    'x-visitor-hash': VISITOR_HASH,
    'x-timezone': 'America/Sao_Paulo',
  }
}

async function get<T>(url: URL | string, auth?: InfinitePayAuth): Promise<T> {
  const response = await fetch(url, { headers: headers(auth), cache: 'no-store' })

  if (response.status === 401 || response.status === 403) throw new InfinitePayAuthError()
  if (!response.ok) {
    throw new Error(`InfinitePay respondeu ${response.status}: ${(await response.text()).slice(0, 300)}`)
  }

  return (await response.json()) as T
}

/** Início do dia em São Paulo (UTC-3), no formato que a API espera. */
function startOfDay(date: IsoDate): string {
  return `${date}T03:00:00.000Z`
}

/** Fim do dia em São Paulo: 23:59:59.999 local = 02:59:59.999Z do dia seguinte. */
function endOfDay(date: IsoDate): string {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return `${next.toISOString().slice(0, 10)}T02:59:59.999Z`
}

// ---------------------------------------------------------------------------
// Vendas
// ---------------------------------------------------------------------------

interface InfinitePaySale {
  id?: number | string
  order_id?: string | null
  datetime?: string
  type?: string
  /** Em centavos, como a API devolve. */
  amount?: number
  net_amount?: number
  brand?: string
  method?: string
  installments?: number
  status?: string
  origin?: string
  nsu?: string
  transaction_origin?: string
  fee_percentage?: number
  buyer?: { name?: string; email?: string; phone?: string; document?: string } | null
  plan_or_description?: string
  [key: string]: unknown
}

interface SalesPage {
  pagination?: { entries?: number; next_page?: string | null; next_page_id?: string | null }
  results?: InfinitePaySale[]
}

function mapSaleStatus(status?: string): TxStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'approved':
    case 'complete':
    case 'completed':
      return 'approved'
    case 'refunded':
      return 'refunded'
    case 'chargeback':
    case 'chargedback':
      return 'chargeback'
    case 'denied':
    case 'expired':
    case 'canceled':
    case 'cancelled':
      return 'canceled'
    default:
      return 'pending'
  }
}

function mapSaleMethod(method?: string, type?: string): PaymentMethod | null {
  const text = `${method ?? ''} ${type ?? ''}`.toLowerCase()
  if (text.includes('pix')) return 'pix'
  if (text.includes('bank_slip') || text.includes('boleto')) return 'boleto'
  if (text.includes('debit')) return 'debit_card'
  if (text.includes('credit') || text.includes('card')) return 'credit_card'
  return null
}

/** Rótulo legível da origem, usado pela classificação e pelas telas. */
function saleOrigin(sale: InfinitePaySale): string | null {
  const map: Record<string, string> = {
    social_commerce: 'Redes sociais',
    invoice: 'Cobrança',
    link: 'Link de pagamento',
    other: 'Outros',
  }
  const key = (sale.transaction_origin ?? '').toLowerCase()
  return map[key] ?? sale.transaction_origin ?? null
}

export function infinitePaySaleToTx(sale: InfinitePaySale): NormalizedTx | null {
  if (!sale.datetime) return null
  // `datetime` vem em UTC — converter via Date para acertar o dia em São Paulo.
  const saleDate = normalizeDate(new Date(sale.datetime))
  if (!saleDate) return null

  const gross = Math.abs(Math.round(sale.amount ?? 0))
  const net = Math.abs(Math.round(sale.net_amount ?? 0))
  // A API não manda a taxa em reais, só o percentual — o líquido é a verdade.
  const fee = Math.max(0, gross - net)

  const status = mapSaleStatus(sale.status)
  const method = mapSaleMethod(sale.method, sale.type)

  const brand = (sale.brand ?? '').trim()
  const descriptionParts = [
    method === 'pix' ? 'Venda Pix' : 'Venda no cartão',
    brand ? brand.toUpperCase() : null,
    (sale.installments ?? 1) > 1 ? `${sale.installments}x` : null,
  ].filter(Boolean)

  return {
    platform: 'infinitepay',
    source: 'internal_api',
    externalId: sale.id != null ? String(sale.id) : (sale.nsu ?? null),
    // Sempre `sale`, mesmo estornada — quem carrega a verdade é o status.
    //
    // O relatório de vendas devolve uma linha por venda com o estado atual,
    // não uma linha de venda mais uma de estorno como o extrato em CSV. Como
    // o DRE soma receita por `kind = 'sale' and status = 'approved'` e desconta
    // separadamente `kind in ('refund','chargeback')`, marcar a linha como
    // estorno a tiraria da receita *e* a subtrairia de novo — descontando duas
    // vezes um valor que nunca entrou. Com `sale` + `refunded` ela apenas sai
    // da receita, que é o efeito certo, e continua visível como "Estornada"
    // na tela de receitas.
    kind: 'sale',
    status,
    method,
    installments: sale.installments ?? 1,
    grossCents: gross,
    feeCents: fee,
    netCents: net,
    saleDate,
    // Sem data de liquidação na resposta: no regime de caixa o recebimento do
    // cartão é antecipado (plan "d_1_anticipation"), então a data da venda é a
    // melhor aproximação disponível — e o extrato confirma o depósito.
    receiptDate: status === 'approved' ? saleDate : null,
    description: descriptionParts.join(' '),
    counterpartyName: sale.buyer?.name?.trim() || null,
    counterpartyEmail: sale.buyer?.email?.trim() || null,
    counterpartyPhone: sale.buyer?.phone?.trim() || null,
    counterpartyDocument: sale.buyer?.document?.trim() || null,
    origin: saleOrigin(sale),
    productHint: null,
    raw: sale,
  }
}

export async function fetchInfinitePaySales(
  start: IsoDate,
  end: IsoDate,
  options: { maxPages?: number } & InfinitePayAuth = {},
): Promise<NormalizedTx[]> {
  const out: NormalizedTx[] = []
  // 100 por página; o teto cobre ~50 mil vendas antes de parar sozinho.
  const maxPages = options.maxPages ?? 500

  const first = new URL('/v1/orders/reports/sales', SALES_URL)
  first.searchParams.set('from_date', startOfDay(start))
  first.searchParams.set('to_date', endOfDay(end))
  first.searchParams.set('pg', 'true')
  first.searchParams.set('limit', '100')

  let next: string | null = first.toString()
  let pages = 0

  while (next && pages < maxPages) {
    const page: SalesPage = await get<SalesPage>(next, options)
    const results = page.results ?? []

    for (const sale of results) {
      const tx = infinitePaySaleToTx(sale)
      if (tx) out.push(tx)
    }

    pages += 1
    // A API devolve a próxima página como URL absoluta e pronta.
    next = results.length > 0 ? (page.pagination?.next_page ?? null) : null
  }

  return out
}

// ---------------------------------------------------------------------------
// Extrato
// ---------------------------------------------------------------------------

interface StatementEntry {
  id?: string
  /** Em centavos, sempre positivo — o sinal está em `direction`. */
  rawAmount?: number
  formattedAmount?: string
  dateTime?: string
  title?: string
  subtitle?: string
  type?: string
  direction?: 'in' | 'out'
  [key: string]: unknown
}

interface StatementPage {
  pagination?: { nextPage?: string | null }
  data?: StatementEntry[]
}

/** Saque para conta própria x pagamento a terceiro mudam a leitura do caixa. */
function statementKind(entry: StatementEntry): TxKind {
  const text = `${entry.type ?? ''} ${entry.title ?? ''} ${entry.subtitle ?? ''}`.toLowerCase()
  if (text.includes('saque') || text.includes('transferência para conta')) return 'withdrawal'
  return 'transfer_out'
}

export function infinitePayStatementToTx(entry: StatementEntry): NormalizedTx | null {
  // Só saídas: as entradas já vêm pelo relatório de vendas (ver cabeçalho).
  if (entry.direction !== 'out') return null
  if (!entry.dateTime) return null

  const date = normalizeDate(new Date(entry.dateTime))
  if (!date) return null

  const amount = Math.abs(Math.round(entry.rawAmount ?? 0))
  if (amount === 0) return null

  const method: PaymentMethod = (entry.type ?? '').toLowerCase().includes('pix') ? 'pix' : 'transfer'

  return {
    platform: 'infinitepay',
    source: 'internal_api',
    externalId: entry.id ? `stmt:${entry.id}` : null,
    kind: statementKind(entry),
    status: 'approved',
    method,
    installments: 1,
    grossCents: amount,
    feeCents: 0,
    netCents: amount,
    saleDate: date,
    receiptDate: date,
    description: [entry.type, entry.subtitle].filter(Boolean).join(' — ') || 'Saída InfinitePay',
    counterpartyName: entry.title?.trim() || null,
    origin: 'Extrato InfinitePay',
    raw: entry,
  }
}

export async function fetchInfinitePayStatements(
  start: IsoDate,
  end: IsoDate,
  options: { maxPages?: number } & InfinitePayAuth = {},
): Promise<NormalizedTx[]> {
  const out: NormalizedTx[] = []
  const maxPages = options.maxPages ?? 500

  const build = (cursor: string | null): URL => {
    const url = new URL('/api/statements', STATEMENT_URL)
    url.searchParams.set('from_date', startOfDay(start))
    url.searchParams.set('to_date', endOfDay(end))
    url.searchParams.set('limit', '100')
    if (cursor) url.searchParams.set('cursor', cursor)
    return url
  }

  let cursor: string | null = null
  let pages = 0

  while (pages < maxPages) {
    const page: StatementPage = await get<StatementPage>(build(cursor), options)
    const rows = page.data ?? []

    for (const entry of rows) {
      const tx = infinitePayStatementToTx(entry)
      if (tx) out.push(tx)
    }

    pages += 1
    cursor = rows.length > 0 ? (page.pagination?.nextPage ?? null) : null
    if (!cursor) break
  }

  return out
}
