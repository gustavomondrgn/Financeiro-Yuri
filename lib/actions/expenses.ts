'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { expenses, auditLog, partnerWithdrawals, taxProvisions } from '@/lib/db/schema'
import { requireSession } from '@/lib/auth'
import { parseBRLToCents } from '@/lib/money'
import { today, addMonths, parseIso, isoFrom } from '@/lib/dates'

/**
 * Lançamentos de saída: despesas, contas a pagar, retiradas e impostos.
 *
 * Recorrência é materializada em ocorrências reais (uma linha por mês) em
 * vez de calculada na leitura — assim uma assinatura que muda de valor no
 * meio do ano não reescreve o histórico.
 */

const RECURRENCE_STEPS: Record<string, number> = {
  weekly: 0,
  monthly: 1,
  quarterly: 3,
  yearly: 12,
}

export async function createExpense(formData: FormData) {
  const user = await requireSession()

  const description = String(formData.get('description') ?? '').trim()
  const amountCents = parseBRLToCents(String(formData.get('amount') ?? ''))
  const categoryId = formData.get('categoryId') ? Number(formData.get('categoryId')) : null
  const kind = String(formData.get('kind') ?? 'fixed_cost')
  const competenceDate = String(formData.get('competenceDate') ?? today())
  const dueDate = String(formData.get('dueDate') ?? '') || null
  const paid = formData.get('paid') === 'on'
  const recurrence = String(formData.get('recurrence') ?? 'none')
  const months = Number(formData.get('recurrenceMonths') ?? 12)
  const supplier = String(formData.get('supplier') ?? '').trim() || null
  const channel = String(formData.get('channel') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null

  if (!description || amountCents <= 0) return

  const base = {
    description,
    categoryId,
    kind: kind as 'fixed_cost',
    amountCents,
    supplier,
    channel,
    notes,
    createdBy: user.id,
  }

  const [created] = await db
    .insert(expenses)
    .values({
      ...base,
      competenceDate,
      dueDate,
      paidDate: paid ? (dueDate ?? competenceDate) : null,
      status: paid ? 'paid' : 'pending',
      recurrence: recurrence as 'none',
    })
    .returning({ id: expenses.id })

  // Gera as ocorrências futuras da recorrência.
  const step = RECURRENCE_STEPS[recurrence]
  if (step && months > 1) {
    const { y, m, d } = parseIso(competenceDate)
    const rows = []
    for (let i = 1; i < months; i++) {
      const next = addMonths(y, m, step * i)
      const nextCompetence = isoFrom(next.y, next.m, Math.min(d, 28))
      const nextDue = dueDate ? isoFrom(next.y, next.m, Math.min(Number(dueDate.slice(8, 10)), 28)) : null
      rows.push({
        ...base,
        competenceDate: nextCompetence,
        dueDate: nextDue,
        status: 'pending' as const,
        recurrence: recurrence as 'none',
        recurrenceParentId: created.id,
      })
    }
    if (rows.length > 0) await db.insert(expenses).values(rows)
  }

  await db.insert(auditLog).values({
    userId: user.id,
    action: 'create',
    entity: 'expense',
    entityId: String(created.id),
    after: { description, amountCents, kind },
  })

  revalidatePath('/despesas')
  revalidatePath('/dre')
  revalidatePath('/')
}

export async function markExpensePaid(formData: FormData) {
  const user = await requireSession()
  const id = Number(formData.get('id'))
  const date = String(formData.get('paidDate') ?? today())

  await db.update(expenses).set({ status: 'paid', paidDate: date, updatedAt: new Date() }).where(eq(expenses.id, id))

  await db.insert(auditLog).values({
    userId: user.id,
    action: 'pay',
    entity: 'expense',
    entityId: String(id),
    after: { paidDate: date },
  })

  revalidatePath('/despesas')
  revalidatePath('/')
}

export async function deleteExpense(formData: FormData) {
  const user = await requireSession()
  const id = Number(formData.get('id'))

  const [current] = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1)
  await db.delete(expenses).where(eq(expenses.id, id))

  await db.insert(auditLog).values({
    userId: user.id,
    action: 'delete',
    entity: 'expense',
    entityId: String(id),
    before: current ? { description: current.description, amountCents: current.amountCents } : null,
  })

  revalidatePath('/despesas')
  revalidatePath('/dre')
}

export async function createWithdrawal(formData: FormData) {
  const user = await requireSession()

  const partner = String(formData.get('partner') ?? 'yuri') as 'yuri' | 'gustavo' | 'company'
  const amountCents = parseBRLToCents(String(formData.get('amount') ?? ''))
  const date = String(formData.get('date') ?? today())
  const notes = String(formData.get('notes') ?? '').trim() || null

  if (amountCents <= 0) return

  await db.insert(partnerWithdrawals).values({ partner, amountCents, date, notes, createdBy: user.id })

  await db.insert(auditLog).values({
    userId: user.id,
    action: 'create',
    entity: 'withdrawal',
    after: { partner, amountCents, date },
  })

  revalidatePath('/socios')
  revalidatePath('/')
}

export async function deleteWithdrawal(formData: FormData) {
  await requireSession()
  const id = Number(formData.get('id'))
  await db.delete(partnerWithdrawals).where(eq(partnerWithdrawals.id, id))
  revalidatePath('/socios')
}

export async function createTaxProvision(formData: FormData) {
  await requireSession()

  const referenceMonth = String(formData.get('referenceMonth') ?? today().slice(0, 8) + '01')
  const label = String(formData.get('label') ?? 'Provisão de imposto')
  const baseCents = parseBRLToCents(String(formData.get('base') ?? ''))
  const ratePct = Number(String(formData.get('rate') ?? '6').replace(',', '.'))
  const amountCents = Math.round((baseCents * ratePct) / 100)

  await db.insert(taxProvisions).values({
    referenceMonth,
    label,
    baseCents,
    ratePct: ratePct.toFixed(2),
    amountCents,
  })

  revalidatePath('/fiscal')
  revalidatePath('/')
}

export async function markTaxPaid(formData: FormData) {
  await requireSession()
  const id = Number(formData.get('id'))
  await db
    .update(taxProvisions)
    .set({ status: 'paid', paidDate: today() })
    .where(eq(taxProvisions.id, id))
  revalidatePath('/fiscal')
}
