import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { saveInfinitePayToken } from '@/lib/ingest/infinitepay-token'

export const runtime = 'nodejs'

/**
 * Caixa de entrada do access token da InfinitePay.
 *
 * Quem chama é o atalho do navegador (ver `lib/infinitepay-bookmarklet.ts`),
 * rodando dentro de `app.infinitepay.io`. Duas consequências no desenho:
 *
 * - **Sem CORS.** O atalho envia `Content-Type: text/plain`, que é uma
 *   requisição simples e não dispara preflight, e usa `mode: 'no-cors'` —
 *   dispara e esquece, sem ler a resposta. Por isso o corpo é texto puro com o
 *   token, não JSON.
 * - **Segredo na URL.** É o único lugar onde cabe, já que não dá para mandar
 *   header customizado sem virar preflight. É o mesmo padrão dos webhooks das
 *   plataformas, que já funciona assim aqui.
 *
 * O token vale 30 minutos e é guardado cifrado. Recebê-lo de novo só sobrescreve.
 */

function authorized(request: Request): boolean {
  return new URL(request.url).searchParams.get('token') === env.webhookSecret
}

export async function POST(request: Request) {
  if (!authorized(request)) return new NextResponse('Não autorizado.', { status: 401 })

  const url = new URL(request.url)
  const body = (await request.text()).trim()

  // Aceita texto puro (caminho do atalho) ou JSON (caminho manual, via curl).
  let accessToken = body
  if (body.startsWith('{')) {
    try {
      accessToken = String((JSON.parse(body) as { token?: string }).token ?? '')
    } catch {
      return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 })
    }
  }

  if (!accessToken) return NextResponse.json({ ok: false, error: 'Token ausente.' }, { status: 400 })

  try {
    const status = await saveInfinitePayToken(accessToken, url.searchParams.get('origem') ?? undefined)
    return NextResponse.json({ ok: true, ...status })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao guardar o token.'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}

/** Preflight, caso algum navegador insista em mandar um. */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://app.infinitepay.io',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '86400',
    },
  })
}
