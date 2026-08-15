import { currentMonth, lastNMonths, monthLabel, formatDateBR } from '@/lib/dates'
import { formatBRL, formatPercent } from '@/lib/money'
import { getRevenue, getRevenueByMonth } from '@/lib/analytics/queries'
import { projectMonth, buildGoalRoadmap, describeForecast } from '@/lib/analytics/goals'
import { getSetting } from '@/lib/settings'
import { getCapacity } from '@/lib/analytics/capacity'
import { PageHeader } from '@/components/shell'
import { Card, Stat, Badge, Table, Th, Td, Money, ProgressBar } from '@/components/ui/primitives'
import { ForecastChart, MonthlyRevenueChart } from '@/components/charts'

export const dynamic = 'force-dynamic'

export default async function MetasPage() {
  const month = currentMonth()
  const goal = await getSetting('goal')

  const [revenue, projection, roadmap, capacity] = await Promise.all([
    getRevenue(month),
    projectMonth(month, goal.targetCents),
    buildGoalRoadmap(goal.targetCents, goal.deadline, 18),
    getCapacity(month),
  ])

  const months = lastNMonths(13)
  const history = await getRevenueByMonth(months[0].start, month.end)

  const ticket = revenue.averageTicketCents
  const salesNeeded = ticket > 0 ? Math.ceil(Math.max(0, goal.targetCents - revenue.grossCents) / ticket) : null
  const weeksLeft = Math.max(1, Math.ceil(projection.remainingDays / 7))

  return (
    <>
      <PageHeader
        title="Metas e projeção"
        description={`Meta de ${formatBRL(goal.targetCents)} por mês até ${formatDateBR(goal.deadline)}`}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Realizado no mês"
          value={formatBRL(revenue.grossCents)}
          hint={`${formatPercent(revenue.grossCents / goal.targetCents)} da meta`}
        />
        <Stat
          label="Projeção de fechamento"
          value={formatBRL(projection.projectedCents)}
          tone={projection.paceStatus === 'abaixo' ? 'warning' : projection.paceStatus === 'acima' ? 'good' : 'neutral'}
        />
        <Stat
          label="Média dos 3 últimos meses"
          value={formatBRL(roadmap.currentAverageCents)}
          hint="base da projeção estrutural"
        />
        <Stat
          label="Crescimento observado"
          value={`${roadmap.forecast.slopeCentsPerMonth >= 0 ? '+' : ''}${formatBRL(roadmap.forecast.slopeCentsPerMonth)}/mês`}
          hint={`confiança da tendência: ${formatPercent(Math.max(0, roadmap.forecast.r2))}`}
          tone={roadmap.forecast.slopeCentsPerMonth > 0 ? 'good' : 'warning'}
        />
      </div>

      <Card className="mt-3 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">Caminho até os 30k</p>
            <p className="mt-1.5 text-[15px] text-ink">{describeForecast(roadmap.forecast)}</p>
            <p className="mt-1 text-[13.5px] text-ink-2">
              A média atual é {formatBRL(roadmap.currentAverageCents)}. Faltam{' '}
              <strong>{formatBRL(Math.max(0, roadmap.gapCents))}</strong> em {roadmap.monthsRemaining} meses — o que
              exige crescer <strong>{formatBRL(Math.max(0, roadmap.requiredMonthlyGrowthCents))}</strong> por mês
              {roadmap.requiredGrowthRatio > 0 && <> ({formatPercent(roadmap.requiredGrowthRatio)} ao mês)</>}.
            </p>
          </div>
          <Badge tone={roadmap.onTrack ? 'good' : 'serious'}>
            {roadmap.onTrack ? 'No caminho' : 'Fora do ritmo necessário'}
          </Badge>
        </div>
        <ProgressBar
          className="mt-3"
          ratio={roadmap.currentAverageCents / roadmap.targetCents}
          tone={roadmap.onTrack ? 'good' : 'warning'}
        />
      </Card>

      <Card
        className="mt-3"
        title="Tendência e projeção"
        subtitle="Regressão sobre o histórico mensal, com a meta marcada"
      >
        <div className="px-2 pb-3 pt-4">
          <ForecastChart history={history} forecast={roadmap.forecast.forecast} goalCents={goal.targetCents} />
        </div>
      </Card>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="O que falta neste mês" subtitle="Traduzido em ação">
          <Table>
            <tbody>
              <tr>
                <Td>Faltam para a meta</Td>
                <Td align="right">
                  <Money cents={Math.max(0, goal.targetCents - revenue.grossCents)} />
                </Td>
              </tr>
              <tr>
                <Td>Dias restantes</Td>
                <Td align="right">{projection.remainingDays}</Td>
              </tr>
              <tr>
                <Td>Necessário por dia</Td>
                <Td align="right">
                  <Money cents={projection.neededPerDayCents ?? 0} />
                </Td>
              </tr>
              <tr>
                <Td>Consultas necessárias</Td>
                <Td align="right">
                  {salesNeeded !== null ? `${salesNeeded} ao ticket de ${formatBRL(ticket)}` : '—'}
                </Td>
              </tr>
              <tr>
                <Td>Por semana</Td>
                <Td align="right">{salesNeeded !== null ? `${Math.ceil(salesNeeded / weeksLeft)} por semana` : '—'}</Td>
              </tr>
              <tr>
                <Td>Horas livres na agenda</Td>
                <Td align="right">{capacity.remainingHours.toFixed(1)} h</Td>
              </tr>
            </tbody>
          </Table>
        </Card>

        <Card title="Histórico mensal" subtitle="Últimos 13 meses contra a meta">
          <div className="px-2 pb-3 pt-4">
            <MonthlyRevenueChart data={history} goalCents={goal.targetCents} height={260} />
          </div>
        </Card>
      </div>

      <Card className="mt-3" title="Projeção mês a mês" subtitle="Se o ritmo de crescimento atual se mantiver">
        <Table>
          <thead>
            <tr>
              <Th>Mês</Th>
              <Th align="right">Projeção</Th>
              <Th align="right">% da meta</Th>
              <Th align="center">Situação</Th>
            </tr>
          </thead>
          <tbody>
            {roadmap.forecast.forecast.slice(0, 12).map((point) => (
              <tr key={point.month}>
                <Td>{monthLabel(point.month)}</Td>
                <Td align="right">
                  <Money cents={point.projectedCents} />
                </Td>
                <Td align="right">{formatPercent(point.projectedCents / goal.targetCents)}</Td>
                <Td align="center">
                  <Badge tone={point.projectedCents >= goal.targetCents ? 'good' : 'neutral'}>
                    {point.projectedCents >= goal.targetCents ? 'meta atingida' : 'abaixo'}
                  </Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  )
}
