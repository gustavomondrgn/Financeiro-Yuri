import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { syncPlatforms } from '@/lib/ingest/sync'
import { emptyResult } from '@/lib/ingest/types'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Sincronização periódica das plataformas com API oficial.
 *
 * Chamada pelas Scheduled Tasks do Coolify, via `scripts/cron.mjs`:
 *   node /app/scripts/cron.mjs sync
 *
 * O mesmo endpoint faz o backfill do histórico — só muda a janela:
 *   node /app/scripts/cron.mjs sync --dias=3000
 */

function authorize(request: Request): boolean {
  const url = new URL(request.url)
  const token = url.searchParams.get('token') ?? request.headers.get('x-cron-token')
  return token === env.cronSecret
}

export async function GET(request: Request) {
  if (!authorize(request)) return new NextResponse('Não autorizado.', { status: 401 })

  const days = Number(new URL(request.url).searchParams.get('dias') ?? 15)

  try {
    // O teto alto é de propósito: `?dias=3000` é o backfill do histórico
    // inteiro, pelo mesmo caminho que o sync de toda hora.
    const results = await syncPlatforms(Math.min(5000, Math.max(1, days)))
    return NextResponse.json({ ok: true, results })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha na sincronização.'
    return NextResponse.json({ ok: false, error: message, ...emptyResult() }, { status: 500 })
  }
}

export const POST = GET
