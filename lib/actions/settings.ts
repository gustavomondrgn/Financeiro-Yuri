'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { products, accounts, users, auditLog, timelineMarkers } from '@/lib/db/schema'
import { requireSession, hashPassword, verifyPassword } from '@/lib/auth'
import { setSetting } from '@/lib/settings'
import { parseBRLToCents } from '@/lib/money'
import { today } from '@/lib/dates'

/** Cadastros e preferências operacionais. */

export async function saveProduct(formData: FormData) {
  await requireSession()

  const id = formData.get('id') ? Number(formData.get('id')) : null
  const name = String(formData.get('name') ?? '').trim()
  const type = String(formData.get('type') ?? 'service') as 'service' | 'infoproduct' | 'other'
  const priceCents = parseBRLToCents(String(formData.get('price') ?? ''))
  const durationMinutes = formData.get('duration') ? Number(formData.get('duration')) : null
  const unitCostCents = parseBRLToCents(String(formData.get('unitCost') ?? ''))
  const active = formData.get('active') !== null

  if (!name) return

  if (id) {
    await db
      .update(products)
      .set({
        name,
        type,
        defaultPriceCents: priceCents || null,
        durationMinutes,
        unitCostCents,
        active,
      })
      .where(eq(products.id, id))
  } else {
    await db.insert(products).values({
      name,
      type,
      defaultPriceCents: priceCents || null,
      durationMinutes,
      unitCostCents,
    })
  }

  revalidatePath('/configuracoes')
  revalidatePath('/receitas')
}

export async function saveCapacity(formData: FormData) {
  await requireSession()
  await setSetting('capacity', {
    weeklyHours: Number(formData.get('weeklyHours') ?? 25),
    averageSessionMinutes: Number(formData.get('averageSessionMinutes') ?? 70),
  })
  revalidatePath('/configuracoes')
  revalidatePath('/capacidade')
}

export async function saveGoal(formData: FormData) {
  await requireSession()
  await setSetting('goal', {
    targetCents: parseBRLToCents(String(formData.get('target') ?? '')),
    deadline: String(formData.get('deadline') ?? '2027-01-31'),
  })
  revalidatePath('/configuracoes')
  revalidatePath('/metas')
  revalidatePath('/')
}

export async function saveTaxSetting(formData: FormData) {
  await requireSession()
  await setSetting('tax', {
    meiMonthlyDasCents: parseBRLToCents(String(formData.get('das') ?? '')),
    provisionRate: Number(String(formData.get('rate') ?? '6').replace(',', '.')),
  })
  revalidatePath('/configuracoes')
  revalidatePath('/fiscal')
}

export async function saveAccountBalance(formData: FormData) {
  const user = await requireSession()
  const id = Number(formData.get('id'))
  const balanceCents = parseBRLToCents(String(formData.get('balance') ?? ''))

  await db
    .update(accounts)
    .set({ balanceCents, balanceUpdatedAt: new Date() })
    .where(eq(accounts.id, id))

  await db.insert(auditLog).values({
    userId: user.id,
    action: 'update_balance',
    entity: 'account',
    entityId: String(id),
    after: { balanceCents },
  })

  revalidatePath('/configuracoes')
  revalidatePath('/')
}

export async function createAccount(formData: FormData) {
  await requireSession()
  const name = String(formData.get('name') ?? '').trim()
  const platform = String(formData.get('platform') ?? 'manual') as 'infinitepay' | 'inter' | 'manual'
  const kind = String(formData.get('kind') ?? 'operating') as 'operating' | 'reserve' | 'bank'

  if (!name) return

  await db.insert(accounts).values({ name, platform, kind })
  revalidatePath('/configuracoes')
}

export async function changePassword(formData: FormData) {
  const session = await requireSession()
  const current = String(formData.get('current') ?? '')
  const next = String(formData.get('next') ?? '')

  if (next.length < 10) return

  const [record] = await db.select().from(users).where(eq(users.id, session.id)).limit(1)
  if (!record) return

  const valid = await verifyPassword(current, record.passwordHash)
  if (!valid) return

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(users.id, session.id))

  revalidatePath('/configuracoes')
}

export async function createMarker(formData: FormData) {
  await requireSession()

  const title = String(formData.get('title') ?? '').trim()
  const type = String(formData.get('type') ?? 'campaign') as 'campaign' | 'launch' | 'appearance' | 'seasonal' | 'other'
  const startDate = String(formData.get('startDate') ?? today())
  const endDate = String(formData.get('endDate') ?? '') || null
  const description = String(formData.get('description') ?? '').trim() || null

  if (!title) return

  await db.insert(timelineMarkers).values({ title, type, startDate, endDate, description })
  revalidatePath('/configuracoes')
  revalidatePath('/')
}
