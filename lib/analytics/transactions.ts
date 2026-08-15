import 'server-only'
import { and, eq, sql, desc, ilike, or, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { transactions, products, customers } from '@/lib/db/schema'
import type { IsoDate } from '@/lib/dates'

/** Listagem filtrável de transações — usada na tela de receitas e nos exports. */

export interface TransactionFilters {
  start?: IsoDate
  end?: IsoDate
  platform?: string
  productId?: number | 'unclassified'
  method?: string
  status?: string
  kind?: string
  search?: string
  needsReview?: boolean
  regime?: 'cash' | 'accrual'
}

export interface TransactionRow {
  id: number
  saleDate: string
  receiptDate: string | null
  platform: string
  kind: string
  status: string
  method: string | null
  installments: number
  grossCents: number
  feeCents: number
  netCents: number
  description: string | null
  counterpartyName: string | null
  productName: string | null
  productId: number | null
  customerName: string | null
  origin: string | null
  needsReview: boolean
}

function buildWhere(filters: TransactionFilters): SQL | undefined {
  const regime = filters.regime ?? 'cash'
  const dateCol =
    regime === 'cash'
      ? sql`coalesce(${transactions.receiptDate}, ${transactions.saleDate})`
      : transactions.saleDate

  const clauses: (SQL | undefined)[] = []

  if (filters.start) clauses.push(sql`${dateCol} >= ${filters.start}`)
  if (filters.end) clauses.push(sql`${dateCol} <= ${filters.end}`)
  if (filters.platform) clauses.push(sql`${transactions.platform}::text = ${filters.platform}`)
  if (filters.method) clauses.push(sql`${transactions.method}::text = ${filters.method}`)
  if (filters.status) clauses.push(sql`${transactions.status}::text = ${filters.status}`)
  if (filters.kind) clauses.push(sql`${transactions.kind}::text = ${filters.kind}`)
  if (filters.needsReview !== undefined) clauses.push(eq(transactions.needsReview, filters.needsReview))

  if (filters.productId === 'unclassified') {
    clauses.push(sql`${transactions.productId} is null`)
  } else if (typeof filters.productId === 'number') {
    clauses.push(eq(transactions.productId, filters.productId))
  }

  if (filters.search) {
    const term = `%${filters.search}%`
    clauses.push(
      or(
        ilike(transactions.description, term),
        ilike(transactions.counterpartyName, term),
        ilike(transactions.origin, term),
      ),
    )
  }

  const defined = clauses.filter(Boolean) as SQL[]
  return defined.length > 0 ? and(...defined) : undefined
}

export async function listTransactions(
  filters: TransactionFilters,
  page = 1,
  pageSize = 50,
): Promise<{ rows: TransactionRow[]; total: number; totalGrossCents: number }> {
  const where = buildWhere(filters)

  const rows = await db
    .select({
      id: transactions.id,
      saleDate: transactions.saleDate,
      receiptDate: transactions.receiptDate,
      platform: transactions.platform,
      kind: transactions.kind,
      status: transactions.status,
      method: transactions.method,
      installments: transactions.installments,
      grossCents: transactions.grossCents,
      feeCents: transactions.feeCents,
      netCents: transactions.netCents,
      description: transactions.description,
      counterpartyName: transactions.counterpartyName,
      productName: products.name,
      productId: transactions.productId,
      customerName: customers.name,
      origin: transactions.origin,
      needsReview: transactions.needsReview,
    })
    .from(transactions)
    .leftJoin(products, eq(transactions.productId, products.id))
    .leftJoin(customers, eq(transactions.customerId, customers.id))
    .where(where)
    .orderBy(desc(transactions.saleDate), desc(transactions.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const [totals] = await db
    .select({
      count: sql<number>`count(*)::int`,
      gross: sql<number>`coalesce(sum(${transactions.grossCents}), 0)::int`,
    })
    .from(transactions)
    .where(where)

  return {
    rows: rows as TransactionRow[],
    total: totals?.count ?? 0,
    totalGrossCents: totals?.gross ?? 0,
  }
}

export const PLATFORM_LABELS: Record<string, string> = {
  infinitepay: 'InfinitePay',
  kiwify: 'Kiwify',
  cakto: 'Cakto',
  inter: 'Banco Inter',
  manual: 'Manual',
}

export const METHOD_LABELS: Record<string, string> = {
  pix: 'Pix',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  boleto: 'Boleto',
  transfer: 'Transferência',
  other: 'Outro',
}

export const KIND_LABELS: Record<string, string> = {
  sale: 'Venda',
  refund: 'Estorno',
  chargeback: 'Chargeback',
  fee: 'Taxa',
  transfer_in: 'Transferência recebida',
  transfer_out: 'Transferência enviada',
  withdrawal: 'Saque',
  other: 'Outro',
}

export const STATUS_LABELS: Record<string, string> = {
  approved: 'Aprovada',
  pending: 'Pendente',
  refunded: 'Estornada',
  chargeback: 'Chargeback',
  canceled: 'Cancelada',
}
