import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

/**
 * Guarda de rota. Só confere se a sessão é válida — a autorização fina
 * fica nas páginas/ações, onde há acesso ao banco.
 */

const COOKIE_NAME = 'financeiro_session'

/**
 * Rotas sem sessão de usuário. Não são abertas: cada uma se autentica por
 * conta própria com segredo na URL — webhook, cron e a caixa de entrada do
 * token da InfinitePay, que é chamada pelo atalho de navegador de dentro do
 * `app.infinitepay.io` e nunca carrega o cookie deste domínio.
 */
const PUBLIC_PATHS = [
  '/login',
  '/api/webhooks',
  '/api/cron',
  '/api/health',
  '/api/infinitepay/token',
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) return redirectToLogin(request)

  try {
    await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET))
    return NextResponse.next()
  } catch {
    return redirectToLogin(request)
  }
}

function redirectToLogin(request: NextRequest) {
  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('from', request.nextUrl.pathname)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
