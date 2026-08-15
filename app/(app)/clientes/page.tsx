import { desc, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { customers } from '@/lib/db/schema'
import { currentMonth, formatDateBR, monthLabel } from '@/lib/dates'
import { formatBRL, formatPercent } from '@/lib/money'
import {
  getCustomerMetrics,
  getReactivationList,
  getCohorts,
  getNewVsReturning,
} from '@/lib/analytics/customers'
import { PageHeader } from '@/components/shell'
import { Card, Stat, Table, Th, Td, Money, Badge, EmptyState } from '@/components/ui/primitives'

export const dynamic = 'force-dynamic'

export default async function ClientesPage() {
  const month = currentMonth()

  const [metrics, reactivation, cohorts, newVsReturning, top] = await Promise.all([
    getCustomerMetrics(),
    getReactivationList(25),
    getCohorts(12),
    getNewVsReturning(month),
    db
      .select()
      .from(customers)
      .where(sql`${customers.purchaseCount} > 0`)
      .orderBy(desc(customers.totalNetCents))
      .limit(15),
  ])

  const maxCohortMonths = Math.max(1, ...cohorts.map((c) => c.revenueByMonth.length))

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Base unificada das três plataformas — recompra, LTV e quem vale retomar"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Clientes na base" value={String(metrics.totalCustomers)} hint={`${metrics.repeatCustomers} compraram mais de uma vez`} />
        <Stat label="Taxa de recompra" value={formatPercent(metrics.repeatRatio)} tone={metrics.repeatRatio > 0.3 ? 'good' : 'neutral'} />
        <Stat label="LTV médio" value={formatBRL(metrics.averageLtvCents)} hint={`ticket médio de ${formatBRL(metrics.averageTicketCents)}`} />
        <Stat
          label="Concentração (top 10)"
          value={formatPercent(metrics.top10Share)}
          tone={metrics.top10Share > 0.4 ? 'warning' : 'neutral'}
          hint="fatia da receita nos 10 maiores"
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Clientes para retomar"
          subtitle={
            metrics.medianRepurchaseDays !== null
              ? `A base costuma voltar a cada ${metrics.medianRepurchaseDays} dias — estes já passaram desse intervalo`
              : 'Ainda sem histórico de recompra suficiente'
          }
        >
          {reactivation.length === 0 ? (
            <EmptyState title="Ninguém atrasado" description="Nenhum cliente passou do intervalo típico de recompra." />
          ) : (
            <Table className="min-w-[640px]">
              <thead>
                <tr>
                  <Th>Cliente</Th>
                  <Th>Contato</Th>
                  <Th>Última compra</Th>
                  <Th align="right">Compras</Th>
                  <Th align="right">Total gasto</Th>
                  <Th align="center">Atraso</Th>
                </tr>
              </thead>
              <tbody>
                {reactivation.map((c) => (
                  <tr key={c.customerId}>
                    <Td className="text-ink">{c.name}</Td>
                    <Td className="text-[12.5px]">{c.phone ?? c.email ?? '—'}</Td>
                    <Td>
                      {formatDateBR(c.lastPurchaseAt)}
                      <span className="ml-1.5 text-[12px] text-ink-muted">({c.daysSince} dias)</span>
                    </Td>
                    <Td align="right">{c.purchaseCount}</Td>
                    <Td align="right">
                      <Money cents={c.totalNetCents} />
                    </Td>
                    <Td align="center">
                      <Badge tone={c.overdueRatio > 3 ? 'critical' : c.overdueRatio > 2 ? 'serious' : 'warning'}>
                        {c.overdueRatio.toFixed(1)}x
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Novos x recorrentes" subtitle={month.label}>
          <Table>
            <tbody>
              <tr>
                <Td>Clientes novos</Td>
                <Td align="right">{newVsReturning.newCustomers}</Td>
                <Td align="right">
                  <Money cents={newVsReturning.newRevenueCents} />
                </Td>
              </tr>
              <tr>
                <Td>Clientes recorrentes</Td>
                <Td align="right">{newVsReturning.returningCustomers}</Td>
                <Td align="right">
                  <Money cents={newVsReturning.returningRevenueCents} />
                </Td>
              </tr>
            </tbody>
          </Table>
          <div className="border-t border-hairline px-5 py-4 text-[12.5px] text-ink-2">
            Receita de cliente recorrente não custa aquisição. Quando essa fatia cresce, a margem sobe sem
            precisar aumentar investimento em tráfego.
          </div>
        </Card>
      </div>

      <Card className="mt-3" title="Coortes por mês de aquisição" subtitle="Receita gerada por cada safra ao longo dos meses seguintes">
        {cohorts.length === 0 ? (
          <EmptyState title="Sem dados de coorte" />
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr>
                  <Th>Coorte</Th>
                  <Th align="right">Clientes</Th>
                  {Array.from({ length: Math.min(maxCohortMonths, 10) }, (_, i) => (
                    <Th key={i} align="right">
                      M{i}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohorts.map((cohort) => {
                  const max = Math.max(...cohort.revenueByMonth, 1)
                  return (
                    <tr key={cohort.cohort}>
                      <Td className="whitespace-nowrap text-ink">{monthLabel(`${cohort.cohort}-01`, true)}</Td>
                      <Td align="right">{cohort.customers}</Td>
                      {Array.from({ length: Math.min(maxCohortMonths, 10) }, (_, i) => {
                        const value = cohort.revenueByMonth[i] ?? 0
                        const intensity = value / max
                        return (
                          <Td key={i} align="right" className="tabular">
                            {value > 0 ? (
                              <span
                                className="inline-block rounded px-1.5 py-0.5"
                                style={{
                                  background: `color-mix(in srgb, var(--series-1) ${Math.round(intensity * 55)}%, transparent)`,
                                  color: intensity > 0.6 ? 'var(--ink)' : 'var(--ink-2)',
                                }}
                              >
                                {formatBRL(value)}
                              </span>
                            ) : (
                              <span className="text-ink-muted">—</span>
                            )}
                          </Td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-3" title="Maiores clientes" subtitle="Por valor líquido acumulado">
        <Table className="min-w-[560px]">
          <thead>
            <tr>
              <Th>Cliente</Th>
              <Th>Primeira compra</Th>
              <Th>Última compra</Th>
              <Th align="right">Compras</Th>
              <Th align="right">Total</Th>
            </tr>
          </thead>
          <tbody>
            {top.map((c) => (
              <tr key={c.id}>
                <Td className="text-ink">{c.name}</Td>
                <Td>{formatDateBR(c.firstPurchaseAt)}</Td>
                <Td>{formatDateBR(c.lastPurchaseAt)}</Td>
                <Td align="right">{c.purchaseCount}</Td>
                <Td align="right">
                  <Money cents={c.totalNetCents} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  )
}
