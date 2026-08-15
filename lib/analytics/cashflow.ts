import 'server-only'
import { and, sql, eq, gte, lte, ne, isNotNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { transactions, expenses, accounts, taxProvisions } from '@/lib/db/schema'
import { today, addDays, lastNMonths, type IsoDate } from '@/lib/dates'
import { getExpenses } from './queries'

/**
 * Caixa: saldo, recebíveis, contas a pagar e fôlego.
 *
 * O número que mais importa aqui não é o saldo — é o saldo livre, já
 * descontado o que é imposto e o que vence nos próximos dias. Saldo bruto
 * é a principal ilusão de negócio pequeno.
 */

export interface CashPosition {
  balanceCents: number
  receivableCents: number
  payableCents: number
  taxProvisionedCents: number
  freeCashCents: number
  /** Meses que a empresa sobrevive sem nova receita, ao custo fixo atual. */
  runwayMonths: number | null
  monthlyBurnCents: number
}

export async function getCashPosition(): Promise<CashPosition> {
  const now = today()

  const [balance] = await db
    .select({ total: sql<number>`coalesce(sum(${accounts.balanceCents}), 0)::int` })
    .from(accounts)
    .where(eq(accounts.active, true))

  // Vendas aprovadas cujo dinheiro ainda não caiu (parcelado, D+30).
  const [receivable] = await db
    .select({ total: sql<number>`coalesce(sum(${transactions.netCents}), 0)::int` })
    .from(transactions)
    .where(
      and(
        eq(transactions.kind, 'sale'),
        eq(transactions.status, 'approved'),
        isNotNull(transactions.receiptDate),
        sql`${transactions.receiptDate} > ${now}`,
      ),
    )

  const [payable] = await db
    .select({ total: sql<number>`coalesce(sum(${expenses.amountCents}), 0)::int` })
    .from(expenses)
    .where(eq(expenses.status, 'pending'))

  const [taxes] = await db
    .select({ total: sql<number>`coalesce(sum(${taxProvisions.amountCents}), 0)::int` })
    .from(taxProvisions)
    .where(eq(taxProvisions.status, 'pending'))

  const burn = await averageMonthlyBurn()
  const free = balance.total - taxes.total - payable.total

  return {
    balanceCents: balance.total,
    receivableCents: receivable.total,
    payableCents: payable.total,
    taxProvisionedCents: taxes.total,
    freeCashCents: free,
    monthlyBurnCents: burn,
    runwayMonths: burn > 0 ? Number((Math.max(0, free) / burn).toFixed(1)) : null,
  }
}

/** Custo fixo médio dos últimos 3 meses — base do runway. */
async function averageMonthlyBurn(): Promise<number> {
  const months = lastNMonths(3)
  let total = 0
  for (const month of months) {
    const summary = await getExpenses(month, 'cash')
    total += (summary.byKind.fixed_cost ?? 0) + (summary.byKind.marketing ?? 0)
  }
  return Math.round(total / months.length)
}

export interface CashForecastPoint {
  date: IsoDate
  inflowCents: number
  outflowCents: number
  netCents: number
  cumulativeCents: number
}

/** Previsão de caixa dia a dia com recebíveis conhecidos e contas agendadas. */
export async function forecastCash(days = 90): Promise<CashForecastPoint[]> {
  const start = today()
  const end = addDays(start, days)

  const inflows = await db
    .select({
      date: sql<string>`${transactions.receiptDate}::text`,
      total: sql<number>`coalesce(sum(${transactions.netCents}), 0)::int`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.kind, 'sale'),
        eq(transactions.status, 'approved'),
        gte(transactions.receiptDate, start),
        lte(transactions.receiptDate, end),
      ),
    )
    .groupBy(transactions.receiptDate)

  const outflows = await db
    .select({
      date: sql<string>`coalesce(${expenses.dueDate}, ${expenses.competenceDate})::text`,
      total: sql<number>`coalesce(sum(${expenses.amountCents}), 0)::int`,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.status, 'pending'),
        ne(expenses.status, 'canceled'),
        sql`coalesce(${expenses.dueDate}, ${expenses.competenceDate}) >= ${start}`,
        sql`coalesce(${expenses.dueDate}, ${expenses.competenceDate}) <= ${end}`,
      ),
    )
    .groupBy(sql`coalesce(${expenses.dueDate}, ${expenses.competenceDate})`)

  const inflowMap = new Map(inflows.map((r) => [r.date, r.total]))
  const outflowMap = new Map(outflows.map((r) => [r.date, r.total]))

  const position = await getCashPosition()
  let cumulative = position.balanceCents

  const points: CashForecastPoint[] = []
  for (let i = 0; i <= days; i++) {
    const date = addDays(start, i)
    const inflow = inflowMap.get(date) ?? 0
    const outflow = outflowMap.get(date) ?? 0
    cumulative += inflow - outflow
    points.push({ date, inflowCents: inflow, outflowCents: outflow, netCents: inflow - outflow, cumulativeCents: cumulative })
  }

  return points
}
