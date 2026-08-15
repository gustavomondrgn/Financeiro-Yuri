import Link from 'next/link'
import { Download, Printer } from 'lucide-react'
import { currentMonth, previousMonth, monthRange, quarterRange, yearRange, parseIso, today, type Period } from '@/lib/dates'
import { formatBRL, formatPercent, variation } from '@/lib/money'
import { buildDre, computeBreakEven } from '@/lib/analytics/dre'
import type { Regime } from '@/lib/analytics/queries'
import { PageHeader } from '@/components/shell'
import { Card, Stat, Table, Th, Td, DeltaBadge } from '@/components/ui/primitives'

export const dynamic = 'force-dynamic'

function resolvePeriod(params: { periodo?: string; ano?: string; mes?: string }): Period {
  const now = parseIso(today())
  const year = Number(params.ano ?? now.y)

  switch (params.periodo) {
    case 'ano':
      return yearRange(year)
    case 't1':
      return quarterRange(year, 1)
    case 't2':
      return quarterRange(year, 2)
    case 't3':
      return quarterRange(year, 3)
    case 't4':
      return quarterRange(year, 4)
    case 'mes':
      return monthRange(year, Number(params.mes ?? now.m))
    default:
      return currentMonth()
  }
}

export default async function DrePage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; ano?: string; mes?: string; regime?: string }>
}) {
  const params = await searchParams
  const period = resolvePeriod(params)
  const regime: Regime = params.regime === 'competencia' ? 'accrual' : 'cash'

  const dre = await buildDre(period, regime)
  const prevPeriod = previousMonth(period)
  const prevDre = await buildDre(prevPeriod, regime)
  const breakEven = await computeBreakEven(period, regime)

  const prevMap = new Map(prevDre.lines.map((l) => [l.id, l.amountCents]))

  return (
    <>
      <PageHeader
        title="DRE"
        description={`${period.label} · regime de ${regime === 'cash' ? 'caixa' : 'competência'}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <RegimeToggle current={regime} params={params} />
            <Link
              href={`/api/export/dre?start=${period.start}&end=${period.end}&regime=${regime}`}
              className="inline-flex items-center gap-2 rounded-lg border border-hairline bg-surface px-3 py-2 text-[13.5px] text-ink hover:bg-surface-2"
            >
              <Download size={15} /> Exportar CSV
            </Link>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2 no-print">
        <PeriodLink label="Mês atual" href={`/dre?regime=${params.regime ?? 'caixa'}`} active={!params.periodo} />
        <PeriodLink
          label="Trimestre"
          href={`/dre?periodo=t${Math.ceil(parseIso(today()).m / 3)}&regime=${params.regime ?? 'caixa'}`}
          active={params.periodo?.startsWith('t') ?? false}
        />
        <PeriodLink
          label="Ano"
          href={`/dre?periodo=ano&regime=${params.regime ?? 'caixa'}`}
          active={params.periodo === 'ano'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Receita bruta" value={formatBRL(dre.totals.grossRevenue)} delta={variation(dre.totals.grossRevenue, prevDre.totals.grossRevenue)} />
        <Stat
          label="Margem de contribuição"
          value={formatPercent(dre.margins.contribution)}
          hint={formatBRL(dre.totals.contributionMargin)}
        />
        <Stat
          label="Lucro líquido"
          value={formatBRL(dre.totals.netProfit)}
          hint={`margem de ${formatPercent(dre.margins.net)}`}
          tone={dre.totals.netProfit < 0 ? 'critical' : 'good'}
        />
        <Stat
          label="Retido em caixa"
          value={formatBRL(dre.totals.retained)}
          hint="depois da distribuição aos sócios"
          tone={dre.totals.retained < 0 ? 'warning' : 'neutral'}
        />
      </div>

      <Card className="mt-3" title="Demonstração do resultado" subtitle={period.label}>
        <Table>
          <thead>
            <tr>
              <Th>Linha</Th>
              <Th align="right">Valor</Th>
              <Th align="right">% da receita</Th>
              <Th align="right">vs período anterior</Th>
            </tr>
          </thead>
          <tbody>
            {dre.lines.map((line) => {
              const previous = prevMap.get(line.id) ?? 0
              return (
                <tr key={line.id} className={line.emphasis ? 'bg-surface-2/60' : undefined}>
                  <Td className={line.emphasis ? 'font-semibold text-ink' : undefined}>
                    <span style={{ paddingLeft: line.level * 16 }}>{line.label}</span>
                    {line.hint && <span className="ml-2 text-[12px] text-ink-muted">{line.hint}</span>}
                  </Td>
                  <Td align="right" className={line.emphasis ? 'font-semibold text-ink' : undefined}>
                    <span className={line.amountCents < 0 ? 'text-[var(--critical)]' : undefined}>
                      {formatBRL(line.amountCents)}
                    </span>
                  </Td>
                  <Td align="right">{line.share !== undefined ? formatPercent(line.share) : '—'}</Td>
                  <Td align="right">
                    <DeltaBadge value={variation(Math.abs(line.amountCents), Math.abs(previous))} />
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </Card>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Ponto de equilíbrio" subtitle="Quanto precisa entrar para a estrutura se pagar">
          <div className="space-y-3 px-5 py-4 text-[13.5px]">
            <Row label="Custo fixo do período" value={formatBRL(breakEven.fixedCostsCents)} />
            <Row label="Margem de contribuição" value={formatPercent(breakEven.contributionRatio)} />
            <Row label="Faturamento de equilíbrio" value={formatBRL(breakEven.revenueCents)} emphasis />
            <Row
              label="Em número de atendimentos"
              value={
                breakEven.consultations !== null
                  ? `${breakEven.consultations} ao ticket de ${formatBRL(breakEven.averageTicketCents)}`
                  : '—'
              }
            />
            <p className="pt-1 text-[12.5px] text-ink-muted">
              Abaixo desse faturamento o mês fecha no vermelho antes de qualquer retirada.
            </p>
          </div>
        </Card>

        <Card title="Como ler este DRE" subtitle="O que cada bloco responde">
          <div className="space-y-2.5 px-5 py-4 text-[13px] text-ink-2">
            <p>
              <strong className="text-ink">Receita líquida</strong> é o que sobrou depois de taxa de
              plataforma, estorno e chargeback — o dinheiro que realmente chegou.
            </p>
            <p>
              <strong className="text-ink">Margem de contribuição</strong> é o que resta para pagar a
              estrutura fixa. Se ela cai, o problema é preço ou custo direto, não gasto de escritório.
            </p>
            <p>
              <strong className="text-ink">Resultado retido</strong> é o único número que mostra se a
              empresa está ficando mais forte. Distribuição alta com retido negativo significa que a
              operação está sendo financiada pelo caixa acumulado.
            </p>
            <p className="text-ink-muted">
              No regime de <strong>caixa</strong> tudo entra na data em que o dinheiro se moveu. No de{' '}
              <strong>competência</strong>, na data da venda — a diferença entre os dois é exatamente o
              parcelado a receber.
            </p>
          </div>
        </Card>
      </div>

      {/* PDF sai pela impressão do navegador — sem dependência extra e com o
          mesmo layout que está na tela. */}
      <p className="mt-4 inline-flex items-center gap-2 text-[12.5px] text-ink-muted no-print">
        <Printer size={14} />
        Ctrl+P gera o PDF deste DRE já formatado.
      </p>
    </>
  )
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-2">{label}</span>
      <span className={emphasis ? 'tabular text-[15px] font-semibold text-ink' : 'tabular text-ink'}>{value}</span>
    </div>
  )
}

function PeriodLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'rounded-lg bg-ink px-3 py-1.5 text-[13px] font-medium text-[var(--plane)]'
          : 'rounded-lg border border-hairline bg-surface px-3 py-1.5 text-[13px] text-ink-2 hover:bg-surface-2'
      }
    >
      {label}
    </Link>
  )
}

function RegimeToggle({ current, params }: { current: Regime; params: Record<string, string | undefined> }) {
  const base = new URLSearchParams()
  if (params.periodo) base.set('periodo', params.periodo)
  if (params.ano) base.set('ano', params.ano)
  if (params.mes) base.set('mes', params.mes)

  const cashParams = new URLSearchParams(base)
  cashParams.set('regime', 'caixa')
  const accrualParams = new URLSearchParams(base)
  accrualParams.set('regime', 'competencia')

  return (
    <div className="inline-flex rounded-lg border border-hairline bg-surface p-0.5">
      <Link
        href={`/dre?${cashParams}`}
        className={
          current === 'cash'
            ? 'rounded-[7px] bg-ink px-2.5 py-1.5 text-[12.5px] font-medium text-[var(--plane)]'
            : 'rounded-[7px] px-2.5 py-1.5 text-[12.5px] text-ink-2'
        }
      >
        Caixa
      </Link>
      <Link
        href={`/dre?${accrualParams}`}
        className={
          current === 'accrual'
            ? 'rounded-[7px] bg-ink px-2.5 py-1.5 text-[12.5px] font-medium text-[var(--plane)]'
            : 'rounded-[7px] px-2.5 py-1.5 text-[12.5px] text-ink-2'
        }
      >
        Competência
      </Link>
    </div>
  )
}
