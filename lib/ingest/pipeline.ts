import { inArray, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { rawEvents, transactions, jobRuns, accounts } from '@/lib/db/schema'
import { assignHashes } from './dedupe'
import { classify, bumpRuleHits } from './classify'
import { findOrCreateCustomer } from './customers'
import { emptyResult, type IngestResult, type NormalizedTx } from './types'

/**
 * Pipeline único de ingestão.
 *
 * Todo dinheiro que entra no sistema — webhook, API, CSV, e-mail, robô —
 * passa por aqui. Guarda o payload cru, deduplica, classifica e só então
 * grava a transação. Trocar a fonte não muda nada a jusante.
 */

export interface IngestOptions {
  /** Identificador do lote (nome do arquivo, id do webhook, janela do sync). */
  batchRef?: string
  /** Conta padrão quando o adaptador não sabe dizer. */
  defaultAccountId?: number | null
  /** Não grava — só relata o que aconteceria. Usado no preview de importação. */
  dryRun?: boolean
}

export async function ingestBatch(
  items: NormalizedTx[],
  options: IngestOptions = {},
): Promise<IngestResult> {
  const result = emptyResult()
  if (items.length === 0) return result

  const hashed = assignHashes(items)
  const hashes = hashed.map((h) => h.hash)

  // Uma consulta só descobre tudo que já existe — importar 3 anos de
  // extrato não pode virar milhares de idas ao banco.
  const existing = new Set<string>()
  const CHUNK = 500
  for (let i = 0; i < hashes.length; i += CHUNK) {
    const slice = hashes.slice(i, i + CHUNK)
    const found = await db
      .select({ hash: transactions.dedupeHash })
      .from(transactions)
      .where(inArray(transactions.dedupeHash, slice))
    for (const row of found) existing.add(row.hash)
  }

  const ruleHits: number[] = []
  const seenInBatch = new Set<string>()

  for (const { tx, hash } of hashed) {
    result.processed += 1

    if (existing.has(hash) || seenInBatch.has(hash)) {
      result.duplicated += 1
      continue
    }
    seenInBatch.add(hash)

    if (options.dryRun) {
      result.created += 1
      continue
    }

    try {
      const [event] = await db
        .insert(rawEvents)
        .values({
          platform: tx.platform,
          source: tx.source,
          externalId: tx.externalId ?? null,
          payload: (tx.raw ?? {}) as object,
          batchRef: options.batchRef ?? null,
          processedAt: new Date(),
        })
        .returning({ id: rawEvents.id })

      const outcome = await classify(tx)
      if (outcome.ruleId) ruleHits.push(outcome.ruleId)

      const customerId = tx.kind === 'sale' ? await findOrCreateCustomer(tx) : null

      await db.insert(transactions).values({
        accountId: tx.accountId ?? options.defaultAccountId ?? null,
        platform: tx.platform,
        source: tx.source,
        externalId: tx.externalId ?? null,
        dedupeHash: hash,
        kind: outcome.kind ?? tx.kind,
        status: tx.status,
        method: tx.method ?? null,
        installments: tx.installments ?? 1,
        grossCents: tx.grossCents,
        feeCents: tx.feeCents,
        netCents: tx.netCents,
        saleDate: tx.saleDate,
        receiptDate: tx.receiptDate ?? null,
        description: tx.description ?? null,
        counterpartyName: tx.counterpartyName ?? null,
        counterpartyEmail: tx.counterpartyEmail ?? null,
        counterpartyPhone: tx.counterpartyPhone ?? null,
        counterpartyDocument: tx.counterpartyDocument ?? null,
        customerId,
        productId: outcome.productId,
        origin: outcome.origin,
        classifiedBy: outcome.ruleId ? 'rule' : null,
        classificationRuleId: outcome.ruleId,
        needsReview: outcome.needsReview,
        rawEventId: event.id,
      })

      result.created += 1
      if (outcome.needsReview) result.needsReview += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Índice único é corrida entre importações simultâneas, não erro real.
      if (message.includes('transactions_dedupe_idx') || message.includes('duplicate key')) {
        result.duplicated += 1
      } else {
        result.errors.push(`${tx.saleDate} ${tx.description ?? ''}: ${message}`)
      }
    }
  }

  if (ruleHits.length > 0 && !options.dryRun) await bumpRuleHits(ruleHits)

  return result
}

/** Envelope de execução: registra início, fim e resultado em job_runs. */
export async function runJob<T extends IngestResult>(
  jobName: string,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  const [run] = await db
    .insert(jobRuns)
    .values({ job: jobName, status: 'running', meta: meta ?? {} })
    .returning({ id: jobRuns.id })

  try {
    const result = await fn()
    await db
      .update(jobRuns)
      .set({
        status: result.errors.length > 0 ? 'error' : 'success',
        finishedAt: new Date(),
        itemsProcessed: result.processed,
        itemsCreated: result.created,
        itemsDuplicated: result.duplicated,
        error: result.errors.length > 0 ? result.errors.slice(0, 20).join('\n') : null,
      })
      .where(eq(jobRuns.id, run.id))
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db
      .update(jobRuns)
      .set({ status: 'error', finishedAt: new Date(), error: message })
      .where(eq(jobRuns.id, run.id))
    throw error
  }
}

/** Conta padrão da plataforma, criada sob demanda no primeiro uso. */
export async function resolveAccount(
  platform: NormalizedTx['platform'],
  name: string,
): Promise<number> {
  const [found] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.platform, platform))
    .limit(1)
  if (found) return found.id

  const [created] = await db
    .insert(accounts)
    .values({ name, platform, kind: platform === 'inter' ? 'bank' : 'operating' })
    .returning({ id: accounts.id })
  return created.id
}
