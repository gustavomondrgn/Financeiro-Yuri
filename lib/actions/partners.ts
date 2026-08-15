'use server'

import { revalidatePath } from 'next/cache'
import { eq, and, isNull, lte } from 'drizzle-orm'
import { db } from '@/lib/db'
import { partnerRules, auditLog } from '@/lib/db/schema'
import { requireSession } from '@/lib/auth'
import { addDays } from '@/lib/dates'
import { setSetting } from '@/lib/settings'
import { parseBRLToCents } from '@/lib/money'

/**
 * Regras de divisão.
 *
 * Criar uma regra nova **fecha** a anterior no dia anterior à nova vigência,
 * em vez de editá-la. É o que garante que o histórico de meses já fechados
 * nunca mude quando o percentual do Gustavo subir.
 */

export async function createPartnerRule(formData: FormData) {
  const user = await requireSession()

  const name = String(formData.get('name') ?? '').trim() || 'Nova regra'
  const effectiveFrom = String(formData.get('effectiveFrom') ?? '')
  const productType = String(formData.get('productType') ?? '')
  const companyPct = Number(String(formData.get('companyPct') ?? '0').replace(',', '.'))
  const yuriPct = Number(String(formData.get('yuriPct') ?? '0').replace(',', '.'))
  const gustavoPct = Number(String(formData.get('gustavoPct') ?? '0').replace(',', '.'))
  const notes = String(formData.get('notes') ?? '').trim() || null

  if (!effectiveFrom) return
  // Yuri + Gustavo dividem o que sobra depois do caixa: precisam somar 100.
  if (Math.abs(yuriPct + gustavoPct - 100) > 0.01) return

  const typeValue = productType === '' ? null : (productType as 'service' | 'infoproduct' | 'other')

  // Fecha a regra vigente do mesmo escopo.
  const open = await db
    .select()
    .from(partnerRules)
    .where(and(isNull(partnerRules.effectiveTo), lte(partnerRules.effectiveFrom, effectiveFrom)))

  for (const rule of open) {
    const sameScope = (rule.productType ?? null) === typeValue
    if (!sameScope) continue
    await db
      .update(partnerRules)
      .set({ effectiveTo: addDays(effectiveFrom, -1) })
      .where(eq(partnerRules.id, rule.id))
  }

  const [created] = await db
    .insert(partnerRules)
    .values({
      name,
      effectiveFrom,
      productType: typeValue,
      companyPct: companyPct.toFixed(2),
      yuriPct: yuriPct.toFixed(2),
      gustavoPct: gustavoPct.toFixed(2),
      basis: 'net',
      notes,
    })
    .returning({ id: partnerRules.id })

  await db.insert(auditLog).values({
    userId: user.id,
    action: 'create',
    entity: 'partner_rule',
    entityId: String(created.id),
    after: { effectiveFrom, companyPct, yuriPct, gustavoPct, productType: typeValue },
  })

  revalidatePath('/socios')
  revalidatePath('/dre')
  revalidatePath('/')
}

export async function updatePartnerFloor(formData: FormData) {
  await requireSession()
  const yuriCents = parseBRLToCents(String(formData.get('yuri') ?? ''))
  const gustavoCents = parseBRLToCents(String(formData.get('gustavo') ?? ''))

  await setSetting('partner_floor', { yuriCents, gustavoCents })

  revalidatePath('/socios')
  revalidatePath('/')
}
