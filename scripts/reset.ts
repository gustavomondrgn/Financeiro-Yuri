/* eslint-disable no-console */
import postgres from 'postgres'

/**
 * Limpa os dados transacionais mantendo a estrutura.
 *
 * Existe para o dia em que os dados reais entrarem: apaga a demonstração
 * sem destruir usuários, contas, regras de divisão e categorias.
 *
 *   npm run db:reset            (apaga transações, clientes e despesas)
 *   npm run db:reset -- --all   (apaga tudo, inclusive usuários e regras)
 */

const ALL = process.argv.includes('--all')
const client = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false })

async function main() {
  const transactional = [
    'calendar_events',
    'transactions',
    'raw_events',
    'customers',
    'expenses',
    'partner_withdrawals',
    'tax_provisions',
    'ai_reports',
    'job_runs',
    'audit_log',
  ]

  const structural = [
    'classification_rules',
    'products',
    'expense_categories',
    'partner_rules',
    'goals',
    'timeline_markers',
    'accounts',
    'settings',
    'users',
  ]

  const tables = ALL ? [...transactional, ...structural] : transactional

  for (const table of tables) {
    await client.unsafe(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`)
    console.log(`limpo: ${table}`)
  }

  console.log(ALL ? 'Banco zerado por completo.' : 'Dados transacionais removidos. Estrutura preservada.')
  await client.end()
}

main().catch(async (error) => {
  console.error(error)
  await client.end()
  process.exit(1)
})
