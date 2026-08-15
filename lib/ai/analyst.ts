import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { aiReports } from '@/lib/db/schema'
import { env } from '@/lib/env'
import { formatBRL, formatPercent } from '@/lib/money'
import { currentMonth, previousMonth, lastNMonths, monthLabel, today, type Period } from '@/lib/dates'
import { getRevenue, getRevenueByMonth, getRevenueByProduct, getRevenueByPlatform } from '@/lib/analytics/queries'
import { buildDre, computeBreakEven } from '@/lib/analytics/dre'
import { computeSplit } from '@/lib/analytics/split'
import { getCashPosition } from '@/lib/analytics/cashflow'
import { getCustomerMetrics, getReactivationList } from '@/lib/analytics/customers'
import { getMeiStatus } from '@/lib/analytics/tax'
import { buildGoalRoadmap } from '@/lib/analytics/goals'
import { getCapacity } from '@/lib/analytics/capacity'
import { getSetting } from '@/lib/settings'

/**
 * Analista financeiro de IA.
 *
 * Recebe um retrato numérico fechado do período e escreve a leitura em
 * português. O snapshot é montado aqui, não pelo modelo — assim o relatório
 * comenta os mesmos números que estão na tela, sem inventar nada.
 */

export interface AnalystSnapshot {
  periodo: string
  faturamento: string
  faturamentoAnterior: string
  receitaLiquida: string
  taxasPagas: string
  ticketMedio: string
  vendas: number
  margemContribuicao: string
  lucroLiquido: string
  margemLiquida: string
  resultadoRetido: string
  custoFixo: string
  marketing: string
  pontoEquilibrio: string
  caixaLivre: string
  runwayMeses: string
  aReceber: string
  contasEmAberto: string
  divisao: { caixa: string; yuri: string; gustavo: string }
  retiradas: { yuri: string; gustavo: string }
  meta: { alvo: string; realizado: string; falta: string; projecao: string; dataProvavel: string }
  historicoMensal: Array<{ mes: string; faturamento: string }>
  produtos: Array<{ nome: string; faturamento: string; vendas: number }>
  plataformas: Array<{ nome: string; faturamento: string }>
  clientes: {
    total: number
    recompra: string
    ltvMedio: string
    concentracaoTop10: string
    intervaloMedianoDias: number | null
    paraReativar: number
    valorParaReativar: string
  }
  agenda: { ocupacao: string; horasAtendidas: string; receitaPorHora: string; horasLivres: string }
  fiscal: { acumuladoAno: string; tetoMei: string; excesso: string; situacao: string }
}

export async function buildSnapshot(period: Period = currentMonth()): Promise<AnalystSnapshot> {
  const prev = previousMonth(period)
  const goal = await getSetting('goal')
  const capacitySetting = await getSetting('capacity')

  const [revenue, prevRevenue, dre, breakEven, split, cash, customers, mei, roadmap, capacity] = await Promise.all([
    getRevenue(period),
    getRevenue(prev),
    buildDre(period),
    computeBreakEven(period),
    computeSplit(period),
    getCashPosition(),
    getCustomerMetrics(),
    getMeiStatus(),
    buildGoalRoadmap(goal.targetCents, goal.deadline, 18),
    getCapacity(period, { weeklyHours: capacitySetting.weeklyHours }),
  ])

  const months = lastNMonths(12)
  const history = await getRevenueByMonth(months[0].start, period.end)
  const products = await getRevenueByProduct(period)
  const platforms = await getRevenueByPlatform(period)
  const reactivation = await getReactivationList(50)

  return {
    periodo: period.label,
    faturamento: formatBRL(revenue.grossCents),
    faturamentoAnterior: formatBRL(prevRevenue.grossCents),
    receitaLiquida: formatBRL(revenue.effectiveNetCents),
    taxasPagas: formatBRL(revenue.feeCents),
    ticketMedio: formatBRL(revenue.averageTicketCents),
    vendas: revenue.count,
    margemContribuicao: formatPercent(dre.margins.contribution),
    lucroLiquido: formatBRL(dre.totals.netProfit),
    margemLiquida: formatPercent(dre.margins.net),
    resultadoRetido: formatBRL(dre.totals.retained),
    custoFixo: formatBRL(dre.totals.fixedCosts),
    marketing: formatBRL(dre.totals.marketing),
    pontoEquilibrio: formatBRL(breakEven.revenueCents),
    caixaLivre: formatBRL(cash.freeCashCents),
    runwayMeses: cash.runwayMonths !== null ? `${cash.runwayMonths}` : 'indefinido',
    aReceber: formatBRL(cash.receivableCents),
    contasEmAberto: formatBRL(cash.payableCents),
    divisao: {
      caixa: formatBRL(split.companyCents),
      yuri: formatBRL(split.yuriCents),
      gustavo: formatBRL(split.gustavoCents),
    },
    retiradas: {
      yuri: formatBRL(split.withdrawals.yuri),
      gustavo: formatBRL(split.withdrawals.gustavo),
    },
    meta: {
      alvo: formatBRL(goal.targetCents),
      realizado: formatBRL(revenue.grossCents),
      falta: formatBRL(Math.max(0, goal.targetCents - revenue.grossCents)),
      projecao: formatBRL(roadmap.forecast.currentLevelCents),
      dataProvavel: roadmap.forecast.targetMonth ? monthLabel(roadmap.forecast.targetMonth) : 'não atingida na projeção',
    },
    historicoMensal: history.map((h) => ({ mes: monthLabel(h.month, true), faturamento: formatBRL(h.grossCents) })),
    produtos: products.slice(0, 8).map((p) => ({ nome: p.label, faturamento: formatBRL(p.grossCents), vendas: p.count })),
    plataformas: platforms.map((p) => ({ nome: p.label, faturamento: formatBRL(p.grossCents) })),
    clientes: {
      total: customers.totalCustomers,
      recompra: formatPercent(customers.repeatRatio),
      ltvMedio: formatBRL(customers.averageLtvCents),
      concentracaoTop10: formatPercent(customers.top10Share),
      intervaloMedianoDias: customers.medianRepurchaseDays,
      paraReativar: reactivation.length,
      valorParaReativar: formatBRL(reactivation.reduce((acc, c) => acc + c.totalNetCents, 0)),
    },
    agenda: {
      ocupacao: formatPercent(capacity.occupancyRatio),
      horasAtendidas: capacity.bookedHours.toFixed(1),
      receitaPorHora: formatBRL(capacity.revenuePerHourCents),
      horasLivres: capacity.remainingHours.toFixed(1),
    },
    fiscal: {
      acumuladoAno: formatBRL(mei.accumulatedCents),
      tetoMei: formatBRL(mei.limitCents),
      excesso: formatBRL(mei.excessCents),
      situacao: mei.message,
    },
  }
}

const SYSTEM_PROMPT = `Você é o analista financeiro da operação digital do astrólogo Yuri dos Anjos, em sociedade com Gustavo (co-produtor e marketeiro).

Contexto fixo do negócio:
- Receita vem majoritariamente de consultas (serviço, entregue pelo Yuri) e, em menor parte, de infoprodutos.
- A divisão vigente é: 10% do líquido para o caixa da empresa; do que sobra, 80% para o Yuri e 20% para o Gustavo. Os percentuais mudam com o tempo e por tipo de produto.
- O Yuri precisa de cerca de R$ 8.000 por mês para viver.
- A meta declarada é R$ 30.000 por mês de forma recorrente até janeiro de 2027. Nesse patamar a empresa consegue reter 50-60% em caixa.
- Hoje a empresa ainda é MEI, com faturamento acima do teto, e a migração para CNPJ está prevista para os próximos meses.

Como escrever:
- Português do Brasil, direto, sem jargão de consultoria e sem elogio vazio.
- Comente apenas números que estão no retrato recebido. Nunca invente dado nem estime o que não foi informado.
- Priorize o que muda decisão nas próximas semanas. Se algo está sangrando, diga em números.
- Seja específico: "subir o ticket da consulta de retorno em R$ 50 fecha metade do gap" vale mais que "aumentar o ticket".
- Reconheça a restrição real: eles não têm folga de caixa para apostas longas. Recomende movimentos que cabem no caixa atual.
- Não moralize sobre a divisão de lucros nem sobre o MEI. Eles têm consciência disso; trate como restrição do problema.

Estrutura do relatório, em markdown:
## O que aconteceu
## O que está funcionando
## O que está drenando resultado
## A corrida até os 30k
## O que fazer neste mês
(3 a 5 ações concretas, ordenadas por impacto, cada uma com o número que ela move)`

export async function generateReport(
  kind: 'monthly' | 'weekly' | 'ad_hoc',
  period: Period = currentMonth(),
): Promise<{ content: string; model: string }> {
  if (!env.anthropic.configured) {
    throw new Error('ANTHROPIC_API_KEY não configurada — a análise de IA precisa da chave.')
  }

  const snapshot = await buildSnapshot(period)
  const client = new Anthropic({ apiKey: env.anthropic.apiKey })

  const horizon =
    kind === 'weekly'
      ? 'Este é o resumo da semana. Seja curto: no máximo 400 palavras, foco no que mudou e no que fazer nos próximos 7 dias.'
      : 'Esta é a análise de fechamento do mês. Pode se estender até 900 palavras.'

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    messages: [
      {
        role: 'user',
        content: `${horizon}\n\nRetrato numérico do período (${snapshot.periodo}):\n\n\`\`\`json\n${JSON.stringify(snapshot, null, 2)}\n\`\`\``,
      },
    ],
  })

  const content = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()

  if (!content) throw new Error('O analista não retornou texto — verifique a chave e o limite de uso.')

  await db.insert(aiReports).values({
    kind,
    periodStart: period.start,
    periodEnd: period.end,
    content,
    model: response.model,
    inputSnapshot: snapshot as unknown as object,
  })

  return { content, model: response.model }
}

/** Resumo curto para o e-mail semanal, sem depender de IA. */
export async function buildWeeklyDigest(): Promise<string> {
  const month = currentMonth()
  const snapshot = await buildSnapshot(month)

  return [
    `Financeiro — ${snapshot.periodo} (até ${today()})`,
    '',
    `Faturamento no mês: ${snapshot.faturamento} (mês anterior: ${snapshot.faturamentoAnterior})`,
    `Meta: ${snapshot.meta.alvo} · faltam ${snapshot.meta.falta}`,
    `Lucro líquido: ${snapshot.lucroLiquido} (margem ${snapshot.margemLiquida})`,
    `Caixa livre: ${snapshot.caixaLivre} · a receber ${snapshot.aReceber} · contas em aberto ${snapshot.contasEmAberto}`,
    '',
    `Divisão do mês — caixa ${snapshot.divisao.caixa} · Yuri ${snapshot.divisao.yuri} · Gustavo ${snapshot.divisao.gustavo}`,
    `Retiradas — Yuri ${snapshot.retiradas.yuri} · Gustavo ${snapshot.retiradas.gustavo}`,
    '',
    `Clientes para retomar: ${snapshot.clientes.paraReativar} (${snapshot.clientes.valorParaReativar} já gastos por eles)`,
    `Ocupação da agenda: ${snapshot.agenda.ocupacao} · receita por hora ${snapshot.agenda.receitaPorHora}`,
    '',
    `Fiscal: ${snapshot.fiscal.situacao}`,
  ].join('\n')
}
