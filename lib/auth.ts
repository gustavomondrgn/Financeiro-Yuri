import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { env } from '@/lib/env'

/**
 * Autenticação própria: dois sócios, sessão em JWT dentro de cookie httpOnly.
 * Sem provider externo — menos superfície, menos dependência, e o login
 * continua funcionando mesmo se um serviço de terceiro cair.
 */

const COOKIE_NAME = 'financeiro_session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 dias

export interface SessionUser {
  id: number
  name: string
  email: string
  role: 'owner' | 'partner'
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.authSecret)
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export async function createSession(user: SessionUser): Promise<void> {
  const token = await new SignJWT({
    sub: String(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey())

  const store = await cookies()
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function destroySession(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE_NAME)
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, secretKey())
    return {
      id: Number(payload.sub),
      name: String(payload.name ?? ''),
      email: String(payload.email ?? ''),
      role: (payload.role as SessionUser['role']) ?? 'partner',
    }
  } catch {
    return null
  }
}

/** Usado nas páginas do painel: sem sessão, volta pro login. */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSession()
  if (!session) redirect('/login')
  return session
}

export async function authenticate(
  email: string,
  password: string,
): Promise<{ ok: true; user: SessionUser } | { ok: false; error: string }> {
  const [record] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1)

  // Mensagem única para e-mail inexistente e senha errada: não entregar
  // a um atacante a informação de quais e-mails existem.
  const genericError = 'E-mail ou senha inválidos.'

  if (!record || !record.active) return { ok: false, error: genericError }

  const valid = await verifyPassword(password, record.passwordHash)
  if (!valid) return { ok: false, error: genericError }

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, record.id))

  return {
    ok: true,
    user: {
      id: record.id,
      name: record.name,
      email: record.email,
      role: record.role,
    },
  }
}

export const SESSION_COOKIE = COOKIE_NAME
