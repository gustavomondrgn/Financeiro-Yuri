import { normalizeDate } from '@/lib/dates'
import { toCents } from '@/lib/money'
import { env } from '@/lib/env'
import type { NormalizedTx, PaymentMethod, TxStatus } from '../types'

/**
 * Adaptador da Cakto — API oficial, paginada, com UTM por pedido.
 *
 * GET https://api.cakto.com.br/public_api/orders/
 * Bearer token, filtros de data com sufixos __gte/__lte.
 */

const BASE_URL = 'https://api.cakto.com.br'

interface CaktoOrder {
  id?: string
  refId?: string
  amount?: number | string
  baseAmount?: number | string
  fees?: number | string
  discount?: number | string
  status?: string
  paymentMethod?: string
  installments?: number
  createdAt?: string
  paidAt?: string
  refundedAt?: string
  customer?: { name?: string; email?: string; phone?: string; docNumber?: string; document?: string }
  product?: { id?: string; name?: string; type?: string }
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  [key: string]: unknown
}

interface CaktoPage {
  count?: number
  next?: string | null
  results?: CaktoOrder[]
}

function num(value: number | string | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function mapStatus(status?: string): TxStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'paid':
    case 'approved':
      return 'approved'
    case 'refunded':
      return 'refunded'
    case 'chargeback':
    case 'chargedback':
      return 'chargeback'
    case 'canceled':
    case 'cancelled':
    case 'refused':
      return 'canceled'
    default:
      return 'pending'
  }
}

function mapMethod(method?: string): PaymentMethod | null {
  const text = (method ?? '').toLowerCase()
  if (text.includes('pix')) return 'pix'
  if (text.includes('boleto')) return 'boleto'
  if (text.includes('credit') || text.includes('cartao') || text.includes('card')) return 'credit_card'
  return null
}

export function caktoOrderToTx(order: CaktoOrder): NormalizedTx | null {
  const saleDate = normalizeDate(order.createdAt ?? order.paidAt)
  if (!saleDate) return null

  const gross = num(order.baseAmount) || num(order.amount)
  const fees = num(order.fees)
  const net = num(order.amount) || gross - fees

  const status = mapStatus(order.status)
  const utm = [order.utm_source, order.utm_medium, order.utm_campaign].filter(Boolean).join(' / ')

  return {
    platform: 'cakto',
    source: 'api',
    externalId: order.id ?? order.refId ?? null,
    kind: status === 'refunded' ? 'refund' : 'sale',
    status,
    method: mapMethod(order.paymentMethod),
    installments: order.installments ?? 1,
    grossCents: toCents(Math.abs(gross)),
    feeCents: toCents(Math.abs(fees)),
    netCents: toCents(Math.abs(net)),
    saleDate,
    receiptDate: normalizeDate(order.paidAt) ?? saleDate,
    description: order.product?.name ?? 'Pedido Cakto',
    counterpartyName: order.customer?.name ?? null,
    counterpartyEmail: order.customer?.email ?? null,
    counterpartyPhone: order.customer?.phone ?? null,
    counterpartyDocument: order.customer?.docNumber ?? order.customer?.document ?? null,
    origin: utm || null,
    productHint: order.product?.name ?? null,
    raw: order,
  }
}

export async function fetchCaktoOrders(
  startDate: string,
  endDate: string,
  options: { maxPages?: number } = {},
): Promise<NormalizedTx[]> {
  if (!env.cakto.configured) {
    throw new Error('CAKTO_API_TOKEN não configurado.')
  }

  const out: NormalizedTx[] = []
  const maxPages = options.maxPages ?? 50
  let page = 1

  while (page <= maxPages) {
    const url = new URL('/public_api/orders/', BASE_URL)
    url.searchParams.set('createdAt__gte', startDate)
    url.searchParams.set('createdAt__lte', endDate)
    url.searchParams.set('limit', '100')
    url.searchParams.set('page', String(page))
    url.searchParams.set('ordering', 'createdAt')

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.cakto.token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`Cakto respondeu ${response.status}: ${(await response.text()).slice(0, 300)}`)
    }

    const data = (await response.json()) as CaktoPage
    const results = data.results ?? []
    for (const order of results) {
      const tx = caktoOrderToTx(order)
      if (tx) out.push(tx)
    }

    if (!data.next || results.length === 0) break
    page += 1
  }

  return out
}

/** Normaliza o corpo de um webhook da Cakto para o formato interno. */
export function caktoWebhookToTx(payload: unknown): NormalizedTx | null {
  const body = payload as { data?: CaktoOrder; event?: string } & CaktoOrder
  const order = body.data ?? body
  const tx = caktoOrderToTx(order)
  if (!tx) return null
  return { ...tx, source: 'webhook' }
}
