import 'server-only'
import { and, eq, lte, sql, desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { expenses, jobRuns, transactions, customers } from '@/lib/db/schema'
import { today, addDays, currentMonth, previousMonth, formatDateBR } from '@/lib/dates'
import { formatBRL } from '@/lib/money'
import { getRevenue } from './queries'
import { getMeiStatus } from './tax'

/**
 * Alertas.
 *
 * Só entra aqui o que muda uma decisão nos próximos dias. Alerta que o
 * usuário aprende a ignorar é pior que alerta nenhum — por isso cada regra
 * tem limiar explícito e some sozinha quando o problema passa.
 */

export interface Alert {
  id: string
  severity: 'info' | 'warning' | 'serious' | 'critical'
  title: string
  detail: string
  href?: string
}

export async function getAlerts(): Promise<Alert[]> {
  const alerts: Alert[] = []
  const now = today()

  /* Teto do MEI */
  const mei = await getMeiStatus()
  if (mei.severity !== 'ok') {
    alerts.push({
      id: 'mei',
      severity: mei.severity === 'critico' ? 'critical' : mei.severity === 'estourado' ? 'serious' : 'warning',
      title:
        mei.severity === 'atencao'
          ? 'Teto do MEI será ultrapassado no ritmo atual'
          : `Teto do MEI ultrapassado em ${formatBRL(mei.excessCents)}`,
      detail: mei.message,
      href: '/fiscal',
    })
  }

  /* Contas vencidas e a vencer */
  const overdue = await db
    .select({ count: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${expenses.amountCents}),0)::int` })
    .from(expenses)
    .where(and(eq(expenses.status, 'pending'), lte(expenses.dueDate, now)))

  if (overdue[0]?.count > 0) {
    alerts.push({
      id: 'overdue',
      severity: 'critical',
      title: `${overdue[0].count} conta(s) vencida(s)`,
      detail: `Total de ${formatBRL(overdue[0].total)} em aberto com vencimento já passado.`,
      href: '/despesas',
    })
  }

  const dueSoon = await db
    .select({ count: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${expenses.amountCents}),0)::int` })
    .from(expenses)
    .where(
      and(
        eq(expenses.status, 'pending'),
        sql`${expenses.dueDate} > ${now}`,
        lte(expenses.dueDate, addDays(now, 7)),
      ),
    )

  if (dueSoon[0]?.count > 0) {
    alerts.push({
      id: 'due_soon',
      severity: 'warning',
      title: `${dueSoon[0].count} conta(s) vencem em 7 dias`,
      detail: `${formatBRL(dueSoon[0].total)} programados para os próximos dias.`,
      href: '/despesas',
    })
  }

  /* Classificação pendente */
  const [pending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.needsReview, true))

  if (pending.count >= 5) {
    alerts.push({
      id: 'pending_review',
      severity: 'info',
      title: `${pending.count} transações sem classificação`,
      detail: 'Receita por serviço e margem por produto ficam incompletas até classificar.',
      href: '/receitas/classificar',
    })
  }

  /* Queda de ritmo */
  const month = currentMonth()
  const previous = previousMonth(month)
  const current = await getRevenue(month)
  const before = await getRevenue(previous)
  const dayOfMonth = Number(now.slice(8, 10))

  if (dayOfMonth >= 10 && before.grossCents > 0) {
    const expected = before.grossCents * (dayOfMonth / Number(month.end.slice(8, 10)))
    if (current.grossCents < expected * 0.75) {
      alerts.push({
        id: 'pace_drop',
        severity: 'serious',
        title: 'Ritmo do mês abaixo do mês anterior',
        detail: `Até agora ${formatBRL(current.grossCents)} contra ${formatBRL(Math.round(expected))} esperados no mesmo ponto do mês passado.`,
        href: '/metas',
      })
    }
  }

  /* Sincronizações falhando */
  const failedJobs = await db
    .select({ job: jobRuns.job, startedAt: jobRuns.startedAt, error: jobRuns.error })
    .from(jobRuns)
    .where(eq(jobRuns.status, 'error'))
    .orderBy(desc(jobRuns.startedAt))
    .limit(1)

  if (failedJobs.length > 0) {
    alerts.push({
      id: 'job_error',
      severity: 'warning',
      title: 'Última sincronização falhou',
      detail: `${failedJobs[0].job} — ${(failedJobs[0].error ?? '').slice(0, 140)}`,
      href: '/configuracoes',
    })
  }

  /* Cliente grande sumido */
  const bigMissing = await db
    .select({ name: customers.name, last: customers.lastPurchaseAt, total: customers.totalNetCents })
    .from(customers)
    .where(and(sql`${customers.purchaseCount} >= 3`, lte(customers.lastPurchaseAt, addDays(now, -180))))
    .orderBy(desc(customers.totalNetCents))
    .limit(1)

  if (bigMissing.length > 0 && bigMissing[0].last) {
    alerts.push({
      id: 'lost_customer',
      severity: 'info',
      title: `${bigMissing[0].name} não compra desde ${formatDateBR(bigMissing[0].last)}`,
      detail: `Cliente recorrente com ${formatBRL(bigMissing[0].total)} acumulados. Vale uma retomada.`,
      href: '/clientes',
    })
  }

  const order = { critical: 0, serious: 1, warning: 2, info: 3 }
  return alerts.sort((a, b) => order[a.severity] - order[b.severity])
}
