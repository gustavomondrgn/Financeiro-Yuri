import 'server-only'
import type { Period } from '@/lib/dates'
import { getRevenue, getExpenses, type Regime } from './queries'
import { computeSplit } from './split'

/**
 * DRE gerencial.
 *
 * Não é peça contábil formal — é a demonstração que responde às perguntas
 * que os sócios realmente fazem: quanto entrou, quanto o meio de pagamento
 * comeu, quanto custou operar, o que sobrou, quanto é de cada um e quanto
 * ficou de fato na empresa.
 */

export interface DreLine {
  id: string
  label: string
  amountCents: number
  /** Nível de indentação na tabela. */
  level: 0 | 1 | 2
  /** Linha de subtotal, destacada visualmente. */
  emphasis?: boolean
  /** Percentual sobre a receita bruta. */
  share?: number
  hint?: string
}

export interface DreReport {
  period: Period
  regime: Regime
  lines: DreLine[]
  totals: {
    grossRevenue: number
    deductions: number
    netRevenue: number
    directCosts: number
    contributionMargin: number
    fixedCosts: number
    marketing: number
    operatingResult: number
    taxes: number
    netProfit: number
    partnerDistribution: number
    retained: number
  }
  margins: {
    contribution: number
    operating: number
    net: number
  }
}

export async function buildDre(period: Period, regime: Regime = 'cash'): Promise<DreReport> {
  const revenue = await getRevenue(period, regime)
  const expenses = await getExpenses(period, regime)
  const split = await computeSplit(period, regime)

  const byKind = expenses.byKind
  const directCosts = byKind.direct_cost ?? 0
  const variableCosts = byKind.variable_cost ?? 0
  const fixedCosts = byKind.fixed_cost ?? 0
  const marketing = byKind.marketing ?? 0
  const investments = byKind.investment ?? 0
  const taxes = byKind.tax ?? 0

  const grossRevenue = revenue.grossCents
  const deductions = revenue.feeCents + revenue.refundCents + revenue.chargebackCents
  const netRevenue = grossRevenue - deductions
  const totalDirect = directCosts + variableCosts
  const contributionMargin = netRevenue - totalDirect
  const operatingResult = contributionMargin - fixedCosts - marketing
  const netProfit = operatingResult - taxes
  const partnerDistribution = split.yuriCents + split.gustavoCents
  const retained = netProfit - partnerDistribution - investments

  const share = (value: number) => (grossRevenue > 0 ? value / grossRevenue : 0)

  const lines: DreLine[] = [
    { id: 'gross', label: 'Receita bruta', amountCents: grossRevenue, level: 0, emphasis: true, share: 1 },
    { id: 'fees', label: 'Taxas das plataformas', amountCents: -revenue.feeCents, level: 1, share: -share(revenue.feeCents), hint: 'Custo real de receber (adquirência, antecipação)' },
    { id: 'refunds', label: 'Estornos', amountCents: -revenue.refundCents, level: 1, share: -share(revenue.refundCents) },
    { id: 'chargebacks', label: 'Chargebacks', amountCents: -revenue.chargebackCents, level: 1, share: -share(revenue.chargebackCents) },
    { id: 'net_revenue', label: 'Receita líquida', amountCents: netRevenue, level: 0, emphasis: true, share: share(netRevenue) },

    { id: 'direct', label: 'Custos diretos', amountCents: -directCosts, level: 1, share: -share(directCosts), hint: 'Custo atrelado à entrega do serviço/produto' },
    { id: 'variable', label: 'Custos variáveis', amountCents: -variableCosts, level: 1, share: -share(variableCosts) },
    { id: 'contribution', label: 'Margem de contribuição', amountCents: contributionMargin, level: 0, emphasis: true, share: share(contributionMargin), hint: 'O que sobra para pagar a estrutura fixa' },

    { id: 'fixed', label: 'Custos fixos', amountCents: -fixedCosts, level: 1, share: -share(fixedCosts) },
    { id: 'marketing', label: 'Marketing e tráfego', amountCents: -marketing, level: 1, share: -share(marketing) },
    { id: 'operating', label: 'Resultado operacional', amountCents: operatingResult, level: 0, emphasis: true, share: share(operatingResult) },

    { id: 'taxes', label: 'Impostos', amountCents: -taxes, level: 1, share: -share(taxes) },
    { id: 'profit', label: 'Lucro líquido', amountCents: netProfit, level: 0, emphasis: true, share: share(netProfit) },

    { id: 'yuri', label: 'Distribuição — Yuri', amountCents: -split.yuriCents, level: 1, share: -share(split.yuriCents) },
    { id: 'gustavo', label: 'Distribuição — Gustavo', amountCents: -split.gustavoCents, level: 1, share: -share(split.gustavoCents) },
    { id: 'investments', label: 'Investimentos', amountCents: -investments, level: 1, share: -share(investments), hint: 'Equipamento, cursos, ativos — saem do caixa, não da operação' },
    { id: 'retained', label: 'Resultado retido em caixa', amountCents: retained, level: 0, emphasis: true, share: share(retained), hint: 'O que de fato ficou na empresa' },
  ]

  return {
    period,
    regime,
    lines,
    totals: {
      grossRevenue,
      deductions,
      netRevenue,
      directCosts: totalDirect,
      contributionMargin,
      fixedCosts,
      marketing,
      operatingResult,
      taxes,
      netProfit,
      partnerDistribution,
      retained,
    },
    margins: {
      contribution: grossRevenue > 0 ? contributionMargin / grossRevenue : 0,
      operating: grossRevenue > 0 ? operatingResult / grossRevenue : 0,
      net: grossRevenue > 0 ? netProfit / grossRevenue : 0,
    },
  }
}

/**
 * Ponto de equilíbrio.
 *
 * Quanto precisa entrar para a estrutura se pagar — em reais e em número de
 * atendimentos. É o piso abaixo do qual o mês dá prejuízo.
 */
export interface BreakEven {
  fixedCostsCents: number
  contributionRatio: number
  revenueCents: number
  consultations: number | null
  averageTicketCents: number
}

export async function computeBreakEven(period: Period, regime: Regime = 'cash'): Promise<BreakEven> {
  const revenue = await getRevenue(period, regime)
  const expenses = await getExpenses(period, regime)

  const fixed = (expenses.byKind.fixed_cost ?? 0) + (expenses.byKind.marketing ?? 0)
  const variable = (expenses.byKind.variable_cost ?? 0) + (expenses.byKind.direct_cost ?? 0)
  const netRevenue = revenue.grossCents - revenue.feeCents

  const contributionRatio = netRevenue > 0 ? (netRevenue - variable) / revenue.grossCents : 0
  const breakEvenRevenue = contributionRatio > 0 ? Math.ceil(fixed / contributionRatio) : 0
  const ticket = revenue.averageTicketCents

  return {
    fixedCostsCents: fixed,
    contributionRatio,
    revenueCents: breakEvenRevenue,
    consultations: ticket > 0 ? Math.ceil(breakEvenRevenue / ticket) : null,
    averageTicketCents: ticket,
  }
}
