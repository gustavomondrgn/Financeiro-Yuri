import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { ingestBatch, runJob, resolveAccount } from '@/lib/ingest/pipeline'
import { kiwifyWebhookToTx } from '@/lib/ingest/adapters/kiwify'
import { caktoWebhookToTx } from '@/lib/ingest/adapters/cakto'
import { emptyResult } from '@/lib/ingest/types'

export const runtime = 'nodejs'

/**
 * Webhooks das plataformas de infoproduto.
 *
 * URL: /api/webhooks/kiwify?token=<WEBHOOK_SECRET>
 *      /api/webhooks/cakto?token=<WEBHOOK_SECRET>
 *
 * O token na URL é o que a maioria dessas plataformas suporta — elas não
 * permitem cabeçalho customizado. Responder 200 rápido é obrigatório: se
 * demorarmos, a plataforma reenvia, e é a deduplicação que impede a
 * duplicata virar receita fantasma.
 */

export async function POST(
  request: Request,
  context: { params: Promise<{ platform: string }> },
) {
  const { platform } = await context.params
  const url = new URL(request.url)
  const token = url.searchParams.get('token') ?? request.headers.get('x-webhook-token')

  if (token !== env.webhookSecret) {
    return new NextResponse('Token inválido.', { status: 401 })
  }

  if (platform !== 'kiwify' && platform !== 'cakto') {
    return new NextResponse('Plataforma não suportada.', { status: 404 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return new NextResponse('Corpo inválido.', { status: 400 })
  }

  const tx = platform === 'kiwify' ? kiwifyWebhookToTx(payload) : caktoWebhookToTx(payload)

  // Eventos que não viram transação (teste de conexão, assinatura criada)
  // são reconhecidos com 200 para a plataforma não ficar reenviando.
  if (!tx) return NextResponse.json({ ok: true, ignored: true })

  const accountId = await resolveAccount(platform, platform === 'kiwify' ? 'Kiwify' : 'Cakto')

  try {
    const result = await runJob(
      `webhook:${platform}`,
      () => ingestBatch([tx], { batchRef: `webhook:${platform}`, defaultAccountId: accountId }),
      { platform },
    )
    return NextResponse.json({ ok: true, created: result.created, duplicated: result.duplicated })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao processar.'
    // 500 faz a plataforma reenviar — desejável quando o banco está fora do ar.
    return new NextResponse(message, { status: 500 })
  }
}

export async function GET() {
  // Algumas plataformas fazem um GET de verificação antes de ativar o webhook.
  return NextResponse.json({ ok: true, ...emptyResult() })
}
