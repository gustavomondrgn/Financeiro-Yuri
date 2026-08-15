import 'server-only'
import { and, sql, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { transactions } from '@/lib/db/schema'
import { today, parseIso, isoFrom, addMonths, type IsoDate } from '@/lib/dates'

/**
 * Módulo fiscal.
 *
 * Dois objetivos concretos:
 *  1. Medir o quanto o faturamento já ultrapassou o teto do MEI, com a
 *     consequência real (desenquadramento no ano seguinte até 20% de excesso;
 *     retroativo acima disso).
 *  2. Simular quanto sobraria como ME no Simples, para a migração dos
 *     próximos meses ser decidida com número.
 */

/** Teto anual do MEI. Configurável — a regra muda por lei. */
export const MEI_ANNUAL_LIMIT_CENTS = 81_000_00
export const MEI_TOLERANCE = 0.2

export interface MeiStatus {
  year: number
  accumulatedCents: number
  limitCents: number
  usageRatio: number
  excessCents: number
  /** Excesso acima de 20% dispara desenquadramento retroativo. */
  exceedsTolerance: boolean
  toleranceLimitCents: number
  projectedYearEndCents: number
  /** Mês em que o teto foi (ou será) ultrapassado. */
  breachMonth: string | null
  severity: 'ok' | 'atencao' | 'estourado' | 'critico'
  message: string
}

export async function getMeiStatus(year = Number(today().slice(0, 4))): Promise<MeiStatus> {
  const start = isoFrom(year, 1, 1)
  const end = isoFrom(year, 12, 31)

  const rows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', coalesce(${transactions.receiptDate}, ${transactions.saleDate})::date), 'YYYY-MM')`,
      gross: sql<number>`coalesce(sum(${transactions.grossCents}), 0)::int`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.kind, 'sale'),
        eq(transactions.status, 'approved'),
        sql`coalesce(${transactions.receiptDate}, ${transactions.saleDate}) >= ${start}`,
        sql`coalesce(${transactions.receiptDate}, ${transactions.saleDate}) <= ${end}`,
      ),
    )
    .groupBy(sql`date_trunc('month', coalesce(${transactions.receiptDate}, ${transactions.saleDate})::date)`)
    .orderBy(sql`date_trunc('month', coalesce(${transactions.receiptDate}, ${transactions.saleDate})::date)`)

  let accumulated = 0
  let breachMonth: string | null = null
  for (const row of rows) {
    accumulated += row.gross
    if (!breachMonth && accumulated > MEI_ANNUAL_LIMIT_CENTS) breachMonth = row.month
  }

  const currentYear = Number(today().slice(0, 4))
  const monthsElapsed = year < currentYear ? 12 : Math.max(1, Number(today().slice(5, 7)))
  const monthlyAverage = accumulated / monthsElapsed
  const projected = Math.round(monthlyAverage * 12)

  const excess = Math.max(0, accumulated - MEI_ANNUAL_LIMIT_CENTS)
  const toleranceLimit = Math.round(MEI_ANNUAL_LIMIT_CENTS * (1 + MEI_TOLERANCE))
  const exceedsTolerance = accumulated > toleranceLimit
  const usageRatio = accumulated / MEI_ANNUAL_LIMIT_CENTS

  let severity: MeiStatus['severity'] = 'ok'
  let message = 'Faturamento dentro do teto do MEI.'

  if (exceedsTolerance) {
    severity = 'critico'
    message =
      'Excesso acima de 20% do teto: o desenquadramento é retroativo ao início do ano, com os tributos recalculados como ME desde janeiro.'
  } else if (excess > 0) {
    severity = 'estourado'
    message =
      'Teto do MEI ultrapassado. Até 20% de excesso, o desenquadramento vale a partir de janeiro do ano seguinte, com o excedente tributado como ME.'
  } else if (projected > MEI_ANNUAL_LIMIT_CENTS) {
    severity = 'atencao'
    message = 'No ritmo atual, o teto será ultrapassado antes do fim do ano.'
  }

  return {
    year,
    accumulatedCents: accumulated,
    limitCents: MEI_ANNUAL_LIMIT_CENTS,
    usageRatio,
    excessCents: excess,
    exceedsTolerance,
    toleranceLimitCents: toleranceLimit,
    projectedYearEndCents: projected,
    breachMonth,
    severity,
    message,
  }
}

/* ------------------------------------------------------------------ *
 * Simples Nacional
 * ------------------------------------------------------------------ */

interface Bracket {
  upTo: number
  rate: number
  deduction: number
}

/** Anexo III — serviços com Fator R ≥ 28%. Valores em centavos. */
const ANEXO_III: Bracket[] = [
  { upTo: 180_000_00, rate: 0.06, deduction: 0 },
  { upTo: 360_000_00, rate: 0.112, deduction: 9_360_00 },
  { upTo: 720_000_00, rate: 0.135, deduction: 17_640_00 },
  { upTo: 1_800_000_00, rate: 0.16, deduction: 35_640_00 },
  { upTo: 3_600_000_00, rate: 0.21, deduction: 125_640_00 },
  { upTo: 4_800_000_00, rate: 0.33, deduction: 648_000_00 },
]

/** Anexo V — serviços com Fator R < 28%. */
const ANEXO_V: Bracket[] = [
  { upTo: 180_000_00, rate: 0.155, deduction: 0 },
  { upTo: 360_000_00, rate: 0.18, deduction: 4_500_00 },
  { upTo: 720_000_00, rate: 0.195, deduction: 9_900_00 },
  { upTo: 1_800_000_00, rate: 0.205, deduction: 17_100_00 },
  { upTo: 3_600_000_00, rate: 0.23, deduction: 62_100_00 },
  { upTo: 4_800_000_00, rate: 0.305, deduction: 540_000_00 },
]

export const FATOR_R_THRESHOLD = 0.28

export interface SimplesSimulation {
  rbt12Cents: number
  annex: 'III' | 'V'
  fatorR: number
  nominalRate: number
  effectiveRate: number
  monthlyRevenueCents: number
  monthlyTaxCents: number
  /** Folha mensal (pró-labore) necessária para cair no Anexo III. */
  payrollForAnnexIIICents: number
  currentPayrollCents: number
}

/**
 * Simula o Simples a partir do faturamento dos últimos 12 meses.
 *
 * O Fator R é a alavanca: com folha (pró-labore) ≥ 28% da receita, a
 * empresa cai no Anexo III e a alíquota inicial despenca de 15,5% para 6%.
 * Como os sócios já retiram quase tudo, formalizar parte disso como
 * pró-labore costuma ser a diferença entre os dois cenários.
 */
export function simulateSimples(
  rbt12Cents: number,
  monthlyRevenueCents: number,
  monthlyPayrollCents: number,
): SimplesSimulation {
  const annualPayroll = monthlyPayrollCents * 12
  const fatorR = rbt12Cents > 0 ? annualPayroll / rbt12Cents : 0
  const useAnnexIII = fatorR >= FATOR_R_THRESHOLD
  const table = useAnnexIII ? ANEXO_III : ANEXO_V

  const bracket = table.find((b) => rbt12Cents <= b.upTo) ?? table[table.length - 1]
  const base = Math.max(rbt12Cents, 1)
  const effectiveRate = (base * bracket.rate - bracket.deduction) / base

  return {
    rbt12Cents,
    annex: useAnnexIII ? 'III' : 'V',
    fatorR,
    nominalRate: bracket.rate,
    effectiveRate: Math.max(0, effectiveRate),
    monthlyRevenueCents,
    monthlyTaxCents: Math.round(monthlyRevenueCents * Math.max(0, effectiveRate)),
    payrollForAnnexIIICents: Math.ceil((rbt12Cents * FATOR_R_THRESHOLD) / 12),
    currentPayrollCents: monthlyPayrollCents,
  }
}

/** Receita bruta acumulada dos últimos 12 meses (base do RBT12). */
export async function getRbt12(reference: IsoDate = today()): Promise<number> {
  const { y, m } = parseIso(reference)
  const start = addMonths(y, m, -11)
  const startDate = isoFrom(start.y, start.m, 1)

  const [row] = await db
    .select({ gross: sql<number>`coalesce(sum(${transactions.grossCents}), 0)::int` })
    .from(transactions)
    .where(
      and(
        eq(transactions.kind, 'sale'),
        eq(transactions.status, 'approved'),
        sql`coalesce(${transactions.receiptDate}, ${transactions.saleDate}) >= ${startDate}`,
        sql`coalesce(${transactions.receiptDate}, ${transactions.saleDate}) <= ${reference}`,
      ),
    )

  return row?.gross ?? 0
}
