import { and, eq, asc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { classificationRules, type ClassificationRule } from '@/lib/db/schema'
import { normalizeText } from './dedupe'
import type { NormalizedTx } from './types'

/**
 * Motor de classificação por regras.
 *
 * Uma transação de link de pagamento da InfinitePay chega só com valor,
 * data e nome do pagador. Quem transforma isso em "consulta de mapa astral"
 * é este arquivo: casa padrão de texto e/ou faixa de valor com um produto.
 *
 * O que não casar com nada não é chutado — vai para a fila de revisão.
 * Chute silencioso em dado financeiro é pior que campo vazio.
 */

export interface ClassificationOutcome {
  productId: number | null
  kind: NormalizedTx['kind'] | null
  origin: string | null
  ruleId: number | null
  needsReview: boolean
}

let cache: { rules: ClassificationRule[]; loadedAt: number } | null = null
const CACHE_TTL_MS = 30_000

export async function loadRules(force = false): Promise<ClassificationRule[]> {
  if (!force && cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.rules
  const rules = await db
    .select()
    .from(classificationRules)
    .where(eq(classificationRules.active, true))
    .orderBy(asc(classificationRules.priority), asc(classificationRules.id))
  cache = { rules, loadedAt: Date.now() }
  return rules
}

export function invalidateRulesCache(): void {
  cache = null
}

export function matchRule(tx: NormalizedTx, rule: ClassificationRule): boolean {
  if (rule.platform && rule.platform !== tx.platform) return false
  if (rule.method && rule.method !== tx.method) return false

  const amount = Math.abs(tx.grossCents)
  if (rule.minCents !== null && amount < rule.minCents) return false
  if (rule.maxCents !== null && amount > rule.maxCents) return false

  if (rule.pattern) {
    const haystack = normalizeText(
      rule.matchField === 'description'
        ? [tx.description, tx.productHint].filter(Boolean).join(' ')
        : rule.matchField === 'counterparty'
          ? (tx.counterpartyName ?? '')
          : [tx.description, tx.productHint, tx.counterpartyName].filter(Boolean).join(' '),
    )

    if (!haystack) return false

    if (rule.matchType === 'regex') {
      try {
        if (!new RegExp(rule.pattern, 'i').test(haystack)) return false
      } catch {
        // Regex inválida numa regra não pode derrubar a importação inteira.
        return false
      }
    } else if (rule.matchType === 'equals') {
      if (haystack !== normalizeText(rule.pattern)) return false
    } else if (!haystack.includes(normalizeText(rule.pattern))) {
      return false
    }
  }

  // Regra sem nenhum critério casaria com tudo — provavelmente engano.
  if (!rule.pattern && rule.minCents === null && rule.maxCents === null && !rule.method) {
    return false
  }

  return true
}

export async function classify(tx: NormalizedTx): Promise<ClassificationOutcome> {
  // Movimentações que não são venda não precisam de produto.
  if (tx.kind !== 'sale') {
    return { productId: null, kind: tx.kind, origin: tx.origin ?? null, ruleId: null, needsReview: false }
  }

  const rules = await loadRules()
  for (const rule of rules) {
    if (matchRule(tx, rule)) {
      return {
        productId: rule.productId,
        kind: rule.kind ?? tx.kind,
        origin: rule.origin ?? tx.origin ?? null,
        ruleId: rule.id,
        needsReview: false,
      }
    }
  }

  return {
    productId: null,
    kind: tx.kind,
    origin: tx.origin ?? null,
    ruleId: null,
    needsReview: true,
  }
}

/** Incrementa o contador de acertos das regras usadas no lote. */
export async function bumpRuleHits(ruleIds: number[]): Promise<void> {
  const counts = new Map<number, number>()
  for (const id of ruleIds) counts.set(id, (counts.get(id) ?? 0) + 1)

  for (const [id, count] of counts) {
    const [rule] = await db
      .select({ hitCount: classificationRules.hitCount })
      .from(classificationRules)
      .where(eq(classificationRules.id, id))
      .limit(1)
    if (!rule) continue
    await db
      .update(classificationRules)
      .set({ hitCount: rule.hitCount + count })
      .where(eq(classificationRules.id, id))
  }
}

/**
 * Reaplica as regras às transações pendentes de revisão.
 * Usado depois de criar uma regra a partir de uma classificação manual —
 * a regra nova limpa o passivo de uma vez.
 */
export async function reclassifyPending(): Promise<number> {
  invalidateRulesCache()
  const { transactions } = await import('@/lib/db/schema')
  const pending = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.needsReview, true), eq(transactions.kind, 'sale')))

  let updated = 0
  for (const row of pending) {
    const outcome = await classify({
      platform: row.platform,
      source: row.source,
      kind: row.kind,
      status: row.status,
      method: row.method,
      grossCents: row.grossCents,
      feeCents: row.feeCents,
      netCents: row.netCents,
      saleDate: row.saleDate,
      description: row.description,
      counterpartyName: row.counterpartyName,
      productHint: row.description,
      raw: null,
    })

    if (outcome.productId) {
      await db
        .update(transactions)
        .set({
          productId: outcome.productId,
          classificationRuleId: outcome.ruleId,
          classifiedBy: 'rule',
          needsReview: false,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, row.id))
      updated += 1
    }
  }
  return updated
}
