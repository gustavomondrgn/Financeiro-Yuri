import Link from 'next/link'
import { Download, ListFilter } from 'lucide-react'
import { db } from '@/lib/db'
import { products } from '@/lib/db/schema'
import { currentMonth, formatDateBR, monthRange, parseIso, today, yearRange, type Period } from '@/lib/dates'
import { formatBRL, formatPercent } from '@/lib/money'
import { getRevenue, getEffectiveFees, getRevenueByOrigin } from '@/lib/analytics/queries'
import {
  listTransactions,
  PLATFORM_LABELS,
  METHOD_LABELS,
  KIND_LABELS,
  STATUS_LABELS,
} from '@/lib/analytics/transactions'
import { PageHeader } from '@/components/shell'
import { Card, Stat, Badge, Table, Th, Td, Money, EmptyState } from '@/components/ui/primitives'
import { FeeRatioChart, BreakdownChart } from '@/components/charts'

export const dynamic = 'force-dynamic'

interface SearchParams {
  inicio?: string
  fim?: string
  plataforma?: string
  produto?: string
  metodo?: string
  tipo?: string
  busca?: string
  pagina?: string
}

function resolvePeriod(params: SearchParams): Period {
  if (params.inicio && params.fim) {
    return { start: params.inicio, end: params.fim, label: `${formatDateBR(params.inicio)} a ${formatDateBR(params.fim)}` }
  }
  return currentMonth()
}

export default async function ReceitasPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const period = resolvePeriod(params)
  const page = Math.max(1, Number(params.pagina ?? 1))

  const filters = {
    start: period.start,
    end: period.end,
    platform: params.plataforma || undefined,
    method: params.metodo || undefined,
    kind: params.tipo || undefined,
    productId: params.produto === 'unclassified' ? ('unclassified' as const) : params.produto ? Number(params.produto) : undefined,
    search: params.busca || undefined,
  }

  const [revenue, fees, origins, list, productList] = await Promise.all([
    getRevenue(period),
    getEffectiveFees(period),
    getRevenueByOrigin(period),
    listTransactions(filters, page, 50),
    db.select().from(products).orderBy(products.name),
  ])

  const totalPages = Math.max(1, Math.ceil(list.total / 50))
  const feeRatio = revenue.grossCents > 0 ? revenue.feeCents / revenue.grossCents : 0

  const exportParams = new URLSearchParams({ start: period.start, end: period.end })
  if (params.plataforma) exportParams.set('platform', params.plataforma)

  return (
    <>
      <PageHeader
        title="Receitas"
        description={`${period.label} · ${list.total} lançamentos`}
        action={
          <Link
            href={`/api/export/transacoes?${exportParams}`}
            className="inline-flex items-center gap-2 rounded-lg border border-hairline bg-surface px-3 py-2 text-[13.5px] text-ink hover:bg-surface-2"
          >
            <Download size={15} /> Exportar
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Faturamento bruto" value={formatBRL(revenue.grossCents)} hint={`${revenue.count} vendas`} />
        <Stat label="Recebido líquido" value={formatBRL(revenue.effectiveNetCents)} hint="já sem taxas e estornos" />
        <Stat
          label="Custo de receber"
          value={formatBRL(revenue.feeCents)}
          hint={`taxa efetiva de ${formatPercent(feeRatio)}`}
          tone={feeRatio > 0.05 ? 'warning' : 'neutral'}
        />
        <Stat label="Ticket médio" value={formatBRL(revenue.averageTicketCents)} />
      </div>

      <Card className="mt-3 no-print" title="Filtros" subtitle="Refine o período e o recorte">
        <form className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-6" method="get">
          <label className="text-[12.5px] text-ink-2">
            De
            <input
              type="date"
              name="inicio"
              defaultValue={period.start}
              className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[13px] text-ink"
            />
          </label>
          <label className="text-[12.5px] text-ink-2">
            Até
            <input
              type="date"
              name="fim"
              defaultValue={period.end}
              className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[13px] text-ink"
            />
          </label>
          <label className="text-[12.5px] text-ink-2">
            Plataforma
            <select
              name="plataforma"
              defaultValue={params.plataforma ?? ''}
              className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[13px] text-ink"
            >
              <option value="">Todas</option>
              {Object.entries(PLATFORM_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12.5px] text-ink-2">
            Serviço
            <select
              name="produto"
              defaultValue={params.produto ?? ''}
              className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[13px] text-ink"
            >
              <option value="">Todos</option>
              <option value="unclassified">Não classificados</option>
              {productList.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12.5px] text-ink-2">
            Busca
            <input
              type="search"
              name="busca"
              defaultValue={params.busca ?? ''}
              placeholder="cliente, descrição, origem"
              className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[13px] text-ink"
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-3 py-2 text-[13.5px] font-medium text-[var(--plane)]"
            >
              <ListFilter size={15} /> Filtrar
            </button>
          </div>
        </form>
      </Card>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card
          title="Taxa efetiva por forma de pagamento"
          subtitle="O custo real de receber, por método e parcelamento"
        >
          <div className="px-2 pb-3 pt-4">
            {fees.length > 0 ? (
              <FeeRatioChart
                data={fees.slice(0, 8).map((f) => ({
                  label: `${METHOD_LABELS[f.method] ?? f.method}${f.installments > 1 ? ` ${f.installments}x` : ''}`,
                  ratio: f.ratio,
                }))}
              />
            ) : (
              <EmptyState title="Sem dados de taxa no período" />
            )}
          </div>
        </Card>

        <Card title="Receita por origem" subtitle="De onde vem o dinheiro">
          <div className="px-2 pb-3 pt-4">
            {origins.length > 0 ? (
              <BreakdownChart data={origins.slice(0, 7).map((o) => ({ label: o.label, valueCents: o.grossCents }))} />
            ) : (
              <EmptyState
                title="Nenhuma origem registrada"
                description="Origem é preenchida automaticamente pelas plataformas de infoproduto e pode ser lançada à mão nas consultas."
              />
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-3" title="Lançamentos" subtitle={`Página ${page} de ${totalPages}`}>
        {list.rows.length === 0 ? (
          <EmptyState title="Nenhum lançamento encontrado" description="Ajuste os filtros ou importe o extrato do período." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Data</Th>
                  <Th>Descrição</Th>
                  <Th>Cliente</Th>
                  <Th>Serviço</Th>
                  <Th>Plataforma</Th>
                  <Th align="right">Bruto</Th>
                  <Th align="right">Taxa</Th>
                  <Th align="right">Líquido</Th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((row) => (
                  <tr key={row.id}>
                    <Td className="whitespace-nowrap">{formatDateBR(row.saleDate)}</Td>
                    <Td>
                      <span className="text-ink">{row.description ?? '—'}</span>
                      {row.kind !== 'sale' && (
                        <Badge tone="neutral" className="ml-2">
                          {KIND_LABELS[row.kind] ?? row.kind}
                        </Badge>
                      )}
                      {row.status !== 'approved' && (
                        <Badge tone="warning" className="ml-2">
                          {STATUS_LABELS[row.status] ?? row.status}
                        </Badge>
                      )}
                    </Td>
                    <Td>{row.customerName ?? row.counterpartyName ?? '—'}</Td>
                    <Td>
                      {row.productName ?? (
                        <Link href="/receitas/classificar" className="text-[var(--serious)] underline underline-offset-2">
                          classificar
                        </Link>
                      )}
                    </Td>
                    <Td>{PLATFORM_LABELS[row.platform] ?? row.platform}</Td>
                    <Td align="right">
                      <Money cents={row.grossCents} />
                    </Td>
                    <Td align="right">
                      <Money cents={row.feeCents} />
                    </Td>
                    <Td align="right">
                      <Money cents={row.netCents} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 text-[13px] no-print">
                <span className="text-ink-muted">
                  {list.total} lançamentos · {formatBRL(list.totalGrossCents)}
                </span>
                <div className="flex gap-2">
                  {page > 1 && (
                    <Link
                      href={`/receitas?${new URLSearchParams({ ...params, pagina: String(page - 1) } as Record<string, string>)}`}
                      className="rounded-lg border border-hairline px-3 py-1.5 hover:bg-surface-2"
                    >
                      Anterior
                    </Link>
                  )}
                  {page < totalPages && (
                    <Link
                      href={`/receitas?${new URLSearchParams({ ...params, pagina: String(page + 1) } as Record<string, string>)}`}
                      className="rounded-lg border border-hairline px-3 py-1.5 hover:bg-surface-2"
                    >
                      Próxima
                    </Link>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  )
}
