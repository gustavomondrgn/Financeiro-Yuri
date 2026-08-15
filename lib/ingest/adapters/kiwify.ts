import { normalizeDate, addDays, diffDays } from '@/lib/dates'
import { toCents } from '@/lib/money'
import { env } from '@/lib/env'
import type { NormalizedTx, PaymentMethod, TxStatus } from '../types'

/**
 * Adaptador da Kiwify — API oficial com OAuth2.
 *
 * GET https://public-api.kiwify.com/v1/sales
 * A janela máxima por requisição é de 90 dias, então o backfill histórico
 * é fatiado automaticamente. Valores vêm em centavos.
 */

const BASE_URL = 'https://public-api.kiwify.com/v1'
const MAX_WINDOW_DAYS = 89

interface KiwifySale {
  id?: string
  order_id?: string
  status?: string
  created_at?: string
  updated_at?: string
  paid_at?: string
  approved_date?: string
  refunded_at?: string
  net_amount?: number
  product?: { id?: string; name?: string }
  customer?: { full_name?: string; name?: string; email?: string; mobile?: string; phone?: string; cpf?: string; CPF?: string }
  payment?: { method?: string; fee?: number; installments?: number; charge_amount?: number; total?: number }
  tracking?: { src?: string; utm_source?: string; utm_campaign?: string; utm_medium?: string }
  [key: string]: unknown
}

interface KiwifyPage {
  data?: KiwifySale[]
  pagination?: { count?: number; page_number?: number; page_size?: number }
}

let tokenCache: { token: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token

  const response = await fetch(`${BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.kiwify.clientId,
      client_secret: env.kiwify.clientSecret,
    }),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Kiwify OAuth falhou (${response.status}): ${(await response.text()).slice(0, 300)}`)
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new Error('Kiwify OAuth não retornou access_token.')

  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  }
  return tokenCache.token
}

function mapStatus(status?: string): TxStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'paid':
    case 'approved':
      return 'approved'
    case 'refunded':
      return 'refunded'
    case 'chargedback':
    case 'chargeback':
      return 'chargeback'
    case 'refused':
    case 'canceled':
      return 'canceled'
    default:
      return 'pending'
  }
}

function mapMethod(method?: string): PaymentMethod | null {
  const text = (method ?? '').toLowerCase()
  if (text.includes('pix')) return 'pix'
  if (text.includes('boleto')) return 'boleto'
  if (text.includes('credit') || text.includes('card')) return 'credit_card'
  return null
}

export function kiwifySaleToTx(sale: KiwifySale): NormalizedTx | null {
  const saleDate = normalizeDate(sale.created_at ?? sale.paid_at ?? sale.approved_date)
  if (!saleDate) return null

  // A Kiwify já entrega centavos; não multiplicar de novo.
  const grossRaw = sale.payment?.charge_amount ?? sale.payment?.total ?? sale.net_amount ?? 0
  const feeRaw = sale.payment?.fee ?? 0
  const netRaw = sale.net_amount ?? grossRaw - feeRaw

  const status = mapStatus(sale.status)
  const tracking = sale.tracking
  const origin = [tracking?.src, tracking?.utm_source, tracking?.utm_campaign].filter(Boolean).join(' / ')

  return {
    platform: 'kiwify',
    source: 'api',
    externalId: sale.id ?? sale.order_id ?? null,
    kind: status === 'refunded' ? 'refund' : 'sale',
    status,
    method: mapMethod(sale.payment?.method),
    installments: sale.payment?.installments ?? 1,
    grossCents: Math.abs(Math.round(grossRaw)),
    feeCents: Math.abs(Math.round(feeRaw)),
    netCents: Math.abs(Math.round(netRaw)),
    saleDate,
    receiptDate: normalizeDate(sale.paid_at ?? sale.approved_date) ?? saleDate,
    description: sale.product?.name ?? 'Venda Kiwify',
    counterpartyName: sale.customer?.full_name ?? sale.customer?.name ?? null,
    counterpartyEmail: sale.customer?.email ?? null,
    counterpartyPhone: sale.customer?.mobile ?? sale.customer?.phone ?? null,
    counterpartyDocument: sale.customer?.cpf ?? sale.customer?.CPF ?? null,
    origin: origin || null,
    productHint: sale.product?.name ?? null,
    raw: sale,
  }
}

async function fetchWindow(start: string, end: string): Promise<NormalizedTx[]> {
  const token = await getAccessToken()
  const out: NormalizedTx[] = []
  let page = 1

  while (page <= 100) {
    const url = new URL(`${BASE_URL}/sales`)
    url.searchParams.set('start_date', start)
    url.searchParams.set('end_date', end)
    url.searchParams.set('page_number', String(page))
    url.searchParams.set('page_size', '100')

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-kiwify-account-id': env.kiwify.accountId,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`Kiwify respondeu ${response.status}: ${(await response.text()).slice(0, 300)}`)
    }

    const data = (await response.json()) as KiwifyPage
    const rows = data.data ?? []
    for (const sale of rows) {
      const tx = kiwifySaleToTx(sale)
      if (tx) out.push(tx)
    }

    if (rows.length < 100) break
    page += 1
  }

  return out
}

/** Busca vendas fatiando o período em janelas de 90 dias. */
export async function fetchKiwifySales(startDate: string, endDate: string): Promise<NormalizedTx[]> {
  if (!env.kiwify.configured) {
    throw new Error('Credenciais da Kiwify não configuradas (client id, secret e account id).')
  }

  const out: NormalizedTx[] = []
  let cursor = startDate

  while (diffDays(endDate, cursor) >= 0) {
    const windowEnd = diffDays(endDate, cursor) > MAX_WINDOW_DAYS ? addDays(cursor, MAX_WINDOW_DAYS) : endDate
    out.push(...(await fetchWindow(cursor, windowEnd)))
    cursor = addDays(windowEnd, 1)
  }

  return out
}

export function kiwifyWebhookToTx(payload: unknown): NormalizedTx | null {
  const body = payload as { order?: KiwifySale } & KiwifySale
  const sale = body.order ?? body
  const tx = kiwifySaleToTx(sale)
  if (!tx) return null
  return { ...tx, source: 'webhook' }
}
