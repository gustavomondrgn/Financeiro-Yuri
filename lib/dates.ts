/**
 * Datas do sistema.
 *
 * Regra: datas de negócio (venda, recebimento, vencimento) são strings
 * `YYYY-MM-DD` no fuso de São Paulo. Nunca `Date` cru — `new Date('2026-08-15')`
 * é meia-noite UTC, que no Brasil ainda é dia 14, e o mês fecha errado.
 */

export const TIMEZONE = 'America/Sao_Paulo'

export type IsoDate = string // YYYY-MM-DD

export interface Period {
  start: IsoDate
  end: IsoDate
  label: string
}

const MONTHS_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

const MONTHS_PT_SHORT = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
]

/** Data de hoje no fuso de São Paulo. */
export function today(): IsoDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function parseIso(date: IsoDate): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number)
  return { y, m, d }
}

export function isoFrom(y: number, m: number, d: number): IsoDate {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function monthRange(y: number, m: number): Period {
  return {
    start: isoFrom(y, m, 1),
    end: isoFrom(y, m, daysInMonth(y, m)),
    label: `${MONTHS_PT[m - 1]} de ${y}`,
  }
}

export function currentMonth(): Period {
  const { y, m } = parseIso(today())
  return monthRange(y, m)
}

export function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const total = y * 12 + (m - 1) + delta
  return { y: Math.floor(total / 12), m: (total % 12) + 1 }
}

export function previousMonth(period: Period): Period {
  const { y, m } = parseIso(period.start)
  const prev = addMonths(y, m, -1)
  return monthRange(prev.y, prev.m)
}

export function sameMonthLastYear(period: Period): Period {
  const { y, m } = parseIso(period.start)
  return monthRange(y - 1, m)
}

export function yearRange(y: number): Period {
  return { start: isoFrom(y, 1, 1), end: isoFrom(y, 12, 31), label: String(y) }
}

export function quarterRange(y: number, q: number): Period {
  const startMonth = (q - 1) * 3 + 1
  const endMonth = startMonth + 2
  return {
    start: isoFrom(y, startMonth, 1),
    end: isoFrom(y, endMonth, daysInMonth(y, endMonth)),
    label: `${q}º trimestre de ${y}`,
  }
}

/** Últimos N meses terminando no mês corrente (inclusive). */
export function lastNMonths(n: number): Period[] {
  const { y, m } = parseIso(today())
  const out: Period[] = []
  for (let i = n - 1; i >= 0; i--) {
    const { y: yy, m: mm } = addMonths(y, m, -i)
    out.push(monthRange(yy, mm))
  }
  return out
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const { y, m, d } = parseIso(date)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

export function diffDays(a: IsoDate, b: IsoDate): number {
  const pa = parseIso(a)
  const pb = parseIso(b)
  const ms = Date.UTC(pa.y, pa.m - 1, pa.d) - Date.UTC(pb.y, pb.m - 1, pb.d)
  return Math.round(ms / 86_400_000)
}

export function monthLabel(date: IsoDate, short = false): string {
  const { y, m } = parseIso(date)
  return short ? `${MONTHS_PT_SHORT[m - 1]}/${String(y).slice(2)}` : `${MONTHS_PT[m - 1]} de ${y}`
}

export function formatDateBR(date: IsoDate | null | undefined): string {
  if (!date) return '—'
  const { y, m, d } = parseIso(date.slice(0, 10))
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

export function formatDateTimeBR(value: Date | string | null | undefined): string {
  if (!value) return '—'
  const dt = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dt)
}

/** Fração já decorrida do período — base das projeções por ritmo. */
export function periodProgress(period: Period, reference: IsoDate = today()): number {
  const total = diffDays(period.end, period.start) + 1
  const elapsed = diffDays(reference, period.start) + 1
  return Math.min(1, Math.max(0, elapsed / total))
}

/** Converte diversos formatos de data que aparecem em CSV para ISO. */
export function normalizeDate(input: string | Date | null | undefined): IsoDate | null {
  if (!input) return null
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(input)
  }

  const text = String(input).trim()
  if (!text) return null

  // YYYY-MM-DD (com ou sem hora)
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  // DD/MM/YYYY ou DD-MM-YYYY
  const br = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  if (br) {
    const d = br[1].padStart(2, '0')
    const m = br[2].padStart(2, '0')
    const y = br[3].length === 2 ? `20${br[3]}` : br[3]
    return `${y}-${m}-${d}`
  }

  // YYYYMMDD (OFX)
  const ofx = text.match(/^(\d{4})(\d{2})(\d{2})/)
  if (ofx) return `${ofx[1]}-${ofx[2]}-${ofx[3]}`

  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) return normalizeDate(parsed)
  return null
}
