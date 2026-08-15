import { sql, desc, gte } from 'drizzle-orm'
import { db } from '@/lib/db'
import { calendarEvents } from '@/lib/db/schema'
import { currentMonth, lastNMonths, monthLabel, formatDateTimeBR, today } from '@/lib/dates'
import { formatBRL, formatPercent } from '@/lib/money'
import { getCapacity, computeServiceCeiling } from '@/lib/analytics/capacity'
import { getRevenue, getRevenueByProductType } from '@/lib/analytics/queries'
import { getSetting } from '@/lib/settings'
import { env } from '@/lib/env'
import { PageHeader } from '@/components/shell'
import { Card, Stat, Table, Th, Td, Money, Badge, ProgressBar, EmptyState } from '@/components/ui/primitives'
import { BreakdownChart } from '@/components/charts'

export const dynamic = 'force-dynamic'

export default async function CapacidadePage() {
  const month = currentMonth()
  const capacitySetting = await getSetting('capacity')
  const goal = await getSetting('goal')

  const [capacity, revenue, byType] = await Promise.all([
    getCapacity(month, { weeklyHours: capacitySetting.weeklyHours }),
    getRevenue(month, 'accrual'),
    getRevenueByProductType(month, 'accrual'),
  ])

  const serviceRevenue = byType.find((t) => t.key === 'service')?.grossCents ?? 0
  const ticket = revenue.averageTicketCents

  const ceiling = computeServiceCeiling(
    capacitySetting.weeklyHours,
    capacitySetting.averageSessionMinutes,
    ticket,
    serviceRevenue,
    goal.targetCents,
  )

  const months = lastNMonths(6)
  const historyCapacity = await Promise.all(
    months.map((m) => getCapacity(m, { weeklyHours: capacitySetting.weeklyHours })),
  )

  const upcoming = await db
    .select()
    .from(calendarEvents)
    .where(gte(sql`${calendarEvents.startAt}::date`, today()))
    .orderBy(calendarEvents.startAt)
    .limit(10)

  const hasCalendar = env.google.configured

  return (
    <>
      <PageHeader
        title="Capacidade"
        description={`${month.label} · ${capacitySetting.weeklyHours}h por semana disponíveis, sessão média de ${capacitySetting.averageSessionMinutes} min`}
      />

      {!hasCalendar && (
        <Card className="mb-3 px-5 py-4">
          <p className="text-[13.5px] text-ink">
            <strong>Google Calendar ainda não conectado.</strong> Os números abaixo usam apenas os eventos já
            sincronizados no banco. Configure as credenciais do Google para a agenda alimentar a ocupação
            automaticamente.
          </p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Ocupação da agenda"
          value={formatPercent(capacity.occupancyRatio)}
          hint={`${capacity.bookedHours.toFixed(1)}h de ${capacity.availableHours.toFixed(0)}h`}
          tone={capacity.occupancyRatio > 0.85 ? 'warning' : 'neutral'}
        />
        <Stat label="Receita por hora atendida" value={formatBRL(capacity.revenuePerHourCents)} />
        <Stat label="Atendimentos no mês" value={String(capacity.consultationCount)} hint={`${capacity.noShowCount} cancelados`} />
        <Stat
          label="Horas ainda vendáveis"
          value={`${capacity.remainingHours.toFixed(1)} h`}
          hint={`potencial de ${formatBRL(capacity.potentialRevenueCents)}`}
        />
      </div>

      <Card className="mt-3 px-5 py-4">
        <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">Teto físico do serviço</p>
        <p className="mt-1.5 text-[15px] text-ink">
          Com {capacitySetting.weeklyHours}h por semana e sessões de {capacitySetting.averageSessionMinutes} min,
          cabem <strong>{ceiling.sessionsPerMonth} atendimentos por mês</strong>. Ao ticket atual de{' '}
          {formatBRL(ticket)}, isso é no máximo <strong>{formatBRL(ceiling.maxMonthlyRevenueCents)}</strong> de
          receita de serviço.
        </p>
        <p className="mt-2 text-[13.5px] text-ink-2">
          {ceiling.reachableByAgenda ? (
            <>
              A meta de {formatBRL(goal.targetCents)} <strong>cabe na agenda</strong> — ainda há{' '}
              {formatBRL(ceiling.headroomCents)} de espaço antes do teto físico.
            </>
          ) : (
            <>
              A meta de {formatBRL(goal.targetCents)} <strong>não cabe na agenda</strong>. Faltariam{' '}
              <strong>{formatBRL(ceiling.gapToGoalCents)}</strong> que precisam vir de ticket maior ou de
              produto que não consome hora do Yuri — infoproduto, curso, produto gravado.
            </>
          )}
        </p>
        <ProgressBar
          className="mt-3"
          ratio={ceiling.maxMonthlyRevenueCents > 0 ? serviceRevenue / ceiling.maxMonthlyRevenueCents : 0}
          tone={ceiling.reachableByAgenda ? 'info' : 'warning'}
        />
        <p className="mt-2 text-[12.5px] text-ink-muted">
          Receita de serviço no mês: {formatBRL(serviceRevenue)} de um teto de{' '}
          {formatBRL(ceiling.maxMonthlyRevenueCents)}
        </p>
      </Card>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Ocupação mês a mês" subtitle="Horas atendidas nos últimos 6 meses">
          <div className="px-2 pb-3 pt-4">
            <BreakdownChart
              data={months.map((m, i) => ({
                label: monthLabel(m.start, true),
                valueCents: Math.round(historyCapacity[i].bookedHours * 100),
              }))}
              colorByIndex={false}
            />
            <p className="px-3 pb-2 text-[12px] text-ink-muted">
              Valores em horas (o eixo usa a mesma escala monetária para reaproveitar o gráfico).
            </p>
          </div>
        </Card>

        <Card title="Próximos atendimentos" subtitle="Do Google Calendar">
          {upcoming.length === 0 ? (
            <EmptyState
              title="Nenhum evento sincronizado"
              description="Conecte o Google Calendar em Configurações para a agenda aparecer aqui."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Quando</Th>
                  <Th>Evento</Th>
                  <Th align="right">Duração</Th>
                  <Th align="center">Estado</Th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((event) => (
                  <tr key={event.id}>
                    <Td className="whitespace-nowrap">{formatDateTimeBR(event.startAt)}</Td>
                    <Td className="text-ink">{event.title ?? 'Sem título'}</Td>
                    <Td align="right">{event.durationMinutes} min</Td>
                    <Td align="center">
                      <Badge tone={event.status === 'cancelled' ? 'critical' : 'good'}>
                        {event.status === 'cancelled' ? 'cancelado' : 'confirmado'}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card className="mt-3" title="Detalhe por mês" subtitle="Ocupação, receita por hora e potencial ocioso">
        <Table className="min-w-[620px]">
          <thead>
            <tr>
              <Th>Mês</Th>
              <Th align="right">Horas atendidas</Th>
              <Th align="right">Ocupação</Th>
              <Th align="right">Receita/hora</Th>
              <Th align="right">Potencial ocioso</Th>
            </tr>
          </thead>
          <tbody>
            {months.map((m, i) => (
              <tr key={m.start}>
                <Td>{monthLabel(m.start)}</Td>
                <Td align="right">{historyCapacity[i].bookedHours.toFixed(1)} h</Td>
                <Td align="right">{formatPercent(historyCapacity[i].occupancyRatio)}</Td>
                <Td align="right">
                  <Money cents={historyCapacity[i].revenuePerHourCents} />
                </Td>
                <Td align="right">
                  <Money cents={historyCapacity[i].potentialRevenueCents} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  )
}
