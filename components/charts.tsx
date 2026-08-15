'use client'

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  Cell,
  LabelList,
} from 'recharts'
import { formatBRL, formatBRLCompact, formatPercent } from '@/lib/money'
import { monthLabel, formatDateBR } from '@/lib/dates'

/*
 * Gráficos.
 *
 * Regras seguidas aqui: um eixo por gráfico (nunca dois eixos y), cores de
 * série atribuídas por identidade e em ordem fixa, marcas finas, grade
 * recessiva, e rótulo/legenda sempre presente — cor nunca é o único canal
 * de identidade. Três cores da paleta ficam abaixo de 3:1 no fundo claro,
 * então todo gráfico traz rótulo visível ou tabela ao lado.
 */

const SERIES = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
]

const axisProps = {
  stroke: 'var(--axis)',
  tick: { fill: 'var(--ink-muted)', fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: 'var(--axis)' },
}

const moneyTick = (value: unknown) => formatBRLCompact(Number(value) * 100)

interface TooltipRow {
  name?: unknown
  value?: unknown
  color?: string
}

/**
 * O `payload` do Recharts é readonly e muda de forma entre versões menores;
 * aceitar uma forma frouxa aqui evita que uma atualização da lib quebre o
 * build de todos os gráficos de uma vez.
 */
interface TooltipShape {
  active?: boolean
  payload?: readonly TooltipRow[]
  label?: unknown
}

function ChartTooltip({
  active,
  payload,
  label,
  formatter = formatBRL,
}: TooltipShape & { formatter?: (value: number) => string }) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-lg border border-hairline bg-surface px-3 py-2 shadow-lg">
      {label !== undefined && label !== null && (
        <p className="mb-1.5 text-[12px] font-medium text-ink-2">{String(label)}</p>
      )}
      <ul className="space-y-1">
        {payload.map((row, index) => (
          <li key={index} className="flex items-center gap-2 text-[12.5px]">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
              style={{ background: row.color }}
            />
            <span className="text-ink-muted">{String(row.name ?? '')}</span>
            <span className="tabular ml-auto font-medium text-ink">
              {typeof row.value === 'number' ? formatter(row.value) : String(row.value ?? '')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const moneyTooltip = (props: unknown) => (
  <ChartTooltip {...(props as TooltipShape)} formatter={(v) => formatBRL(v * 100)} />
)

const legendStyle = { fontSize: 12.5, color: 'var(--ink-2)', paddingTop: 8 }
const cursorFill = { fill: 'color-mix(in srgb, var(--ink) 5%, transparent)' }

/* ------------------------------------------------------------------ *
 * Receita mensal com linha de meta
 * ------------------------------------------------------------------ */

export function MonthlyRevenueChart({
  data,
  goalCents,
  height = 280,
}: {
  data: Array<{ month: string; grossCents: number }>
  goalCents?: number
  height?: number
}) {
  const chartData = data.map((d) => ({
    label: monthLabel(d.month, true),
    valor: d.grossCents / 100,
  }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ top: 16, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
        <YAxis {...axisProps} width={62} tickFormatter={moneyTick} />
        <Tooltip cursor={cursorFill} content={moneyTooltip} />
        {goalCents ? (
          <ReferenceLine
            y={goalCents / 100}
            stroke="var(--series-2)"
            strokeDasharray="4 4"
            strokeWidth={2}
            label={{
              value: `meta ${formatBRLCompact(goalCents)}`,
              position: 'insideTopRight',
              fill: 'var(--series-2)',
              fontSize: 12,
            }}
          />
        ) : null}
        <Bar dataKey="valor" name="Faturamento" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={38} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/* ------------------------------------------------------------------ *
 * Acumulado do mês contra o ritmo necessário
 * ------------------------------------------------------------------ */

export function DailyRevenueChart({
  data,
  height = 240,
}: {
  data: Array<{ date: string; accumulatedCents?: number; targetCents?: number }>
  height?: number
}) {
  const chartData = data.map((d) => ({
    label: formatDateBR(d.date).slice(0, 5),
    realizado: d.accumulatedCents !== undefined ? d.accumulatedCents / 100 : undefined,
    meta: d.targetCents !== undefined ? d.targetCents / 100 : undefined,
  }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
        <defs>
          <linearGradient id="fillRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
        <YAxis {...axisProps} width={62} tickFormatter={moneyTick} />
        <Tooltip content={moneyTooltip} />
        <Legend wrapperStyle={legendStyle} />
        <Area
          type="monotone"
          dataKey="realizado"
          name="Acumulado"
          stroke="var(--series-1)"
          strokeWidth={2}
          fill="url(#fillRevenue)"
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="meta"
          name="Ritmo da meta"
          stroke="var(--series-2)"
          strokeWidth={2}
          strokeDasharray="4 4"
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/* ------------------------------------------------------------------ *
 * Composição (produto, plataforma, origem) — barras horizontais
 * ------------------------------------------------------------------ */

export function BreakdownChart({
  data,
  height,
  colorByIndex = true,
}: {
  data: Array<{ label: string; valueCents: number }>
  height?: number
  colorByIndex?: boolean
}) {
  const chartData = data.map((d) => ({ label: d.label, valor: d.valueCents / 100 }))
  const computedHeight = height ?? Math.max(150, chartData.length * 34 + 28)

  return (
    <ResponsiveContainer width="100%" height={computedHeight}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 76, left: 4, bottom: 4 }}>
        <CartesianGrid stroke="var(--grid)" horizontal={false} />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          {...axisProps}
          width={155}
          tick={{ fill: 'var(--ink-2)', fontSize: 12.5 }}
        />
        <Tooltip cursor={cursorFill} content={moneyTooltip} />
        <Bar dataKey="valor" name="Valor" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {chartData.map((_, index) => (
            <Cell key={index} fill={colorByIndex ? SERIES[index % SERIES.length] : 'var(--series-1)'} />
          ))}
          <LabelList
            dataKey="valor"
            position="right"
            formatter={moneyTick}
            style={{ fill: 'var(--ink-2)', fontSize: 12 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/* ------------------------------------------------------------------ *
 * Mix ao longo do tempo (empilhado)
 * ------------------------------------------------------------------ */

export function StackedMixChart({
  data,
  keys,
  height = 260,
}: {
  data: Array<Record<string, number | string>>
  keys: Array<{ key: string; label: string }>
  height?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} width={62} tickFormatter={moneyTick} />
        <Tooltip cursor={cursorFill} content={moneyTooltip} />
        <Legend wrapperStyle={legendStyle} />
        {keys.map((k, index) => (
          <Bar
            key={k.key}
            dataKey={k.key}
            name={k.label}
            stackId="mix"
            fill={SERIES[index % SERIES.length]}
            maxBarSize={38}
            stroke="var(--surface)"
            strokeWidth={2}
            radius={index === keys.length - 1 ? [4, 4, 0, 0] : 0}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

/* ------------------------------------------------------------------ *
 * Previsão de caixa
 * ------------------------------------------------------------------ */

export function CashFlowChart({
  data,
  height = 260,
}: {
  data: Array<{ date: string; cumulativeCents: number }>
  height?: number
}) {
  const chartData = data.map((d) => ({
    label: formatDateBR(d.date).slice(0, 5),
    saldo: d.cumulativeCents / 100,
  }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={32} />
        <YAxis {...axisProps} width={62} tickFormatter={moneyTick} />
        <Tooltip content={moneyTooltip} />
        <ReferenceLine y={0} stroke="var(--critical)" strokeWidth={2} />
        <Line
          type="monotone"
          dataKey="saldo"
          name="Saldo projetado"
          stroke="var(--series-1)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

/* ------------------------------------------------------------------ *
 * Tendência até a meta
 * ------------------------------------------------------------------ */

export function ForecastChart({
  history,
  forecast,
  goalCents,
  height = 300,
}: {
  history: Array<{ month: string; grossCents: number }>
  forecast: Array<{ month: string; projectedCents: number }>
  goalCents: number
  height?: number
}) {
  const data: Array<{ label: string; realizado?: number; projetado?: number }> = [
    ...history.map((h) => ({ label: monthLabel(h.month, true), realizado: h.grossCents / 100 })),
    ...forecast.map((f) => ({ label: monthLabel(f.month, true), projetado: f.projectedCents / 100 })),
  ]

  // Conecta as duas linhas no ponto de virada, senão elas ficam soltas.
  const lastHistory = history[history.length - 1]
  if (lastHistory && data[history.length - 1]) {
    data[history.length - 1].projetado = lastHistory.grossCents / 100
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 16, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={20} />
        <YAxis {...axisProps} width={62} tickFormatter={moneyTick} />
        <Tooltip content={moneyTooltip} />
        <Legend wrapperStyle={legendStyle} />
        <ReferenceLine
          y={goalCents / 100}
          stroke="var(--series-3)"
          strokeDasharray="4 4"
          strokeWidth={2}
          label={{
            value: `meta ${formatBRLCompact(goalCents)}`,
            position: 'insideTopLeft',
            fill: 'var(--series-3)',
            fontSize: 12,
          }}
        />
        <Line
          type="monotone"
          dataKey="realizado"
          name="Realizado"
          stroke="var(--series-1)"
          strokeWidth={2}
          dot={{ r: 3, strokeWidth: 0, fill: 'var(--series-1)' }}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="projetado"
          name="Projeção"
          stroke="var(--series-2)"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

/* ------------------------------------------------------------------ *
 * Taxa efetiva por método — magnitude, uma cor só
 * ------------------------------------------------------------------ */

export function FeeRatioChart({
  data,
  height,
}: {
  data: Array<{ label: string; ratio: number }>
  height?: number
}) {
  const chartData = data.map((d) => ({ label: d.label, taxa: d.ratio * 100 }))
  const computedHeight = height ?? Math.max(140, chartData.length * 32 + 28)
  const pctTick = (value: unknown) => formatPercent(Number(value) / 100)

  return (
    <ResponsiveContainer width="100%" height={computedHeight}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 68, left: 4, bottom: 4 }}>
        <CartesianGrid stroke="var(--grid)" horizontal={false} />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          {...axisProps}
          width={150}
          tick={{ fill: 'var(--ink-2)', fontSize: 12.5 }}
        />
        <Tooltip
          cursor={cursorFill}
          content={(props) => (
            <ChartTooltip {...(props as TooltipShape)} formatter={(v) => formatPercent(v / 100)} />
          )}
        />
        <Bar dataKey="taxa" name="Taxa efetiva" fill="var(--series-2)" radius={[0, 4, 4, 0]} maxBarSize={20}>
          <LabelList
            dataKey="taxa"
            position="right"
            formatter={pctTick}
            style={{ fill: 'var(--ink-2)', fontSize: 12 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
