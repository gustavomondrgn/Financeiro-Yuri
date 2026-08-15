/* eslint-disable no-console */
import fs from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'
import bcrypt from 'bcryptjs'

/**
 * Bootstrap de produção.
 *
 * Roda no start do container, antes do Next subir. Aplica o schema e cria a
 * estrutura mínima (usuários, contas, regra de divisão, produtos, categorias,
 * meta) — tudo idempotente, então rodar de novo a cada deploy não faz nada
 * além de conferir.
 *
 * Existe porque o banco de produção não é acessível de fora: sem isso, a
 * primeira migração exigiria abrir uma porta no servidor.
 */

const url = process.env.DATABASE_URL
if (!url) {
  console.error('[bootstrap] DATABASE_URL ausente — pulando.')
  process.exit(0)
}

const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 30 })

async function tableExists(name) {
  const [row] = await sql`
    select exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = ${name}
    ) as present
  `
  return row.present
}

/**
 * Aplica as migrações que ainda não rodaram.
 *
 * Controla por arquivo, numa tabela própria, em vez de perguntar "a tabela
 * `transactions` existe?". A pergunta antiga só sabia responder se o banco
 * estava vazio: uma vez criado, nenhuma migração nova era aplicada, e uma
 * alteração de schema chegaria ao deploy sem chegar ao banco.
 */
async function applySchema() {
  await sql`
    create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `

  const dir = path.join(process.cwd(), 'drizzle')
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const applied = new Set((await sql`select filename from schema_migrations`).map((r) => r.filename))

  // Banco que já existia antes desta tabela: marca o que já está aplicado
  // como aplicado, senão a primeira migração rodaria de novo.
  if (applied.size === 0 && (await tableExists('transactions'))) {
    for (const file of files) {
      await sql`insert into schema_migrations (filename) values (${file}) on conflict do nothing`
      applied.add(file)
    }
    console.log(`[bootstrap] banco preexistente — ${files.length} migração(ões) marcada(s) como aplicada(s)`)
  }

  const pending = files.filter((f) => !applied.has(f))
  if (pending.length === 0) {
    console.log('[bootstrap] schema em dia')
    return
  }

  for (const file of pending) {
    const content = fs.readFileSync(path.join(dir, file), 'utf8')
    const statements = content
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)

    for (const statement of statements) {
      try {
        await sql.unsafe(statement)
      } catch (error) {
        // Enum ou tabela já existente não é falha — o objetivo é convergir.
        if (!/already exists/i.test(error.message)) throw error
      }
    }

    await sql`insert into schema_migrations (filename) values (${file}) on conflict do nothing`
    console.log(`[bootstrap] migração aplicada: ${file} (${statements.length} comandos)`)
  }
}

async function seedStructure() {
  const [{ count: userCount }] = await sql`select count(*)::int as count from users`

  if (userCount === 0) {
    const people = [
      { name: 'Gustavo', email: 'gustavo@kandle.studio', role: 'owner', env: 'BOOTSTRAP_GUSTAVO_PASSWORD' },
      { name: 'Yuri dos Anjos', email: 'yuri@yuridosanjos.com.br', role: 'partner', env: 'BOOTSTRAP_YURI_PASSWORD' },
    ]

    for (const person of people) {
      const password = process.env[person.env]
      if (!password) {
        console.error(`[bootstrap] ${person.env} não definida — usuário ${person.email} não criado.`)
        continue
      }
      const hash = await bcrypt.hash(password, 12)
      await sql`
        insert into users (name, email, password_hash, role)
        values (${person.name}, ${person.email}, ${hash}, ${person.role})
        on conflict (email) do nothing
      `
      console.log(`[bootstrap] usuário criado: ${person.email}`)
    }
  }

  const [{ count: accountCount }] = await sql`select count(*)::int as count from accounts`
  if (accountCount === 0) {
    await sql`
      insert into accounts (name, platform, kind) values
        ('InfinitePay — operacional', 'infinitepay', 'operating'),
        ('InfinitePay — caixa da empresa', 'infinitepay', 'reserve'),
        ('Kiwify', 'kiwify', 'operating'),
        ('Cakto', 'cakto', 'operating')
    `
    console.log('[bootstrap] contas criadas')
  }

  const [{ count: ruleCount }] = await sql`select count(*)::int as count from partner_rules`
  if (ruleCount === 0) {
    await sql`
      insert into partner_rules (name, effective_from, company_pct, yuri_pct, gustavo_pct, basis, notes)
      values (
        'Regra vigente — serviços e geral', '2024-01-01', 10.00, 80.00, 20.00, 'net',
        'Caixa fica com 10% do líquido. O que sobra é dividido 80% Yuri / 20% Gustavo. Quando o percentual mudar, criar nova vigência.'
      )
    `
    console.log('[bootstrap] regra de divisão criada')
  }

  const [{ count: categoryCount }] = await sql`select count(*)::int as count from expense_categories`
  if (categoryCount === 0) {
    await sql`
      insert into expense_categories (name, kind) values
        ('Ferramentas e assinaturas', 'fixed_cost'),
        ('Tráfego pago', 'marketing'),
        ('Equipe e freelancers', 'variable_cost'),
        ('Taxas e tarifas bancárias', 'variable_cost'),
        ('Equipamento', 'investment'),
        ('Educação e cursos', 'investment'),
        ('Impostos', 'tax'),
        ('Infraestrutura (hospedagem, domínio)', 'fixed_cost'),
        ('Outros', 'fixed_cost')
    `
    console.log('[bootstrap] categorias de despesa criadas')
  }

  const [{ count: productCount }] = await sql`select count(*)::int as count from products`
  if (productCount === 0) {
    await sql`
      insert into products (name, type, default_price_cents, duration_minutes) values
        ('Mapa Astral completo', 'service', 45000, 90),
        ('Revolução Solar', 'service', 35000, 60),
        ('Sinastria (casal)', 'service', 55000, 90),
        ('Consulta de retorno', 'service', 25000, 50),
        ('Trânsitos e previsões', 'service', 30000, 60)
    `
    console.log('[bootstrap] produtos iniciais criados')
  }

  const [{ count: goalCount }] = await sql`select count(*)::int as count from goals`
  if (goalCount === 0) {
    await sql`
      insert into goals (label, kind, target_cents, period_start, period_end)
      values ('Meta mensal — R$ 30k recorrentes', 'monthly_revenue', 3000000, '2026-01-01', '2027-12-31')
    `
    console.log('[bootstrap] meta criada')
  }

  const [{ count: settingCount }] = await sql`select count(*)::int as count from settings`
  if (settingCount === 0) {
    await sql`
      insert into settings (key, value) values
        ('capacity', '{"weeklyHours":25,"averageSessionMinutes":70}'::jsonb),
        ('partner_floor', '{"yuriCents":800000,"gustavoCents":0}'::jsonb),
        ('goal', '{"targetCents":3000000,"deadline":"2027-01-31"}'::jsonb),
        ('tax', '{"meiMonthlyDasCents":8100,"provisionRate":6}'::jsonb)
    `
    console.log('[bootstrap] configurações criadas')
  }
}

try {
  await applySchema()
  await seedStructure()
  console.log('[bootstrap] pronto')
} catch (error) {
  console.error('[bootstrap] falhou:', error.message)
  // Não derruba o container: o painel sobe e o erro aparece no log e na
  // sonda de saúde, em vez de virar um crashloop silencioso.
} finally {
  await sql.end()
}
