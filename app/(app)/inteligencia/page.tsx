import { desc } from 'drizzle-orm'
import { Sparkles } from 'lucide-react'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { aiReports } from '@/lib/db/schema'
import { requireSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { currentMonth, formatDateTimeBR, today } from '@/lib/dates'
import { getRevenue, getEffectiveFees, getExpenses } from '@/lib/analytics/queries'
import { getRuleFor } from '@/lib/analytics/split'
import { getSetting } from '@/lib/settings'
import { generateReport } from '@/lib/ai/analyst'
import { PageHeader } from '@/components/shell'
import { Card, Button, Badge, EmptyState } from '@/components/ui/primitives'
import { ScenarioSimulator } from '@/components/scenario-simulator'
import type { ScenarioInput } from '@/lib/simulator'

export const dynamic = 'force-dynamic'

export default async function InteligenciaPage() {
  const month = currentMonth()

  const [revenue, fees, expenses, goal, capacity, floor, rule, reports] = await Promise.all([
    getRevenue(month),
    getEffectiveFees(month),
    getExpenses(month),
    getSetting('goal'),
    getSetting('capacity'),
    getSetting('partner_floor'),
    getRuleFor(today(), null),
    db.select().from(aiReports).orderBy(desc(aiReports.createdAt)).limit(6),
  ])

  const totalGross = fees.reduce((acc, f) => acc + f.grossCents, 0)
  const totalFee = fees.reduce((acc, f) => acc + f.feeCents, 0)
  const feeRatio = totalGross > 0 ? totalFee / totalGross : 0.03

  const sessions = revenue.count || 30
  const ticket = revenue.averageTicketCents || 35000

  const initial: ScenarioInput = {
    sessionsPerMonth: sessions,
    sessionTicketCents: ticket,
    infoproductRevenueCents: 0,
    feeRatio,
    fixedCostsCents: expenses.byKind.fixed_cost ?? 0,
    marketingCents: expenses.byKind.marketing ?? 0,
    taxRate: 0.06,
    companyPct: rule ? Number(rule.companyPct) : 10,
    yuriPct: rule ? Number(rule.yuriPct) : 80,
    gustavoPct: rule ? Number(rule.gustavoPct) : 20,
    yuriFloorCents: floor.yuriCents,
    weeklyHours: capacity.weeklyHours,
    sessionMinutes: capacity.averageSessionMinutes,
  }

  async function runAnalysis() {
    'use server'
    await requireSession()
    await generateReport('monthly', currentMonth())
    revalidatePath('/inteligencia')
  }

  return (
    <>
      <PageHeader
        title="Inteligência"
        description="Simule cenários e peça a leitura do analista sobre os números do período"
      />

      <ScenarioSimulator initial={initial} goalCents={goal.targetCents} currentRevenueCents={revenue.grossCents} />

      <Card
        className="mt-3"
        title="Analista de IA"
        subtitle="Lê o DRE, os KPIs e a tendência e escreve a análise do mês"
        action={
          env.anthropic.configured ? (
            <form action={runAnalysis}>
              <Button type="submit">
                <Sparkles size={15} /> Gerar análise
              </Button>
            </form>
          ) : (
            <Badge tone="warning">chave da API não configurada</Badge>
          )
        }
      >
        {!env.anthropic.configured && (
          <div className="border-b border-hairline px-5 py-4 text-[13px] text-ink-2">
            Defina <code className="rounded bg-surface-2 px-1.5 py-0.5">ANTHROPIC_API_KEY</code> no ambiente
            para habilitar a análise. O relatório é gerado a partir de um retrato numérico fechado do período,
            então o texto comenta exatamente os mesmos números que estão nas outras telas.
          </div>
        )}

        {reports.length === 0 ? (
          <EmptyState
            title="Nenhuma análise gerada ainda"
            description="A análise mensal também pode ser disparada automaticamente pelo cron do servidor."
          />
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {reports.map((report) => (
              <article key={report.id} className="px-5 py-4">
                <header className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge tone="info">{report.kind === 'weekly' ? 'semanal' : 'mensal'}</Badge>
                  <span className="text-[12.5px] text-ink-muted">
                    {formatDateTimeBR(report.createdAt)} · {report.model}
                  </span>
                </header>
                <div className="prose-financeiro whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-2">
                  {report.content}
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}
