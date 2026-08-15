import { createHash } from 'node:crypto'
import { normalizeText } from '@/lib/text'
import type { NormalizedTx } from './types'

export { normalizeText }

/**
 * Chave de deduplicação.
 *
 * Com id da origem, o hash é dele — simples e à prova de reimportação.
 * Sem id (linhas de CSV da InfinitePay), monta-se uma chave natural com
 * data, valor, contraparte e método.
 *
 * O `occurrence` resolve o caso real de duas consultas idênticas no mesmo
 * dia pelo mesmo preço: elas recebem índices 0 e 1 de forma determinística,
 * então continuam sendo duas — e reimportar o mesmo arquivo continua não
 * duplicando nada.
 */
export function dedupeHash(tx: NormalizedTx, occurrence = 0): string {
  const parts = tx.externalId
    ? ['id', tx.platform, tx.externalId]
    : [
        'nat',
        tx.platform,
        tx.saleDate,
        String(tx.grossCents),
        String(tx.netCents),
        tx.method ?? '',
        normalizeText(tx.counterpartyName ?? ''),
        normalizeText(tx.description ?? '').slice(0, 60),
        tx.kind,
        String(occurrence),
      ]

  return createHash('sha256').update(parts.join('|')).digest('hex')
}

/** Chave natural sem o índice, usada para contar ocorrências dentro do lote. */
export function naturalKey(tx: NormalizedTx): string {
  return [
    tx.platform,
    tx.saleDate,
    tx.grossCents,
    tx.netCents,
    tx.method ?? '',
    normalizeText(tx.counterpartyName ?? ''),
    normalizeText(tx.description ?? '').slice(0, 60),
    tx.kind,
  ].join('|')
}

/** Atribui hashes ao lote inteiro, contando ocorrências repetidas. */
export function assignHashes(items: NormalizedTx[]): Array<{ tx: NormalizedTx; hash: string }> {
  const counts = new Map<string, number>()
  return items.map((tx) => {
    if (tx.externalId) return { tx, hash: dedupeHash(tx) }
    const key = naturalKey(tx)
    const occurrence = counts.get(key) ?? 0
    counts.set(key, occurrence + 1)
    return { tx, hash: dedupeHash(tx, occurrence) }
  })
}
