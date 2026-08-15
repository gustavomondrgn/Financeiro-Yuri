import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { today, addDays } from '@/lib/dates'
import { ingestBatch, runJob, resolveAccount } from '@/lib/ingest/pipeline'
import { fetchKiwifySales } from '@/lib/ingest/adapters/kiwify'
import { fetchCaktoOrders } from '@/lib/ingest/adapters/cakto'
import {
  fetchInfinitePaySales,
  fetchInfinitePayStatements,
} from '@/lib/ingest/adapters/infinitepay-api'
import { refreshCustomerAggregates } from '@/lib/ingest/customers'
import { emptyResult, type IngestResult } from '@/lib/ingest/types'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Sincronização periódica das plataformas com API oficial.
 *
 * Chamado pelas Scheduled Tasks do Coolify:
 *   curl -fsS "$APP_URL/api/cron/sync?token=$CRON_SECRET"
 *
 * Reprocessa uma janela sobreposta de propósito — vendas mudam de status
 * (aprovada → estornada) depois de criadas, e a deduplicação garante que a
 * sobreposição não vire lançamento novo.
 */

function authorize(request: Request): boolean {
  const url = new URL(request.url)
  const token = url.searchParams.get('token') ?? request.headers.get('x-cron-token')
  return token === env.cronSecret
}

async function sync(days: number): Promise<Record<string, IngestResult | { skipped: string }>> {
  const end = today()
  const start = addDays(end, -days)
  const out: Record<string, IngestResult | { skipped: string }> = {}

  // InfinitePay primeiro: é ~90% da receita. A API interna aceita janela
  // desde 2020, então `?dias=3000` neste mesmo endpoint faz o backfill
  // inteiro sem código separado.
  if (env.infinitepay.configured) {
    const accountId = await resolveAccount('infinitepay', 'InfinitePay')
    out.infinitepay = await runJob(
      'sync:infinitepay',
      async () => {
        const sales = await fetchInfinitePaySales(start, end)
        const outflows = await fetchInfinitePayStatements(start, end)
        return ingestBatch([...sales, ...outflows], {
          batchRef: `infinitepay:${start}..${end}`,
          defaultAccountId: accountId,
        })
      },
      { start, end },
    )
  } else {
    out.infinitepay = { skipped: 'token de sessão não configurado' }
  }

  if (env.kiwify.configured) {
    const accountId = await resolveAccount('kiwify', 'Kiwify')
    out.kiwify = await runJob(
      'sync:kiwify',
      async () => {
        const transactions = await fetchKiwifySales(start, end)
        return ingestBatch(transactions, { batchRef: `kiwify:${start}..${end}`, defaultAccountId: accountId })
      },
      { start, end },
    )
  } else {
    out.kiwify = { skipped: 'credenciais não configuradas' }
  }

  if (env.cakto.configured) {
    const accountId = await resolveAccount('cakto', 'Cakto')
    out.cakto = await runJob(
      'sync:cakto',
      async () => {
        const transactions = await fetchCaktoOrders(start, end)
        return ingestBatch(transactions, { batchRef: `cakto:${start}..${end}`, defaultAccountId: accountId })
      },
      { start, end },
    )
  } else {
    out.cakto = { skipped: 'token não configurado' }
  }

  await refreshCustomerAggregates()
  return out
}

export async function GET(request: Request) {
  if (!authorize(request)) return new NextResponse('Não autorizado.', { status: 401 })

  const days = Number(new URL(request.url).searchParams.get('dias') ?? 15)

  try {
    // O teto alto é de propósito: `?dias=3000` é o backfill do histórico
    // inteiro, pelo mesmo caminho que o sync de toda hora.
    const results = await sync(Math.min(5000, Math.max(1, days)))
    return NextResponse.json({ ok: true, results })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha na sincronização.'
    return NextResponse.json({ ok: false, error: message, ...emptyResult() }, { status: 500 })
  }
}

export const POST = GET
