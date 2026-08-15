import 'server-only'
import { and, sql, gte, lte, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { calendarEvents } from '@/lib/db/schema'
import type { Period } from '@/lib/dates'
import { getRevenue } from './queries'

/**
 * Capacidade e ocupação.
 *
 * Consulta é hora vendida. Enquanto a receita de serviço se aproxima do
 * teto físico da agenda, dá para crescer atendendo mais; depois disso, só
 * por ticket maior ou por produto que não consome hora. Este módulo existe
 * para que essa fronteira apareça em número antes de virar exaustão.
 */

export interface CapacityReport {
  bookedMinutes: number
  bookedHours: number
  availableHours: number
  occupancyRatio: number
  consultationCount: number
  noShowCount: number
  revenuePerHourCents: number
  /** Horas ainda vendáveis no período. */
  remainingHours: number
  /** Receita potencial se a agenda fosse preenchida ao ticket/hora atual. */
  potentialRevenueCents: number
}

export interface CapacitySettings {
  /** Horas que o Yuri se dispõe a atender por semana. */
  weeklyHours: number
}

export const DEFAULT_CAPACITY: CapacitySettings = { weeklyHours: 25 }

export async function getCapacity(
  period: Period,
  settings: CapacitySettings = DEFAULT_CAPACITY,
): Promise<CapacityReport> {
  const [booked] = await db
    .select({
      minutes: sql<number>`coalesce(sum(${calendarEvents.durationMinutes}), 0)::int`,
      count: sql<number>`count(*)::int`,
      cancelled: sql<number>`coalesce(sum(case when ${calendarEvents.status} = 'cancelled' then 1 else 0 end), 0)::int`,
    })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.isConsultation, true),
        gte(sql`${calendarEvents.startAt}::date`, period.start),
        lte(sql`${calendarEvents.startAt}::date`, period.end),
      ),
    )

  const revenue = await getRevenue(period, 'accrual')

  const days = daysBetween(period.start, period.end)
  const availableHours = (settings.weeklyHours / 7) * days
  const bookedHours = booked.minutes / 60
  const occupancy = availableHours > 0 ? bookedHours / availableHours : 0
  const revenuePerHour = bookedHours > 0 ? Math.round(revenue.grossCents / bookedHours) : 0
  const remaining = Math.max(0, availableHours - bookedHours)

  return {
    bookedMinutes: booked.minutes,
    bookedHours,
    availableHours,
    occupancyRatio: occupancy,
    consultationCount: booked.count,
    noShowCount: booked.cancelled,
    revenuePerHourCents: revenuePerHour,
    remainingHours: remaining,
    potentialRevenueCents: Math.round(remaining * revenuePerHour),
  }
}

function daysBetween(start: string, end: string): number {
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000) + 1
}

/**
 * Teto de receita por serviço.
 *
 * Responde direto: com a agenda cheia e o ticket atual, qual o máximo que
 * o serviço entrega por mês — e quanto disso ainda falta para os 30k.
 */
export interface ServiceCeiling {
  maxMonthlyRevenueCents: number
  currentMonthlyRevenueCents: number
  headroomCents: number
  ticketCents: number
  sessionsPerMonth: number
  /** Quanto da meta precisa vir de outra fonte que não a agenda. */
  gapToGoalCents: number
  reachableByAgenda: boolean
}

export function computeServiceCeiling(
  weeklyHours: number,
  averageSessionMinutes: number,
  ticketCents: number,
  currentMonthlyRevenueCents: number,
  goalCents: number,
): ServiceCeiling {
  const monthlyHours = (weeklyHours * 52) / 12
  const sessionsPerMonth = averageSessionMinutes > 0 ? Math.floor((monthlyHours * 60) / averageSessionMinutes) : 0
  const max = sessionsPerMonth * ticketCents

  return {
    maxMonthlyRevenueCents: max,
    currentMonthlyRevenueCents,
    headroomCents: Math.max(0, max - currentMonthlyRevenueCents),
    ticketCents,
    sessionsPerMonth,
    gapToGoalCents: Math.max(0, goalCents - max),
    reachableByAgenda: max >= goalCents,
  }
}
