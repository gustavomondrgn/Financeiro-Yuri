import 'server-only'
import { and, eq, gte, lte, sql, isNull, or, desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { transactions, products, partnerRules, partnerWithdrawals, type PartnerRule } from '@/lib/db/schema'
import { splitCents } from '@/lib/money'
import type { Period, IsoDate } from '@/lib/dates'

/**
 * Motor de divisão entre os sócios.
 *
 * A regra de hoje é: 10% do líquido vai para o caixa da empresa e, **do que
 * sobra**, 80% é do Yuri e 20% do Gustavo. Por isso `companyPct` incide
 * sobre a base e `yuriPct`/`gustavoPct` incidem sobre o resto — é assim que
 * eles pensam, e modelar diferente produziria número que não bate com a
 * conta que já fazem na mão.
 *
 * As regras são versionadas por vigência e por tipo de produto: quando a
 * escola de astrologia entrar em 50/50 ou o Gustavo subir para 30%, cria-se
 * uma vigência nova e os meses anteriores continuam intactos.
 */

export interface SplitAmounts {
  baseCents: number
  companyCents: number
  yuriCents: number
  gustavoCents: number
}

export function applyRule(baseCents: number, rule: PartnerRule): SplitAmounts {
  const companyPct = Number(rule.companyPct)
  const yuriPct = Number(rule.yuriPct)
  const gustavoPct = Number(rule.gustavoPct)

  const [companyCents] = splitCents(baseCents, [companyPct])
  const remainder = baseCents - companyCents
  const [yuriCents, gustavoCents] = splitCents(remainder, [yuriPct, gustavoPct])

  return { baseCents, companyCents, yuriCents, gustavoCents }
}

export async function getRules(): Promise<PartnerRule[]> {
  return db.select().from(partnerRules).orderBy(desc(partnerRules.effectiveFrom))
}

/** Regra vigente numa data para um tipo de produto (específica ganha da genérica). */
export async function getRuleFor(
  date: IsoDate,
  productType: 'service' | 'infoproduct' | 'other' | null,
): Promise<PartnerRule | null> {
  const rows = await db
    .select()
    .from(partnerRules)
    .where(
      and(
        lte(partnerRules.effectiveFrom, date),
        or(isNull(partnerRules.effectiveTo), gte(partnerRules.effectiveTo, date)),
      ),
    )

  if (rows.length === 0) return null

  const specific = rows.find((r) => productType && r.productType === productType)
  if (specific) return specific

  const generic = rows.find((r) => !r.productType)
  return generic ?? rows[0]
}

export interface PartnerSplitReport extends SplitAmounts {
  /** Transações que não encontraram regra vigente. */
  unmatchedCents: number
  withdrawals: { yuri: number; gustavo: number; company: number }
  balance: { yuri: number; gustavo: number }
}

/**
 * Calcula o rateio do período transação a transação.
 *
 * Não usa o total do mês porque regra e tipo de produto podem mudar no meio
 * dele — e o erro só apareceria na hora de dividir dinheiro de verdade.
 */
export async function computeSplit(period: Period, regime: 'cash' | 'accrual' = 'cash'): Promise<PartnerSplitReport> {
  const dateCol =
    regime === 'cash'
      ? sql`coalesce(${transactions.receiptDate}, ${transactions.saleDate})`
      : transactions.saleDate

  const rows = await db
    .select({
      date: sql<string>`${dateCol}::text`,
      netCents: transactions.netCents,
      kind: transactions.kind,
      productType: products.type,
    })
    .from(transactions)
    .leftJoin(products, eq(transactions.productId, products.id))
    .where(
      and(
        eq(transactions.status, 'approved'),
        sql`${transactions.kind} in ('sale', 'refund', 'chargeback')`,
        sql`${dateCol} >= ${period.start}`,
        sql`${dateCol} <= ${period.end}`,
      ),
    )

  const rules = await db.select().from(partnerRules)

  const total: SplitAmounts = { baseCents: 0, companyCents: 0, yuriCents: 0, gustavoCents: 0 }
  let unmatchedCents = 0

  for (const row of rows) {
    // Estorno e chargeback entram como base negativa: quem dividiu o ganho
    // divide a perda.
    const sign = row.kind === 'sale' ? 1 : -1
    const base = row.netCents * sign

    const rule = pickRule(rules, row.date, row.productType ?? null)
    if (!rule) {
      unmatchedCents += base
      continue
    }

    const split = applyRule(Math.abs(base), rule)
    const factor = base < 0 ? -1 : 1
    total.baseCents += base
    total.companyCents += split.companyCents * factor
    total.yuriCents += split.yuriCents * factor
    total.gustavoCents += split.gustavoCents * factor
  }

  const withdrawalRows = await db
    .select({
      partner: partnerWithdrawals.partner,
      total: sql<number>`coalesce(sum(${partnerWithdrawals.amountCents}), 0)::int`,
    })
    .from(partnerWithdrawals)
    .where(and(gte(partnerWithdrawals.date, period.start), lte(partnerWithdrawals.date, period.end)))
    .groupBy(partnerWithdrawals.partner)

  const withdrawals = { yuri: 0, gustavo: 0, company: 0 }
  for (const row of withdrawalRows) withdrawals[row.partner] = row.total

  return {
    ...total,
    unmatchedCents,
    withdrawals,
    balance: {
      yuri: total.yuriCents - withdrawals.yuri,
      gustavo: total.gustavoCents - withdrawals.gustavo,
    },
  }
}

function pickRule(
  rules: PartnerRule[],
  date: string,
  productType: 'service' | 'infoproduct' | 'other' | null,
): PartnerRule | null {
  const valid = rules.filter(
    (r) => r.effectiveFrom <= date && (!r.effectiveTo || r.effectiveTo >= date),
  )
  if (valid.length === 0) return null
  return valid.find((r) => productType && r.productType === productType) ?? valid.find((r) => !r.productType) ?? valid[0]
}

/**
 * Faturamento líquido necessário para um sócio atingir um valor.
 *
 * É o número que responde à pergunta central do negócio hoje:
 * quanto precisamos faturar no mês para o Yuri tirar R$ 8.000.
 */
export function revenueNeededFor(
  targetCents: number,
  partner: 'yuri' | 'gustavo',
  rule: PartnerRule,
): number {
  const companyPct = Number(rule.companyPct) / 100
  const partnerPct = Number(partner === 'yuri' ? rule.yuriPct : rule.gustavoPct) / 100
  const factor = (1 - companyPct) * partnerPct
  if (factor <= 0) return 0
  return Math.ceil(targetCents / factor)
}

/** Converte líquido em bruto usando a taxa efetiva observada no período. */
export function netToGross(netCents: number, effectiveFeeRatio: number): number {
  if (effectiveFeeRatio <= 0 || effectiveFeeRatio >= 1) return netCents
  return Math.ceil(netCents / (1 - effectiveFeeRatio))
}
