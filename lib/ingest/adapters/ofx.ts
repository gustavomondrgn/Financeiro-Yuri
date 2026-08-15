import { normalizeDate } from '@/lib/dates'
import { detectKind } from './infinitepay-csv'
import type { NormalizedTx, Platform } from '../types'

/**
 * Parser de OFX.
 *
 * OFX é SGML com tags que frequentemente não fecham, então parser de XML
 * quebra. Como o formato de extrato é simples e estável, uma varredura de
 * blocos <STMTTRN> é mais confiável do que uma dependência externa.
 *
 * Serve para InfinitePay (quando exporta OFX) e para qualquer banco —
 * inclusive o Inter, enquanto a API oficial não estiver ligada.
 */

interface OfxTransaction {
  type?: string
  datePosted?: string
  amount?: string
  fitId?: string
  name?: string
  memo?: string
  checkNum?: string
}

function extractTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}>([^<\r\n]*)`, 'i'))
  return match ? match[1].trim() : undefined
}

export function parseOfx(content: string, platform: Platform = 'infinitepay'): NormalizedTx[] {
  const blocks = content.split(/<STMTTRN>/i).slice(1)
  const out: NormalizedTx[] = []

  for (const block of blocks) {
    const body = block.split(/<\/STMTTRN>/i)[0]
    const tx: OfxTransaction = {
      type: extractTag(body, 'TRNTYPE'),
      datePosted: extractTag(body, 'DTPOSTED'),
      amount: extractTag(body, 'TRNAMT'),
      fitId: extractTag(body, 'FITID'),
      name: extractTag(body, 'NAME'),
      memo: extractTag(body, 'MEMO'),
      checkNum: extractTag(body, 'CHECKNUM'),
    }

    const saleDate = normalizeDate(tx.datePosted)
    if (!saleDate || !tx.amount) continue

    const amount = Number(tx.amount.replace(',', '.'))
    if (!Number.isFinite(amount)) continue

    const cents = Math.round(Math.abs(amount) * 100)
    const description = [tx.name, tx.memo].filter(Boolean).join(' — ')
    const signedCents = amount < 0 ? -cents : cents

    out.push({
      platform,
      source: 'csv_upload',
      externalId: tx.fitId ? `ofx:${tx.fitId}` : null,
      kind: detectKind(description, tx.type, signedCents),
      status: 'approved',
      method: null,
      installments: 1,
      grossCents: cents,
      feeCents: 0,
      netCents: cents,
      saleDate,
      receiptDate: saleDate,
      description: description || null,
      counterpartyName: tx.name ?? null,
      productHint: description || null,
      raw: tx,
    })
  }

  return out
}
