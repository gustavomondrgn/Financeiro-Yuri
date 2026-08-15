import 'server-only'
import { and, eq, gte, lte, sql, desc, isNull, ne, inArray, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { transactions, expenses, products, customers } from '@/lib/db/schema'
import type { Period, IsoDate } from '@/lib/dates'

/**
 * Consultas agregadas de receita e despesa.
 *
 * Regime de reconhecimento:
 *  - `cash` (padrão) usa a data de recebimento — é como o caixa dos sócios
 *    realmente se comporta;
 *  - `accrual` usa a data da venda — necessário para enxergar parcelado e
 *    entender performance comercial do mês.
 */

export type Regime = 'cash' | 'accrual'

export function dateColumn(regime: Regime) {
  return regime === 'cash'
    ? sql`coalesce(${transactions.receiptDate}, ${transactions.saleDate})`
    : transactions.saleDate
}

function periodFilter(period: Period, regime: Regime) {
  const col = dateColumn(regime)
  return and(sql`${col} >= ${period.start}`, sql`${col} <= ${period.end}`)
}

/** Só venda aprovada conta como receita. */
const SALE_FILTER = and(eq(transactions.kind, 'sale'), eq(transactions.status, 'approved'))

export interface RevenueSummary {
  grossCents: number
  feeCents: number
  netCents: number
  refundCents: number
  chargebackCents: number
  count: number
  /** Receita líquida já descontando estorno e chargeback. */
  effectiveNetCents: number
  averageTicketCents: number
}

export async function getRevenue(period: Period, regime: Regime = 'cash'): Promise<RevenueSummary> {
  const [sales] = await db
    .select({
      gross: sql<number>`coalesce(sum(${transactions.grossCents}), 0)::int`,
      fee: sql<number>`coalesce(sum(${transactions.feeCents}), 0)::int`,
      net: sql<number>`coalesce(sum(${transactions.netCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(SALE_FILTER, periodFilter(period, regime)))

  const [reversals] = await db
    .select({
      refund: sql<number>`coalesce(sum(case when ${transactions.kind} = 'refund' then ${transactions.netCents} else 0 end), 0)::int`,
      chargeback: sql<number>`coalesce(sum(case when ${transactions.kind} = 'chargeback' then ${transactions.netCents} else 0 end), 0)::int`,
    })
    .from(transactions)
    .where(and(inArray(transactions.kind, ['refund', 'chargeback']), periodFilter(period, regime)))

  const effectiveNet = sales.net - reversals.refund - reversals.chargeback

  return {
    grossCents: sales.gross,
    feeCents: sales.fee,
    netCents: sales.net,
    refundCents: reversals.refund,
    chargebackCents: reversals.chargeback,
    count: sales.count,
    effectiveNetCents: effectiveNet,
    averageTicketCents: sales.count > 0 ? Math.round(sales.gross / sales.count) : 0,
  }
}

export interface RevenueByDay {
  date: IsoDate
  grossCents: number
  netCents: number
  count: number
}

export async function getRevenueByDay(period: Period, regime: Regime = 'cash'): Promise<RevenueByDay[]> {
  const col = dateColumn(regime)
  const rows = await db
    .select({
      date: sql<string>`${col}::text`,
      gross: sql<number>`coalesce(sum(${transactions.grossCents}), 0)::int`,
      net: sql<number>`coalesce(sum(${transactions.netCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(SALE_FILTER, periodFilter(period, regime)))
    .groupBy(sql`${col}`)
    .orderBy(sql`${col}`)

  return rows.map((r) => ({ date: r.date, grossCents: r.gross, netCents: r.net, count: r.count }))
}

export interface RevenueByMonth {
  month: string
  grossCents: number
  netCents: number
  count: number
}

export async function getRevenueByMonth(
  start: IsoDate,
  end: IsoDate,
  regime: Regime = 'cash',
): Promise<RevenueByMonth[]> {
  const col = dateColumn(regime)
  const rows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${col}::date), 'YYYY-MM-DD')`,
      gross: sql<number>`coalesce(sum(${transactions.grossCents}), 0)::int`,
      net: sql<number>`coalesce(sum(${transactions.netCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(SALE_FILTER, sql`${col} >= ${start}`, sql`${col} <= ${end}`))
    .groupBy(sql`date_trunc('month', ${col}::date)`)
    .orderBy(sql`date_trunc('month', ${col}::date)`)

  return rows.map((r) => ({ month: r.month, grossCents: r.gross, netCents: r.net, count: r.count }))
}

export interface RevenueBreakdown {
  key: string
  label: string
  grossCents: number
  netCents: number
  count: number
}

export async function getRevenueByPlatform(period: Period, regime: Regime = 'cash'): Promise<RevenueBreakdown[]> {
  const rows = await db
    .select({
      platform: transactions.platform,
      gross: sql<number>`coalesce(sum(${transactions.grossCents}), 0)::int`,
      net: sql<number>`coalesce(sum(${transactions.netCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(SALE_FILTER, periodFilter(period, regime)))
    .groupBy(transactions.platform)
    .orderBy(desc(sql`sum(${transactions.grossCents})`))

  const labels: Record<string, string> = {
    infinitepay: 'InfinitePay',
    kiwify: 'Kiwify',
    cakto: 'Cakto',
    inter: 'Banco Inter',
    manual: 'Manual',
  }

  return rows.map((r) => ({
    key: r.platform,
    label: labels[r.platform] ?? r.platform,
    grossCents: r.gross,
    netCents: r.net,
    count: r.count,
  }))
}

export async function getRevenueByProduct(period: Period, regime: Regime = 'cash'): Promise<RevenueBreakdown[]> {
  const rows = await db
    .select({
      productId: transactions.productId,
      name: products.name,
      type: products.type,
      gross: sql<number>`coalesce(sum(${transactions.grossCents}), 0)::int`,
      net: sql<number>`coalesce(sum(${transactions.netCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .leftJoin(products, eq(transactions.productId, products.id))
    .where(and(SALE_FILTER, periodFilter(period, regime)))
    .groupBy(transactions.productId, products.name, products.type)
    .orderBy(desc(sql`sum(${transactions.grossCents})`))

  return rows.map((r) => ({
    key: r.productId ? String(r.productId) : 'unclassified',
    label: r.name ?? 'Não classificado',
    grossCents: r.gross,
    netCents: r.net,
    count: r.count,
  }))
}

/** Receita separada entre serviço e infoproduto — o mix que define a estratégia. */
export async function getRevenueByProductType(
  period: Period,
  regime: Regime = 'cash',
): Promise<RevenueBreakdown[]> {
  const rows = await db
    .select({
      type: sql<string>`coalesce(${products.type}::text, 'unclassified')`,
      gross: sql<number>`coalesce(sum(${transactions.grossCents}), 0)::int`,
      net: sql<number>`coalesce(sum(${transactions.netCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .leftJoin(products, eq(transactions.productId, products.id))
    .where(and(SALE_FILTER, periodFilter(period, regime)))
    .groupBy(sql`coalesce(${products.type}::text, 'unclassified')`)

  const labels: Record<string, string> = {
    service: 'Serviços',
    infoproduct: 'Infoprodutos',
    other: 'Outros',
    unclassified: 'Não classificado',
  }

  return rows.map((r) => ({
    key: r.type,
    label: labels[r.type] ?? r.type,
    grossCents: r.gross,
    netCents: r.net,
    count: r.count,
  }))
}

export async function getRevenueByOrigin(period: Period, regime: Regime = 'cash'): Promise<RevenueBreakdown[]> {
  const rows = await db
    .select({
      origin: sql<string>`coalesce(nullif(${transactions.origin}, ''), 'Sem origem')`,
      gross: sql<number>`coalesce(sum(${transactions.grossCents}), 0)::int`,
      net: sql<number>`coalesce(sum(${transactions.netCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(SALE_FILTER, periodFilter(period, regime)))
    .groupBy(sql`coalesce(nullif(${transactions.origin}, ''), 'Sem origem')`)
    .orderBy(desc(sql`sum(${transactions.grossCents})`))

  return rows.map((r) => ({
    key: r.origin,
    label: r.origin,
    grossCents: r.gross,
    netCents: r.net,
    count: r.count,
  }))
}

/**
 * Taxa efetiva de adquirência por método e parcelamento.
 * O custo real de receber — quase ninguém calcula, e ele come margem.
 */
export interface EffectiveFee {
  method: string
  installments: number
  grossCents: number
  feeCents: number
  ratio: number
  count: number
}

export async function getEffectiveFees(period: Period, regime: Regime = 'cash'): Promise<EffectiveFee[]> {
  const rows = await db
    .select({
      method: sql<string>`coalesce(${transactions.method}::text, 'desconhecido')`,
      installments: transactions.installments,
      gross: sql<number>`coalesce(sum(${transactions.grossCents}), 0)::int`,
      fee: sql<number>`coalesce(sum(${transactions.feeCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(SALE_FILTER, periodFilter(period, regime)))
    .groupBy(sql`coalesce(${transactions.method}::text, 'desconhecido')`, transactions.installments)
    .orderBy(desc(sql`sum(${transactions.grossCents})`))

  return rows.map((r) => ({
    method: r.method,
    installments: r.installments,
    grossCents: r.gross,
    feeCents: r.fee,
    ratio: r.gross > 0 ? r.fee / r.gross : 0,
    count: r.count,
  }))
}

/* ------------------------------------------------------------------ *
 * Despesas
 * ------------------------------------------------------------------ */

export interface ExpenseSummary {
  totalCents: number
  byKind: Record<string, number>
  count: number
}

function expensePeriodFilter(period: Period, regime: Regime) {
  return regime === 'cash'
    ? and(
        sql`coalesce(${expenses.paidDate}, ${expenses.dueDate}, ${expenses.competenceDate}) >= ${period.start}`,
        sql`coalesce(${expenses.paidDate}, ${expenses.dueDate}, ${expenses.competenceDate}) <= ${period.end}`,
      )
    : and(gte(expenses.competenceDate, period.start), lte(expenses.competenceDate, period.end))
}

export async function getExpenses(period: Period, regime: Regime = 'cash'): Promise<ExpenseSummary> {
  const rows = await db
    .select({
      kind: expenses.kind,
      total: sql<number>`coalesce(sum(${expenses.amountCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(expenses)
    .where(and(expensePeriodFilter(period, regime), ne(expenses.status, 'canceled')))
    .groupBy(expenses.kind)

  const byKind: Record<string, number> = {}
  let total = 0
  let count = 0
  for (const row of rows) {
    byKind[row.kind] = row.total
    total += row.total
    count += row.count
  }

  return { totalCents: total, byKind, count }
}

export interface ExpenseBreakdown {
  key: string
  label: string
  amountCents: number
  count: number
}

export async function getExpensesByCategory(
  period: Period,
  regime: Regime = 'cash',
): Promise<ExpenseBreakdown[]> {
  const { expenseCategories } = await import('@/lib/db/schema')
  const rows = await db
    .select({
      categoryId: expenses.categoryId,
      name: expenseCategories.name,
      total: sql<number>`coalesce(sum(${expenses.amountCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(expenses)
    .leftJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
    .where(and(expensePeriodFilter(period, regime), ne(expenses.status, 'canceled')))
    .groupBy(expenses.categoryId, expenseCategories.name)
    .orderBy(desc(sql`sum(${expenses.amountCents})`))

  return rows.map((r) => ({
    key: r.categoryId ? String(r.categoryId) : 'none',
    label: r.name ?? 'Sem categoria',
    amountCents: r.total,
    count: r.count,
  }))
}

/** Contas em aberto, ordenadas por vencimento. */
export async function getUpcomingBills(daysAhead = 30) {
  const { today, addDays } = await import('@/lib/dates')
  const limit = addDays(today(), daysAhead)

  return db
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.status, 'pending'),
        or(isNull(expenses.dueDate), lte(expenses.dueDate, limit)),
      ),
    )
    .orderBy(expenses.dueDate)
}

/* ------------------------------------------------------------------ *
 * Clientes
 * ------------------------------------------------------------------ */

export async function getTopCustomers(period: Period, limit = 10, regime: Regime = 'cash') {
  const rows = await db
    .select({
      customerId: transactions.customerId,
      name: customers.name,
      gross: sql<number>`coalesce(sum(${transactions.grossCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .leftJoin(customers, eq(transactions.customerId, customers.id))
    .where(and(SALE_FILTER, periodFilter(period, regime)))
    .groupBy(transactions.customerId, customers.name)
    .orderBy(desc(sql`sum(${transactions.grossCents})`))
    .limit(limit)

  return rows
    .filter((r) => r.customerId)
    .map((r) => ({
      customerId: r.customerId!,
      name: r.name ?? 'Sem nome',
      grossCents: r.gross,
      count: r.count,
    }))
}

export async function countPendingReview(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.needsReview, true))
  return row?.count ?? 0
}
