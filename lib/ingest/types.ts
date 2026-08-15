import type { IsoDate } from '@/lib/dates'

export type Platform = 'infinitepay' | 'kiwify' | 'cakto' | 'inter' | 'manual'
export type IngestSource =
  | 'webhook'
  | 'api'
  | 'internal_api'
  | 'csv_upload'
  | 'email'
  | 'playwright'
  | 'manual'
export type TxKind =
  | 'sale'
  | 'refund'
  | 'chargeback'
  | 'fee'
  | 'transfer_in'
  | 'transfer_out'
  | 'withdrawal'
  | 'other'
export type TxStatus = 'pending' | 'approved' | 'refunded' | 'chargeback' | 'canceled'
export type PaymentMethod = 'pix' | 'credit_card' | 'debit_card' | 'boleto' | 'transfer' | 'other'

/**
 * Formato único para o qual todo adaptador converte.
 *
 * É o contrato que permite trocar a rota da InfinitePay (API interna →
 * Playwright → CSV manual) sem tocar em nada a jusante.
 */
export interface NormalizedTx {
  platform: Platform
  source: IngestSource
  /** Id na origem. Quando existe, vira a chave de deduplicação. */
  externalId?: string | null

  kind: TxKind
  status: TxStatus
  method?: PaymentMethod | null
  installments?: number

  grossCents: number
  feeCents: number
  netCents: number

  saleDate: IsoDate
  receiptDate?: IsoDate | null

  description?: string | null
  counterpartyName?: string | null
  counterpartyEmail?: string | null
  counterpartyPhone?: string | null
  counterpartyDocument?: string | null

  origin?: string | null
  /** Nome do produto na origem, usado pela classificação. */
  productHint?: string | null
  accountId?: number | null

  /** Payload original, guardado em raw_events. */
  raw: unknown
}

export interface IngestResult {
  processed: number
  created: number
  duplicated: number
  needsReview: number
  errors: string[]
}

export function emptyResult(): IngestResult {
  return { processed: 0, created: 0, duplicated: 0, needsReview: 0, errors: [] }
}
