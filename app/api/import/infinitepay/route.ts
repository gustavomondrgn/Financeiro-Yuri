import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { ingestBatch, runJob, resolveAccount } from '@/lib/ingest/pipeline'
import type { NormalizedTx } from '@/lib/ingest/types'

export const runtime = 'nodejs'
export const maxDuration = 300

const txSchema = z.object({
  platform: z.enum(['infinitepay', 'kiwify', 'cakto', 'inter', 'manual']),
  source: z.enum(['webhook', 'api', 'internal_api', 'csv_upload', 'email', 'playwright', 'manual']),
  externalId: z.string().nullable().optional(),
  kind: z.enum(['sale', 'refund', 'chargeback', 'fee', 'transfer_in', 'transfer_out', 'withdrawal', 'other']),
  status: z.enum(['pending', 'approved', 'refunded', 'chargeback', 'canceled']),
  method: z.enum(['pix', 'credit_card', 'debit_card', 'boleto', 'transfer', 'other']).nullable().optional(),
  installments: z.number().int().min(1).max(48).optional(),
  grossCents: z.number().int(),
  feeCents: z.number().int(),
  netCents: z.number().int(),
  saleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  description: z.string().nullable().optional(),
  counterpartyName: z.string().nullable().optional(),
  counterpartyEmail: z.string().nullable().optional(),
  counterpartyPhone: z.string().nullable().optional(),
  counterpartyDocument: z.string().nullable().optional(),
  origin: z.string().nullable().optional(),
  productHint: z.string().nullable().optional(),
  raw: z.unknown(),
})

const bodySchema = z.object({
  transactions: z.array(txSchema).max(20_000),
  batchRef: z.string().max(200).optional(),
  dryRun: z.boolean().optional(),
})

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return new NextResponse('Não autenticado.', { status: 401 })

  let parsed
  try {
    parsed = bodySchema.parse(await request.json())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payload inválido.'
    return new NextResponse(`Payload inválido: ${message}`, { status: 400 })
  }

  const accountId = await resolveAccount('infinitepay', 'InfinitePay — operacional')

  try {
    const result = await runJob(
      parsed.dryRun ? 'import:infinitepay:dry_run' : 'import:infinitepay',
      () =>
        ingestBatch(parsed.transactions as NormalizedTx[], {
          batchRef: parsed.batchRef,
          defaultAccountId: accountId,
          dryRun: parsed.dryRun,
        }),
      { batchRef: parsed.batchRef, user: session.email },
    )

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao importar.'
    return new NextResponse(message, { status: 500 })
  }
}
