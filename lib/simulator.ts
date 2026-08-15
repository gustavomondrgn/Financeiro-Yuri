import { splitCents } from '@/lib/money'

/**
 * Simulador de cenários.
 *
 * Matemática pura, sem banco e sem servidor — roda no navegador enquanto o
 * usuário mexe nos controles. As mesmas fórmulas do DRE e do motor de
 * divisão, para que o cenário simulado seja comparável ao real.
 */

export interface ScenarioInput {
  /** Consultas por mês. */
  sessionsPerMonth: number
  /** Ticket médio da consulta, em centavos. */
  sessionTicketCents: number
  /** Receita mensal de infoprodutos, em centavos. */
  infoproductRevenueCents: number
  /** Taxa efetiva média das plataformas (0.03 = 3%). */
  feeRatio: number
  fixedCostsCents: number
  marketingCents: number
  /** Alíquota de imposto aplicada sobre o faturamento (0.06 = 6%). */
  taxRate: number
  /** Percentuais da regra de divisão. */
  companyPct: number
  yuriPct: number
  gustavoPct: number
  /** Piso mensal do Yuri, em centavos. */
  yuriFloorCents: number
  /** Horas de agenda disponíveis por semana. */
  weeklyHours: number
  /** Duração média do atendimento, em minutos. */
  sessionMinutes: number
}

export interface ScenarioResult {
  grossRevenueCents: number
  serviceRevenueCents: number
  feeCents: number
  netRevenueCents: number
  taxCents: number
  operatingResultCents: number
  distributableCents: number
  companyCents: number
  yuriCents: number
  gustavoCents: number
  netMargin: number
  /** Consultas que cabem na agenda no mês. */
  capacitySessions: number
  overCapacity: boolean
  occupancyRatio: number
  yuriFloorMet: boolean
  /** Faturamento bruto necessário para o Yuri bater o piso. */
  grossNeededForFloorCents: number
  breakEvenRevenueCents: number
}

export function simulate(input: ScenarioInput): ScenarioResult {
  const serviceRevenue = input.sessionsPerMonth * input.sessionTicketCents
  const gross = serviceRevenue + input.infoproductRevenueCents

  const fee = Math.round(gross * input.feeRatio)
  const netRevenue = gross - fee
  const tax = Math.round(gross * input.taxRate)

  const operating = netRevenue - input.fixedCostsCents - input.marketingCents - tax
  const distributable = Math.max(0, operating)

  const [companyCents] = splitCents(distributable, [input.companyPct])
  const remainder = distributable - companyCents
  const [yuriCents, gustavoCents] = splitCents(remainder, [input.yuriPct, input.gustavoPct])

  const monthlyHours = (input.weeklyHours * 52) / 12
  const capacitySessions = input.sessionMinutes > 0 ? Math.floor((monthlyHours * 60) / input.sessionMinutes) : 0

  // Quanto o líquido distribuível precisa ser para o Yuri bater o piso.
  const factor = (1 - input.companyPct / 100) * (input.yuriPct / 100)
  const distributableNeeded = factor > 0 ? Math.ceil(input.yuriFloorCents / factor) : 0
  const grossNeeded =
    input.feeRatio + input.taxRate < 1
      ? Math.ceil(
          (distributableNeeded + input.fixedCostsCents + input.marketingCents) /
            (1 - input.feeRatio - input.taxRate),
        )
      : 0

  const contributionRatio = 1 - input.feeRatio - input.taxRate
  const breakEven =
    contributionRatio > 0
      ? Math.ceil((input.fixedCostsCents + input.marketingCents) / contributionRatio)
      : 0

  return {
    grossRevenueCents: gross,
    serviceRevenueCents: serviceRevenue,
    feeCents: fee,
    netRevenueCents: netRevenue,
    taxCents: tax,
    operatingResultCents: operating,
    distributableCents: distributable,
    companyCents,
    yuriCents,
    gustavoCents,
    netMargin: gross > 0 ? operating / gross : 0,
    capacitySessions,
    overCapacity: input.sessionsPerMonth > capacitySessions,
    occupancyRatio: capacitySessions > 0 ? input.sessionsPerMonth / capacitySessions : 0,
    yuriFloorMet: yuriCents >= input.yuriFloorCents,
    grossNeededForFloorCents: grossNeeded,
    breakEvenRevenueCents: breakEven,
  }
}

/**
 * Quantos meses até a meta, dado um crescimento mensal composto.
 * Retorna null quando o crescimento não leva lá dentro do horizonte.
 */
export function monthsToGoal(
  currentCents: number,
  goalCents: number,
  monthlyGrowthRate: number,
  horizon = 36,
): number | null {
  if (currentCents >= goalCents) return 0
  if (monthlyGrowthRate <= 0) return null

  let value = currentCents
  for (let month = 1; month <= horizon; month++) {
    value = value * (1 + monthlyGrowthRate)
    if (value >= goalCents) return month
  }
  return null
}
