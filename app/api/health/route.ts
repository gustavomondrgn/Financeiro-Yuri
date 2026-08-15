import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Sonda de saúde para o Coolify e para monitoramento externo. */
export async function GET() {
  try {
    const started = Date.now()
    await db.execute(sql`select 1`)
    return NextResponse.json({
      ok: true,
      database: 'up',
      latencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        database: 'down',
        error: error instanceof Error ? error.message : 'erro desconhecido',
      },
      { status: 503 },
    )
  }
}
