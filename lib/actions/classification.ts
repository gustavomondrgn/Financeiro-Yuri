'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { transactions, classificationRules, auditLog, products } from '@/lib/db/schema'
import { requireSession } from '@/lib/auth'
import { invalidateRulesCache, reclassifyPending } from '@/lib/ingest/classify'
import { refreshCustomerAggregates } from '@/lib/ingest/customers'

/**
 * Classificação manual.
 *
 * Além de resolver a transação da vez, o usuário pode transformar a decisão
 * em regra — é isso que faz a fila encolher sozinha em vez de virar trabalho
 * eterno a cada importação.
 */

export async function classifyTransaction(formData: FormData) {
  const user = await requireSession()

  const transactionId = Number(formData.get('transactionId'))
  const productId = formData.get('productId') ? Number(formData.get('productId')) : null
  const kind = String(formData.get('kind') ?? 'sale')
  const origin = String(formData.get('origin') ?? '').trim() || null
  const createRule = formData.get('createRule') === 'on'

  const [current] = await db.select().from(transactions).where(eq(transactions.id, transactionId)).limit(1)
  if (!current) return

  await db
    .update(transactions)
    .set({
      productId,
      kind: kind as typeof current.kind,
      origin,
      needsReview: false,
      classifiedBy: 'manual',
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, transactionId))

  await db.insert(auditLog).values({
    userId: user.id,
    action: 'classify',
    entity: 'transaction',
    entityId: String(transactionId),
    before: { productId: current.productId, kind: current.kind },
    after: { productId, kind },
  })

  if (createRule && productId) {
    const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1)
    const pattern = (current.description ?? '').trim()

    // Sem texto para casar, a regra vira faixa de valor exata — que é
    // justamente como uma consulta de preço fixo se identifica.
    await db.insert(classificationRules).values({
      name: `Auto: ${product?.name ?? 'produto'}${pattern ? ` · "${pattern.slice(0, 40)}"` : ` · R$ ${current.grossCents / 100}`}`,
      priority: pattern ? 50 : 80,
      platform: current.platform,
      matchField: pattern ? 'description' : 'any',
      matchType: 'contains',
      pattern: pattern || null,
      minCents: pattern ? null : current.grossCents,
      maxCents: pattern ? null : current.grossCents,
      productId,
      kind: kind as typeof current.kind,
    })

    invalidateRulesCache()
    await reclassifyPending()
  }

  await refreshCustomerAggregates()
  revalidatePath('/receitas/classificar')
  revalidatePath('/receitas')
  revalidatePath('/')
}

/** Aplica o mesmo produto a várias transações de uma vez. */
export async function bulkClassify(formData: FormData) {
  const user = await requireSession()
  const productId = formData.get('productId') ? Number(formData.get('productId')) : null
  const ids = formData.getAll('ids').map(Number).filter(Boolean)

  if (!productId || ids.length === 0) return

  for (const id of ids) {
    await db
      .update(transactions)
      .set({ productId, needsReview: false, classifiedBy: 'manual', updatedAt: new Date() })
      .where(eq(transactions.id, id))
  }

  await db.insert(auditLog).values({
    userId: user.id,
    action: 'bulk_classify',
    entity: 'transaction',
    entityId: ids.join(','),
    after: { productId, count: ids.length },
  })

  await refreshCustomerAggregates()
  revalidatePath('/receitas/classificar')
  revalidatePath('/receitas')
}

export async function reapplyRules() {
  await requireSession()
  const updated = await reclassifyPending()
  await refreshCustomerAggregates()
  revalidatePath('/receitas/classificar')
  return updated
}
