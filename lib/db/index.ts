import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

/**
 * Cliente Postgres compartilhado.
 *
 * Em dev o Next recarrega módulos a cada edição; sem o cache no globalThis
 * cada reload abriria um pool novo e o Neon derrubaria a conexão por limite.
 */
const globalForDb = globalThis as unknown as {
  __financeiroSql?: ReturnType<typeof postgres>
}

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL não definida — configure .env.local ou as env vars do Coolify.')
}

const sql =
  globalForDb.__financeiroSql ??
  postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
  })

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__financeiroSql = sql
}

export const db = drizzle(sql, { schema })
export { sql, schema }
export type Db = typeof db
