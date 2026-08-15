import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { settings } from '@/lib/db/schema'
import { encryptSecret, decryptSecret } from '@/lib/crypto'

/**
 * Guarda o access token da InfinitePay entre uma captura e outra.
 *
 * O token dura 30 minutos, então isto não é "credencial configurada" — é uma
 * caixa de correio: o atalho do navegador deposita o token mais recente aqui e
 * o cron de hora em hora usa se ainda estiver vivo. Se estiver vencido, o job
 * registra que não tinha token e segue, sem quebrar.
 *
 * Fica cifrado em repouso porque um access token, mesmo curto, dá leitura da
 * conta inteira enquanto vale.
 */

const KEY = 'infinitepay_token'

interface StoredToken {
  /** Token cifrado — nunca em claro no banco. */
  secret: string
  /** `exp` do JWT, em milissegundos, para saber se vale sem decifrar. */
  expiresAt: number
  /** URL onde o atalho viu o token, útil para achar a rota de renovação. */
  seenAt?: string
  updatedAt: string
}

/** Lê `exp` do JWT sem validar assinatura — não somos nós que emitimos. */
export function tokenExpiry(token: string): number | null {
  try {
    const payload = token.replace(/^bearer /i, '').split('.')[1]
    if (!payload) return null
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp?: number }
    return claims.exp ? claims.exp * 1000 : null
  } catch {
    return null
  }
}

export interface TokenStatus {
  present: boolean
  valid: boolean
  minutesLeft: number | null
  updatedAt: string | null
  seenAt: string | null
}

async function read(): Promise<StoredToken | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1)
  return (row?.value as StoredToken | undefined) ?? null
}

export async function saveInfinitePayToken(token: string, seenAt?: string): Promise<TokenStatus> {
  const expiresAt = tokenExpiry(token)
  if (!expiresAt) throw new Error('Valor recebido não é um JWT com validade.')
  if (expiresAt <= Date.now()) throw new Error('Token já expirado.')

  const value: StoredToken = {
    secret: encryptSecret(token.trim()),
    expiresAt,
    seenAt,
    updatedAt: new Date().toISOString(),
  }

  await db
    .insert(settings)
    .values({ key: KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })

  return statusOf(value)
}

/** Token guardado, se ainda estiver válido. */
export async function getInfinitePayToken(): Promise<string | null> {
  const stored = await read()
  if (!stored || stored.expiresAt <= Date.now()) return null
  return decryptSecret(stored.secret)
}

function statusOf(stored: StoredToken | null): TokenStatus {
  if (!stored) {
    return { present: false, valid: false, minutesLeft: null, updatedAt: null, seenAt: null }
  }
  const minutesLeft = Math.round((stored.expiresAt - Date.now()) / 60000)
  return {
    present: true,
    valid: minutesLeft > 0,
    minutesLeft,
    updatedAt: stored.updatedAt,
    seenAt: stored.seenAt ?? null,
  }
}

export async function getTokenStatus(): Promise<TokenStatus> {
  return statusOf(await read())
}
