import 'server-only'
import { and, eq, lte, gte, desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { goals } from '@/lib/db/schema'
import {
  today,
  periodProgress,
  monthLabel,
  parseIso,
  addMonths,
  isoFrom,
  type Period,
  type IsoDate,
} from '@/lib/dates'
import { getRevenue, getRevenueByMonth, type Regime } from './queries'

/**
 * Metas e projeção.
 *
 * A meta declarada é R$ 30k/mês recorrentes até janeiro/2027. O sistema
 * responde três perguntas: como o mês vai fechar no ritmo atual, quanto
 * falta, e — pela tendência histórica — quando os 30k chegam de fato.
 */

export interface MonthProjection {
  period: Period
  realizedCents: number
  projectedCents: number
  progress: number
  dailyAverageCents: number
  remainingDays: number
  targetCents: number | null
  gapCents: number | null
  paceStatus: 'acima' | 'no_ritmo' | 'abaixo' | 'sem_meta'
  /** Quanto precisa entrar por dia útil restante para bater a meta. */
  neededPerDayCents: number | null
}

export async function projectMonth(
  period: Period,
  targetCents: number | null,
  regime: Regime = 'cash',
): Promise<MonthProjection> {
  const revenue = await getRevenue(period, regime)
  const progress = periodProgress(period)
  const realized = revenue.grossCents

  const totalDays = Number(period.end.slice(8, 10))
  const elapsedDays = Math.max(1, Math.round(progress * totalDays))
  const remainingDays = Math.max(0, totalDays - elapsedDays)

  const dailyAverage = Math.round(realized / elapsedDays)
  const projected = progress > 0 ? Math.round(realized / progress) : 0

  const gap = targetCents !== null ? targetCents - realized : null
  const neededPerDay =
    targetCents !== null && remainingDays > 0 ? Math.ceil(Math.max(0, targetCents - realized) / remainingDays) : null

  let paceStatus: MonthProjection['paceStatus'] = 'sem_meta'
  if (targetCents !== null && targetCents > 0) {
    const ratio = projected / targetCents
    paceStatus = ratio >= 1.02 ? 'acima' : ratio >= 0.95 ? 'no_ritmo' : 'abaixo'
  }

  return {
    period,
    realizedCents: realized,
    projectedCents: projected,
    progress,
    dailyAverageCents: dailyAverage,
    remainingDays,
    targetCents,
    gapCents: gap,
    paceStatus,
    neededPerDayCents: neededPerDay,
  }
}

export interface TrendForecast {
  /** Coeficiente linear: crescimento médio em centavos por mês. */
  slopeCentsPerMonth: number
  interceptCents: number
  r2: number
  currentLevelCents: number
  /** Mês projetado para atingir o alvo, ou null se a tendência não leva lá. */
  targetMonth: string | null
  monthsToTarget: number | null
  forecast: Array<{ month: string; projectedCents: number }>
}

/**
 * Regressão linear sobre o histórico mensal.
 *
 * Simples de propósito: com 12 a 36 pontos, modelo mais sofisticado dá
 * falsa precisão. O que interessa é a direção e a ordem de grandeza do
 * prazo — não uma data exata.
 */
export function linearForecast(
  history: Array<{ month: string; grossCents: number }>,
  targetCents: number,
  horizonMonths = 12,
): TrendForecast {
  const n = history.length
  if (n < 3) {
    return {
      slopeCentsPerMonth: 0,
      interceptCents: n > 0 ? history[n - 1].grossCents : 0,
      r2: 0,
      currentLevelCents: n > 0 ? history[n - 1].grossCents : 0,
      targetMonth: null,
      monthsToTarget: null,
      forecast: [],
    }
  }

  const xs = history.map((_, i) => i)
  const ys = history.map((h) => h.grossCents)
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n

  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY)
    den += (xs[i] - meanX) ** 2
  }

  const slope = den === 0 ? 0 : num / den
  const intercept = meanY - slope * meanX

  let ssRes = 0
  let ssTot = 0
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * xs[i]
    ssRes += (ys[i] - predicted) ** 2
    ssTot += (ys[i] - meanY) ** 2
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot

  const lastMonth = history[n - 1].month
  const { y, m } = parseIso(lastMonth)

  const forecast: Array<{ month: string; projectedCents: number }> = []
  let targetMonth: string | null = null
  let monthsToTarget: number | null = null

  for (let step = 1; step <= horizonMonths; step++) {
    const projected = Math.round(intercept + slope * (n - 1 + step))
    const { y: fy, m: fm } = addMonths(y, m, step)
    const month = isoFrom(fy, fm, 1)
    forecast.push({ month, projectedCents: Math.max(0, projected) })
    if (targetMonth === null && projected >= targetCents) {
      targetMonth = month
      monthsToTarget = step
    }
  }

  return {
    slopeCentsPerMonth: Math.round(slope),
    interceptCents: Math.round(intercept),
    r2,
    currentLevelCents: ys[n - 1],
    targetMonth,
    monthsToTarget,
    forecast,
  }
}

export async function getActiveGoal(period: Period) {
  const [goal] = await db
    .select()
    .from(goals)
    .where(
      and(
        eq(goals.active, true),
        eq(goals.kind, 'monthly_revenue'),
        lte(goals.periodStart, period.end),
        gte(goals.periodEnd, period.start),
      ),
    )
    .orderBy(desc(goals.periodStart))
    .limit(1)

  return goal ?? null
}

export interface GoalRoadmap {
  targetCents: number
  deadline: IsoDate
  currentAverageCents: number
  gapCents: number
  monthsRemaining: number
  /** Crescimento mensal necessário, em centavos, para chegar no prazo. */
  requiredMonthlyGrowthCents: number
  requiredGrowthRatio: number
  forecast: TrendForecast
  onTrack: boolean
}

/** Caminho até a meta estrutural (R$ 30k recorrentes em jan/2027). */
export async function buildGoalRoadmap(
  targetCents: number,
  deadline: IsoDate,
  monthsOfHistory = 18,
): Promise<GoalRoadmap> {
  const now = today()
  const { y, m } = parseIso(now)
  const start = addMonths(y, m, -(monthsOfHistory - 1))
  const history = await getRevenueByMonth(isoFrom(start.y, start.m, 1), now, 'cash')

  const normalized = history.map((h) => ({ month: h.month, grossCents: h.grossCents }))
  const forecast = linearForecast(normalized, targetCents, 24)

  const recent = normalized.slice(-3)
  const currentAverage =
    recent.length > 0 ? Math.round(recent.reduce((a, b) => a + b.grossCents, 0) / recent.length) : 0

  const { y: dy, m: dm } = parseIso(deadline)
  const monthsRemaining = Math.max(0, (dy - y) * 12 + (dm - m))
  const gap = targetCents - currentAverage
  const requiredGrowth = monthsRemaining > 0 ? Math.ceil(gap / monthsRemaining) : gap

  return {
    targetCents,
    deadline,
    currentAverageCents: currentAverage,
    gapCents: gap,
    monthsRemaining,
    requiredMonthlyGrowthCents: requiredGrowth,
    requiredGrowthRatio: currentAverage > 0 ? requiredGrowth / currentAverage : 0,
    forecast,
    onTrack: forecast.slopeCentsPerMonth >= requiredGrowth && requiredGrowth > 0,
  }
}

export function describeForecast(forecast: TrendForecast): string {
  if (forecast.slopeCentsPerMonth <= 0) {
    return 'A tendência dos últimos meses é de estabilidade ou queda — no ritmo atual a meta não é atingida.'
  }
  if (!forecast.targetMonth) {
    return 'O crescimento é positivo, mas insuficiente para atingir a meta dentro do horizonte projetado.'
  }
  return `Mantido o ritmo atual, a meta é atingida em ${monthLabel(forecast.targetMonth)}.`
}
