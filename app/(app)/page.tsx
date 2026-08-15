import Link from 'next/link'
import { AlertTriangle, Info, OctagonAlert, TriangleAlert } from 'lucide-react'
import {
  currentMonth,
  previousMonth,
  sameMonthLastYear,
  lastNMonths,
  today,
  periodProgress,
  formatDateBR,
  monthLabel,
} from '@/lib/dates'
import { formatBRL, formatPercent, variation } from '@/lib/money'
import {
  getRevenue,
  getRevenueByDay,
  getRevenueByMonth,
  getRevenueByProductType,
  getRevenueByProduct,
  getRevenueByPlatform,
} from '@/lib/analytics/queries'
import { buildDre } from '@/lib/analytics/dre'
import { computeSplit, getRuleFor, revenueNeededFor } from '@/lib/analytics/split'
import { projectMonth } from '@/lib/analytics/goals'
import { getCashPosition } from '@/lib/analytics/cashflow'
import { getAlerts } from '@/lib/analytics/alerts'
import { getSetting } from '@/lib/settings'
import { PageHeader } from '@/components/shell'
import { Card, Stat, Money, Badge, ProgressBar, Table, Th, Td } from '@/components/ui/primitives'
import { MonthlyRevenueChart, DailyRevenueChart, BreakdownChart } from '@/components/charts'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const month = currentMonth()
  const prev = previousMonth(month)
  const lastYear = sameMonthLastYear(month)

  const goalSetting = await getSetting('goal')
  const floorSetting = await getSetting('partner_floor')

  const [revenue, prevRevenue, lastYearRevenue, dre, split, cash, alerts] = await Promise.all([
    getRevenue(month),
    getRevenue(prev),
    getRevenue(lastYear),
    buildDre(month),
    computeSplit(month),
    getCashPosition(),
    getAlerts(),
  ])

  const projection = await projectMonth(month, goalSetting.targetCents)
  const months = lastNMonths(13)
  const history = await getRevenueByMonth(months[0].start, month.end)
  const byDay = await getRevenueByDay(month)
  const byType = await getRevenueByProductType(month)
  const byProduct = await getRevenueByProduct(month)
  const byPlatform = await getRevenueByPlatform(month)

  const rule = await getRuleFor(today(), null)
  const neededForYuri = rule ? revenueNeededFor(floorSetting.yuriCents, 'yuri', rule) : null

  // Acumulado do mês contra o ritmo linear necessário para bater a meta.
  const daysInMonth = Number(month.end.slice(8, 10))
  let accumulated = 0
  const dayMap = new Map(byDay.map((d) => [d.date, d.grossCents]))
  const dailySeries = Array.from({ length: daysInMonth }, (_, i) => {
    const day = String(i + 1).padStart(2, '0')
    const date = `${month.start.slice(0, 8)}${day}`
    accumulated += dayMap.get(date) ?? 0
    return {
      date,
      accumulatedCents: date <= today() ? accumulated : Number.NaN,
      targetCents: Math.round((goalSetting.targetCents / daysInMonth) * (i + 1)),
    }
  }).map((d) => ({ ...d, accumulatedCents: Number.isNaN(d.accumulatedCents) ? undefined : d.accumulatedCents })) as Array<{
    date: string
    accumulatedCents: number
    targetCents: number
  }>

  const gap = goalSetting.targetCents - revenue.grossCents

  return (
    <>
      <PageHeader
        title="Visão geral"
        description={`${month.label} · atualizado em ${formatDateBR(today())}`}
      />

      {alerts.length > 0 && (
        <div className="mb-6 space-y-2">
          {alerts.slice(0, 4).map((alert) => (
            <AlertRow key={alert.id} alert={alert} />
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Faturamento do mês"
          value={formatBRL(revenue.grossCents)}
          delta={variation(revenue.grossCents, prevRevenue.grossCents)}
          hint={`vs ${formatBRL(prevRevenue.grossCents)} em ${monthLabel(prev.start, true)}`}
        />
        <Stat
          label="Projeção de fechamento"
          value={formatBRL(projection.projectedCents)}
          tone={projection.paceStatus === 'abaixo' ? 'warning' : projection.paceStatus === 'acima' ? 'good' : 'neutral'}
          hint={`${formatPercent(projection.progress)} do mês decorrido`}
        />
        <Stat
          label="Lucro líquido"
          value={formatBRL(dre.totals.netProfit)}
          hint={`margem de ${formatPercent(dre.margins.net)}`}
          tone={dre.totals.netProfit < 0 ? 'critical' : 'neutral'}
        />
        <Stat
          label="Caixa livre"
          value={formatBRL(cash.freeCashCents)}
          hint={
            cash.runwayMonths !== null
              ? `${cash.runwayMonths} meses de fôlego no custo fixo atual`
              : 'sem custo fixo registrado'
          }
          tone={cash.freeCashCents < 0 ? 'critical' : 'neutral'}
        />
      </div>

      {/* Meta do mês */}
      <Card className="mt-3 px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">
              Meta do mês — {formatBRL(goalSetting.targetCents)}
            </p>
            <p className="mt-1 text-[15px] text-ink">
              {gap > 0 ? (
                <>
                  Faltam <strong className="tabular">{formatBRL(gap)}</strong>
                  {projection.neededPerDayCents !== null && projection.remainingDays > 0 && (
                    <span className="text-ink-muted">
                      {' '}
                      · {formatBRL(projection.neededPerDayCents)} por dia nos {projection.remainingDays} dias
                      restantes
                    </span>
                  )}
                </>
              ) : (
                <strong className="text-[var(--good-text)]">Meta do mês batida.</strong>
              )}
            </p>
          </div>
          <Badge
            tone={
              projection.paceStatus === 'acima'
                ? 'good'
                : projection.paceStatus === 'no_ritmo'
                  ? 'info'
                  : 'serious'
            }
          >
            {projection.paceStatus === 'acima'
              ? 'Acima do ritmo'
              : projection.paceStatus === 'no_ritmo'
                ? 'No ritmo'
                : 'Abaixo do ritmo'}
          </Badge>
        </div>
        <ProgressBar
          className="mt-3"
          ratio={revenue.grossCents / goalSetting.targetCents}
          tone={revenue.grossCents >= goalSetting.targetCents ? 'good' : 'info'}
          markers={[{ at: periodProgress(month), label: 'Ponto do mês' }]}
        />
      </Card>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Faturamento mês a mês"
          subtitle="Últimos 13 meses, com a meta de R$ 30k marcada"
        >
          <div className="px-2 pb-3 pt-4">
            <MonthlyRevenueChart data={history} goalCents={goalSetting.targetCents} />
          </div>
        </Card>

        <Card title="Divisão do mês" subtitle="Pela regra vigente 10% caixa · 80/20">
          <div className="space-y-3 px-5 py-4">
            <SplitRow label="Caixa da empresa" cents={split.companyCents} color="var(--series-3)" />
            <SplitRow label="Yuri" cents={split.yuriCents} color="var(--series-1)" />
            <SplitRow label="Gustavo" cents={split.gustavoCents} color="var(--series-2)" />

            <div className="border-t border-hairline pt-3 text-[13px]">
              <div className="flex justify-between text-ink-2">
                <span>Yuri já retirou</span>
                <Money cents={split.withdrawals.yuri} />
              </div>
              <div className="mt-1 flex justify-between text-ink-2">
                <span>Saldo a retirar</span>
                <Money cents={split.balance.yuri} />
              </div>
            </div>

            {neededForYuri !== null && (
              <div className="rounded-lg bg-surface-2 px-3 py-2.5 text-[12.5px] text-ink-2">
                Para o Yuri tirar <strong>{formatBRL(floorSetting.yuriCents)}</strong>, o líquido do mês
                precisa chegar a <strong className="tabular">{formatBRL(neededForYuri)}</strong>.
                {revenue.netCents < neededForYuri && (
                  <>
                    {' '}
                    Faltam <strong className="tabular">{formatBRL(neededForYuri - revenue.netCents)}</strong>.
                  </>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Acumulado do mês" subtitle="Realizado contra o ritmo linear da meta">
          <div className="px-2 pb-3 pt-4">
            <DailyRevenueChart data={dailySeries} />
          </div>
        </Card>

        <Card title="Receita por serviço" subtitle={`${month.label} · por valor bruto`}>
          <div className="px-2 pb-3 pt-4">
            {byProduct.length > 0 ? (
              <BreakdownChart data={byProduct.slice(0, 7).map((p) => ({ label: p.label, valueCents: p.grossCents }))} />
            ) : (
              <p className="px-3 py-8 text-center text-[13px] text-ink-muted">Sem vendas no período.</p>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card title="Mix do mês" subtitle="Serviço x infoproduto">
          <Table>
            <tbody>
              {byType.map((row) => (
                <tr key={row.key}>
                  <Td>{row.label}</Td>
                  <Td align="right">{formatPercent(revenue.grossCents ? row.grossCents / revenue.grossCents : 0)}</Td>
                  <Td align="right">
                    <Money cents={row.grossCents} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card title="Por plataforma" subtitle="Concentração de recebimento">
          <Table>
            <tbody>
              {byPlatform.map((row) => (
                <tr key={row.key}>
                  <Td>{row.label}</Td>
                  <Td align="right">{row.count} vendas</Td>
                  <Td align="right">
                    <Money cents={row.grossCents} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card title="Comparativos" subtitle="Mesmo mês do ano passado e ticket">
          <Table>
            <tbody>
              <tr>
                <Td>{monthLabel(lastYear.start, true)}</Td>
                <Td align="right">
                  <Money cents={lastYearRevenue.grossCents} />
                </Td>
              </tr>
              <tr>
                <Td>Ticket médio</Td>
                <Td align="right">
                  <Money cents={revenue.averageTicketCents} />
                </Td>
              </tr>
              <tr>
                <Td>Vendas no mês</Td>
                <Td align="right">{revenue.count}</Td>
              </tr>
              <tr>
                <Td>Taxas pagas</Td>
                <Td align="right">
                  <Money cents={revenue.feeCents} />
                </Td>
              </tr>
              <tr>
                <Td>A receber</Td>
                <Td align="right">
                  <Money cents={cash.receivableCents} />
                </Td>
              </tr>
            </tbody>
          </Table>
        </Card>
      </div>

      <p className="mt-6 text-[12.5px] text-ink-muted">
        <Link href="/dre" className="underline underline-offset-2 hover:text-ink">
          Ver DRE completo
        </Link>{' '}
        ·{' '}
        <Link href="/metas" className="underline underline-offset-2 hover:text-ink">
          Projeção até os 30k
        </Link>{' '}
        ·{' '}
        <Link href="/inteligencia" className="underline underline-offset-2 hover:text-ink">
          Simulador de cenários
        </Link>
      </p>
    </>
  )
}

function SplitRow({ label, cents, color }: { label: string; cents: number; color: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
      <span className="text-[13.5px] text-ink-2">{label}</span>
      <span className="ml-auto text-[14px] font-medium text-ink">
        <Money cents={cents} />
      </span>
    </div>
  )
}

function AlertRow({
  alert,
}: {
  alert: { id: string; severity: 'info' | 'warning' | 'serious' | 'critical'; title: string; detail: string; href?: string }
}) {
  const config = {
    critical: { icon: OctagonAlert, tone: 'critical' as const },
    serious: { icon: TriangleAlert, tone: 'serious' as const },
    warning: { icon: AlertTriangle, tone: 'warning' as const },
    info: { icon: Info, tone: 'info' as const },
  }[alert.severity]

  const Icon = config.icon
  const body = (
    <div className="flex items-start gap-3 rounded-[10px] border border-hairline bg-surface px-4 py-3">
      <span className="mt-0.5 shrink-0">
        <Icon
          size={17}
          style={{
            color:
              alert.severity === 'critical'
                ? 'var(--critical)'
                : alert.severity === 'serious'
                  ? 'var(--serious)'
                  : alert.severity === 'warning'
                    ? 'var(--warning)'
                    : 'var(--series-1)',
          }}
        />
      </span>
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium text-ink">{alert.title}</p>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">{alert.detail}</p>
      </div>
    </div>
  )

  return alert.href ? (
    <Link href={alert.href} className="block transition-opacity hover:opacity-85">
      {body}
    </Link>
  ) : (
    body
  )
}
