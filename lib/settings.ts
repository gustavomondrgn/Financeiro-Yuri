import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { settings } from '@/lib/db/schema'

/**
 * Configurações mutáveis do negócio.
 *
 * Ficam no banco, não em constante de código, porque mudam com a operação:
 * horas de agenda, piso de retirada do Yuri, meta, alíquota provisionada.
 */

export interface CapacitySetting {
  weeklyHours: number
  averageSessionMinutes: number
}

export interface PartnerFloorSetting {
  yuriCents: number
  gustavoCents: number
}

export interface GoalSetting {
  targetCents: number
  deadline: string
}

export interface TaxSetting {
  meiMonthlyDasCents: number
  provisionRate: number
}

const DEFAULTS = {
  capacity: { weeklyHours: 25, averageSessionMinutes: 70 } as CapacitySetting,
  partner_floor: { yuriCents: 800_000, gustavoCents: 0 } as PartnerFloorSetting,
  goal: { targetCents: 3_000_000, deadline: '2027-01-31' } as GoalSetting,
  tax: { meiMonthlyDasCents: 8_100, provisionRate: 6 } as TaxSetting,
}

export type SettingKey = keyof typeof DEFAULTS

export async function getSetting<K extends SettingKey>(key: K): Promise<(typeof DEFAULTS)[K]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1)
  if (!row) return DEFAULTS[key]
  return { ...DEFAULTS[key], ...(row.value as object) } as (typeof DEFAULTS)[K]
}

export async function setSetting<K extends SettingKey>(
  key: K,
  value: Partial<(typeof DEFAULTS)[K]>,
): Promise<void> {
  const current = await getSetting(key)
  const merged = { ...current, ...value }

  await db
    .insert(settings)
    .values({ key, value: merged as object, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: merged as object, updatedAt: new Date() } })
}
