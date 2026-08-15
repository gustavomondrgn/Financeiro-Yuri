import 'server-only'
import { and, eq, sql, desc, isNotNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { transactions, customers } from '@/lib/db/schema'
import { today, diffDays, type Period, type IsoDate } from '@/lib/dates'

/**
 * Análise de clientes.
 *
 * Num negócio de consultas, a alavanca mais barata não é achar cliente
 * novo — é trazer de volta quem já pagou uma vez. Este módulo existe para
 * transformar isso em lista acionável, não em gráfico bonito.
 */

const SALE = and(eq(transactions.kind, 'sale'), eq(transactions.status, 'approved'))

export interface CustomerMetrics {
  totalCustomers: number
  repeatCustomers: number
  repeatRatio: number
  averageLtvCents: number
  averageTicketCents: number
  /** Intervalo mediano entre compras de quem comprou mais de uma vez. */
  medianRepurchaseDays: number | null
  /** Concentração: fatia da receita nos 10 maiores clientes. */
  top10Share: number
}

export async function getCustomerMetrics(): Promise<CustomerMetrics> {
  const rows = await db
    .select({
      id: customers.id,
      purchases: customers.purchaseCount,
      total: customers.totalNetCents,
    })
    .from(customers)
    .where(sql`${customers.purchaseCount} > 0`)

  const totalCustomers = rows.length
  const repeatCustomers = rows.filter((r) => r.purchases > 1).length
  const totalRevenue = rows.reduce((acc, r) => acc + r.total, 0)
  const totalPurchases = rows.reduce((acc, r) => acc + r.purchases, 0)

  const sorted = [...rows].sort((a, b) => b.total - a.total)
  const top10 = sorted.slice(0, 10).reduce((acc, r) => acc + r.total, 0)

  const intervals = await repurchaseIntervals()
  const median =
    intervals.length > 0
      ? intervals.sort((a, b) => a - b)[Math.floor(intervals.length / 2)]
      : null

  return {
    totalCustomers,
    repeatCustomers,
    repeatRatio: totalCustomers > 0 ? repeatCustomers / totalCustomers : 0,
    averageLtvCents: totalCustomers > 0 ? Math.round(totalRevenue / totalCustomers) : 0,
    averageTicketCents: totalPurchases > 0 ? Math.round(totalRevenue / totalPurchases) : 0,
    medianRepurchaseDays: median,
    top10Share: totalRevenue > 0 ? top10 / totalRevenue : 0,
  }
}

/** Dias entre compras consecutivas — base da curva de recompra. */
async function repurchaseIntervals(): Promise<number[]> {
  const rows = await db
    .select({
      customerId: transactions.customerId,
      date: transactions.saleDate,
    })
    .from(transactions)
    .where(and(SALE, isNotNull(transactions.customerId)))
    .orderBy(transactions.customerId, transactions.saleDate)

  const intervals: number[] = []
  let lastCustomer: number | null = null
  let lastDate: string | null = null

  for (const row of rows) {
    if (row.customerId !== lastCustomer) {
      lastCustomer = row.customerId
      lastDate = row.date
      continue
    }
    if (lastDate) intervals.push(diffDays(row.date, lastDate))
    lastDate = row.date
  }

  return intervals.filter((d) => d > 0)
}

export interface ReactivationCandidate {
  customerId: number
  name: string
  phone: string | null
  email: string | null
  lastPurchaseAt: IsoDate
  daysSince: number
  purchaseCount: number
  totalNetCents: number
  /** Quanto passou do intervalo típico dele — quanto maior, mais "vencido". */
  overdueRatio: number
}

/**
 * Clientes que já deveriam ter voltado.
 *
 * Compara o tempo desde a última compra com o intervalo mediano de recompra
 * da base. Quem passou de 1,5x já está atrasado; a lista sai ordenada por
 * valor, porque a hora é limitada e nem todo retorno vale o mesmo.
 */
export async function getReactivationList(limit = 30): Promise<ReactivationCandidate[]> {
  const metrics = await getCustomerMetrics()
  const baseline = metrics.medianRepurchaseDays ?? 90
  const now = today()

  const rows = await db
    .select()
    .from(customers)
    .where(and(isNotNull(customers.lastPurchaseAt), sql`${customers.purchaseCount} > 0`))
    .orderBy(desc(customers.totalNetCents))

  return rows
    .map((c) => {
      const daysSince = diffDays(now, c.lastPurchaseAt!)
      return {
        customerId: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        lastPurchaseAt: c.lastPurchaseAt!,
        daysSince,
        purchaseCount: c.purchaseCount,
        totalNetCents: c.totalNetCents,
        overdueRatio: baseline > 0 ? daysSince / baseline : 0,
      }
    })
    .filter((c) => c.overdueRatio >= 1.5)
    .sort((a, b) => b.totalNetCents - a.totalNetCents)
    .slice(0, limit)
}

export interface CohortRow {
  cohort: string
  customers: number
  /** Receita por mês de vida da coorte (0 = mês da aquisição). */
  revenueByMonth: number[]
  totalCents: number
}

/**
 * Coortes por mês de aquisição.
 *
 * Mostra se cliente novo continua comprando ou se o negócio depende de
 * reposição constante — diferença entre crescer e correr no lugar.
 */
export async function getCohorts(monthsBack = 12): Promise<CohortRow[]> {
  const rows = await db
    .select({
      cohort: sql<string>`to_char(date_trunc('month', ${customers.firstPurchaseAt}::date), 'YYYY-MM')`,
      monthIndex: sql<number>`(
        (date_part('year', ${transactions.saleDate}::date) - date_part('year', ${customers.firstPurchaseAt}::date)) * 12 +
        (date_part('month', ${transactions.saleDate}::date) - date_part('month', ${customers.firstPurchaseAt}::date))
      )::int`,
      customerId: transactions.customerId,
      net: sql<number>`coalesce(sum(${transactions.netCents}), 0)::int`,
    })
    .from(transactions)
    .innerJoin(customers, eq(transactions.customerId, customers.id))
    .where(and(SALE, isNotNull(customers.firstPurchaseAt)))
    .groupBy(
      sql`date_trunc('month', ${customers.firstPurchaseAt}::date)`,
      sql`(
        (date_part('year', ${transactions.saleDate}::date) - date_part('year', ${customers.firstPurchaseAt}::date)) * 12 +
        (date_part('month', ${transactions.saleDate}::date) - date_part('month', ${customers.firstPurchaseAt}::date))
      )::int`,
      transactions.customerId,
    )

  const cohortMap = new Map<string, { customers: Set<number>; revenue: Map<number, number> }>()

  for (const row of rows) {
    if (!row.cohort) continue
    const entry = cohortMap.get(row.cohort) ?? { customers: new Set<number>(), revenue: new Map<number, number>() }
    if (row.customerId) entry.customers.add(row.customerId)
    const index = Math.max(0, row.monthIndex)
    entry.revenue.set(index, (entry.revenue.get(index) ?? 0) + row.net)
    cohortMap.set(row.cohort, entry)
  }

  const cohorts = [...cohortMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-monthsBack)

  return cohorts.map(([cohort, data]) => {
    const maxIndex = Math.max(0, ...data.revenue.keys())
    const revenueByMonth: number[] = []
    for (let i = 0; i <= maxIndex; i++) revenueByMonth.push(data.revenue.get(i) ?? 0)
    return {
      cohort,
      customers: data.customers.size,
      revenueByMonth,
      totalCents: revenueByMonth.reduce((a, b) => a + b, 0),
    }
  })
}

export interface NewVsReturning {
  newCustomers: number
  returningCustomers: number
  newRevenueCents: number
  returningRevenueCents: number
}

export async function getNewVsReturning(period: Period): Promise<NewVsReturning> {
  const rows = await db
    .select({
      customerId: transactions.customerId,
      firstPurchase: customers.firstPurchaseAt,
      gross: sql<number>`coalesce(sum(${transactions.grossCents}), 0)::int`,
    })
    .from(transactions)
    .innerJoin(customers, eq(transactions.customerId, customers.id))
    .where(
      and(
        SALE,
        sql`coalesce(${transactions.receiptDate}, ${transactions.saleDate}) >= ${period.start}`,
        sql`coalesce(${transactions.receiptDate}, ${transactions.saleDate}) <= ${period.end}`,
      ),
    )
    .groupBy(transactions.customerId, customers.firstPurchaseAt)

  let newCustomers = 0
  let returningCustomers = 0
  let newRevenue = 0
  let returningRevenue = 0

  for (const row of rows) {
    const isNew = row.firstPurchase !== null && row.firstPurchase >= period.start && row.firstPurchase <= period.end
    if (isNew) {
      newCustomers += 1
      newRevenue += row.gross
    } else {
      returningCustomers += 1
      returningRevenue += row.gross
    }
  }

  return {
    newCustomers,
    returningCustomers,
    newRevenueCents: newRevenue,
    returningRevenueCents: returningRevenue,
  }
}
