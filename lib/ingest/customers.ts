import { eq, or, and, sql as raw } from 'drizzle-orm'
import { db } from '@/lib/db'
import { customers, transactions } from '@/lib/db/schema'
import { normalizeText } from './dedupe'
import type { NormalizedTx } from './types'

/**
 * Unificação de identidade do cliente.
 *
 * O mesmo cliente aparece como "Maria S. Souza" no link da InfinitePay,
 * "maria@gmail.com" na Kiwify e "(11) 99999-9999" na Cakto. Sem unificar,
 * LTV e taxa de recompra viram ficção.
 *
 * Ordem de confiança: documento > e-mail > telefone > nome normalizado.
 */

export function normalizePhone(phone?: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 10) return null
  // Guarda os últimos 11 dígitos (DDD + número), ignorando +55.
  return digits.slice(-11)
}

export function normalizeEmail(email?: string | null): string | null {
  if (!email) return null
  const clean = email.trim().toLowerCase()
  return clean.includes('@') ? clean : null
}

export function normalizeDocument(doc?: string | null): string | null {
  if (!doc) return null
  const digits = doc.replace(/\D/g, '')
  return digits.length === 11 || digits.length === 14 ? digits : null
}

export async function findOrCreateCustomer(tx: NormalizedTx): Promise<number | null> {
  const name = (tx.counterpartyName ?? '').trim()
  const email = normalizeEmail(tx.counterpartyEmail)
  const phone = normalizePhone(tx.counterpartyPhone)
  const document = normalizeDocument(tx.counterpartyDocument)
  const normalizedName = normalizeText(name)

  // Sem nenhum identificador não há cliente a criar — é uma taxa, uma
  // transferência ou uma linha de extrato sem contraparte.
  if (!email && !phone && !document && normalizedName.length < 3) return null

  const conditions = []
  if (document) conditions.push(eq(customers.document, document))
  if (email) conditions.push(eq(customers.email, email))
  if (phone) conditions.push(eq(customers.phone, phone))

  if (conditions.length > 0) {
    const [found] = await db
      .select()
      .from(customers)
      .where(or(...conditions))
      .limit(1)
    if (found) {
      await enrich(found.id, { name, email, phone, document })
      return found.id
    }
  }

  // Nome sozinho só unifica quando é razoavelmente distintivo.
  if (normalizedName.length >= 6) {
    const [found] = await db
      .select()
      .from(customers)
      .where(eq(customers.normalizedName, normalizedName))
      .limit(1)
    if (found) {
      await enrich(found.id, { name, email, phone, document })
      return found.id
    }
  }

  if (!name) return null

  const [created] = await db
    .insert(customers)
    .values({ name, normalizedName, email, phone, document })
    .returning({ id: customers.id })

  return created.id
}

async function enrich(
  customerId: number,
  data: { name: string; email: string | null; phone: string | null; document: string | null },
): Promise<void> {
  const [current] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1)
  if (!current) return

  const patch: Partial<typeof customers.$inferInsert> = {}
  if (!current.email && data.email) patch.email = data.email
  if (!current.phone && data.phone) patch.phone = data.phone
  if (!current.document && data.document) patch.document = data.document
  // Nome mais completo ganha do abreviado.
  if (data.name && data.name.length > current.name.length) {
    patch.name = data.name
    patch.normalizedName = normalizeText(data.name)
  }

  if (Object.keys(patch).length > 0) {
    await db.update(customers).set(patch).where(eq(customers.id, customerId))
  }
}

/** Recalcula agregados (compras, LTV, primeira/última compra) de todos os clientes. */
export async function refreshCustomerAggregates(): Promise<number> {
  const rows = await db
    .select({
      customerId: transactions.customerId,
      count: raw<number>`count(*)::int`,
      total: raw<number>`coalesce(sum(${transactions.netCents}), 0)::int`,
      first: raw<string>`min(${transactions.saleDate})`,
      last: raw<string>`max(${transactions.saleDate})`,
    })
    .from(transactions)
    .where(and(eq(transactions.kind, 'sale'), eq(transactions.status, 'approved')))
    .groupBy(transactions.customerId)

  let updated = 0
  for (const row of rows) {
    if (!row.customerId) continue
    await db
      .update(customers)
      .set({
        purchaseCount: row.count,
        totalNetCents: row.total,
        firstPurchaseAt: row.first,
        lastPurchaseAt: row.last,
      })
      .where(eq(customers.id, row.customerId))
    updated += 1
  }
  return updated
}
