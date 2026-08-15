/* eslint-disable no-console */
import { randomBytes, createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql as raw } from 'drizzle-orm'
import * as schema from '../lib/db/schema'

/**
 * Seed do sistema.
 *
 * Sem argumentos: cria só a estrutura real (usuários, contas, regra de
 * divisão vigente, categorias, metas). Com `--demo`: adiciona transações
 * fictícias para o painel ter o que mostrar antes dos dados reais chegarem.
 *
 *   npm run db:seed
 *   npm run db:seed -- --demo
 */

const DEMO = process.argv.includes('--demo')

const client = postgres(process.env.DATABASE_URL!, { max: 3, prepare: false })
const db = drizzle(client, { schema })

function randomPassword(): string {
  return randomBytes(9).toString('base64url')
}

async function main() {
  console.log(`Seed iniciado${DEMO ? ' (com dados de demonstração)' : ''}...`)

  /* --------------------------------------------------------------- *
   * Usuários
   * --------------------------------------------------------------- */
  const existingUsers = await db.select().from(schema.users)
  const credentials: Array<{ email: string; password: string }> = []

  if (existingUsers.length === 0) {
    for (const person of [
      { name: 'Gustavo', email: 'gustavo@kandle.studio', role: 'owner' as const },
      { name: 'Yuri dos Anjos', email: 'yuri@yuridosanjos.com.br', role: 'partner' as const },
    ]) {
      const password = randomPassword()
      await db.insert(schema.users).values({
        name: person.name,
        email: person.email,
        role: person.role,
        passwordHash: await bcrypt.hash(password, 12),
      })
      credentials.push({ email: person.email, password })
    }
  }

  /* --------------------------------------------------------------- *
   * Contas
   * --------------------------------------------------------------- */
  const existingAccounts = await db.select().from(schema.accounts)
  if (existingAccounts.length === 0) {
    await db.insert(schema.accounts).values([
      { name: 'InfinitePay — operacional', platform: 'infinitepay', kind: 'operating' },
      { name: 'InfinitePay — caixa da empresa', platform: 'infinitepay', kind: 'reserve' },
      { name: 'Kiwify', platform: 'kiwify', kind: 'operating' },
      { name: 'Cakto', platform: 'cakto', kind: 'operating' },
    ])
  }

  /* --------------------------------------------------------------- *
   * Regra de divisão vigente: 10% caixa; do resto, 80% Yuri / 20% Gustavo
   * --------------------------------------------------------------- */
  const existingRules = await db.select().from(schema.partnerRules)
  if (existingRules.length === 0) {
    await db.insert(schema.partnerRules).values([
      {
        name: 'Regra vigente — serviços e geral',
        effectiveFrom: '2024-01-01',
        productType: null,
        companyPct: '10.00',
        yuriPct: '80.00',
        gustavoPct: '20.00',
        basis: 'net',
        notes:
          'Caixa fica com 10% do líquido. O que sobra é dividido 80% Yuri / 20% Gustavo. ' +
          'Quando o percentual do Gustavo subir, criar uma nova vigência em vez de editar esta.',
      },
    ])
  }

  /* --------------------------------------------------------------- *
   * Produtos e serviços (ajustáveis pela interface)
   * --------------------------------------------------------------- */
  const existingProducts = await db.select().from(schema.products)
  if (existingProducts.length === 0) {
    await db.insert(schema.products).values([
      { name: 'Mapa Astral completo', type: 'service', defaultPriceCents: 45000, durationMinutes: 90 },
      { name: 'Revolução Solar', type: 'service', defaultPriceCents: 35000, durationMinutes: 60 },
      { name: 'Sinastria (casal)', type: 'service', defaultPriceCents: 55000, durationMinutes: 90 },
      { name: 'Consulta de retorno', type: 'service', defaultPriceCents: 25000, durationMinutes: 50 },
      { name: 'Trânsitos e previsões', type: 'service', defaultPriceCents: 30000, durationMinutes: 60 },
      { name: 'Curso digital', type: 'infoproduct', defaultPriceCents: 19700 },
    ])
  }

  /* --------------------------------------------------------------- *
   * Categorias de despesa
   * --------------------------------------------------------------- */
  const existingCategories = await db.select().from(schema.expenseCategories)
  if (existingCategories.length === 0) {
    await db.insert(schema.expenseCategories).values([
      { name: 'Ferramentas e assinaturas', kind: 'fixed_cost' },
      { name: 'Tráfego pago', kind: 'marketing' },
      { name: 'Equipe e freelancers', kind: 'variable_cost' },
      { name: 'Taxas e tarifas bancárias', kind: 'variable_cost' },
      { name: 'Equipamento', kind: 'investment' },
      { name: 'Educação e cursos', kind: 'investment' },
      { name: 'Impostos', kind: 'tax' },
      { name: 'Infraestrutura (hospedagem, domínio)', kind: 'fixed_cost' },
      { name: 'Outros', kind: 'fixed_cost' },
    ])
  }

  /* --------------------------------------------------------------- *
   * Meta estrutural: R$ 30k/mês até janeiro/2027
   * --------------------------------------------------------------- */
  const existingGoals = await db.select().from(schema.goals)
  if (existingGoals.length === 0) {
    await db.insert(schema.goals).values([
      {
        label: 'Meta mensal — R$ 30k recorrentes',
        kind: 'monthly_revenue',
        targetCents: 3_000_000,
        periodStart: '2026-01-01',
        periodEnd: '2027-12-31',
      },
    ])
  }

  /* --------------------------------------------------------------- *
   * Configurações
   * --------------------------------------------------------------- */
  const existingSettings = await db.select().from(schema.settings)
  if (existingSettings.length === 0) {
    await db.insert(schema.settings).values([
      { key: 'capacity', value: { weeklyHours: 25, averageSessionMinutes: 70 } },
      { key: 'partner_floor', value: { yuriCents: 800_000, gustavoCents: 0 } },
      { key: 'goal', value: { targetCents: 3_000_000, deadline: '2027-01-31' } },
      { key: 'tax', value: { meiMonthlyDasCents: 8_100, provisionRate: 6 } },
    ])
  }

  if (DEMO) await seedDemo()

  if (credentials.length > 0) {
    console.log('\n──────────────────────────────────────────────')
    console.log('  ACESSOS CRIADOS — troque as senhas no primeiro login')
    for (const c of credentials) console.log(`  ${c.email}  →  ${c.password}`)
    console.log('──────────────────────────────────────────────\n')
  }

  console.log('Seed concluído.')
  await client.end()
}

/* ------------------------------------------------------------------ *
 * Dados de demonstração
 * ------------------------------------------------------------------ */

async function seedDemo() {
  const existing = await db.select({ id: schema.transactions.id }).from(schema.transactions).limit(1)
  if (existing.length > 0) {
    console.log('Já existem transações — pulando dados de demonstração.')
    return
  }

  const products = await db.select().from(schema.products)
  const accounts = await db.select().from(schema.accounts)
  const operating = accounts.find((a) => a.kind === 'operating')!

  const firstNames = ['Ana', 'Bruno', 'Camila', 'Daniel', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Karina', 'Lucas', 'Mariana', 'Nicolas', 'Olivia', 'Paulo', 'Renata', 'Sofia', 'Thiago', 'Vanessa']
  const lastNames = ['Almeida', 'Barbosa', 'Cardoso', 'Duarte', 'Esteves', 'Ferreira', 'Gomes', 'Henriques', 'Ivo', 'Jardim', 'Klein', 'Lima', 'Moraes', 'Nunes', 'Oliveira', 'Pereira', 'Queiroz', 'Ribeiro', 'Santos', 'Teixeira']

  // Gerador determinístico: rodar o seed duas vezes produz o mesmo conjunto.
  let counter = 0
  const rand = () => {
    counter += 1
    const hash = createHash('sha256').update(`financeiro-demo-${counter}`).digest()
    return hash.readUInt32BE(0) / 0xffffffff
  }

  const now = new Date()
  const rows: Array<typeof schema.transactions.$inferInsert> = []
  const customerCache = new Map<string, number>()

  for (let monthOffset = 17; monthOffset >= 0; monthOffset--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1)
    const year = monthDate.getFullYear()
    const month = monthDate.getMonth() + 1
    const daysInMonth = new Date(year, month, 0).getDate()

    // Crescimento de ~12k para ~21k ao longo de 18 meses, com ruído.
    const growth = 1 + (17 - monthOffset) * 0.035
    const targetRevenue = 1_150_000 * growth * (0.9 + rand() * 0.2)
    let accumulated = 0
    let guard = 0

    while (accumulated < targetRevenue && guard < 200) {
      guard += 1
      const isInfoproduct = rand() < 0.12
      const pool = products.filter((p) => (isInfoproduct ? p.type === 'infoproduct' : p.type === 'service'))
      const product = pool[Math.floor(rand() * pool.length)] ?? products[0]
      const price = product.defaultPriceCents ?? 30000

      const day = Math.min(daysInMonth, 1 + Math.floor(rand() * daysInMonth))
      const saleDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

      const method = rand() < 0.55 ? 'pix' : 'credit_card'
      const installments = method === 'credit_card' ? 1 + Math.floor(rand() * 4) : 1
      const feeRatio = method === 'pix' ? 0.0099 : 0.0399 + installments * 0.008
      const gross = price
      const fee = Math.round(gross * feeRatio)
      const net = gross - fee

      const name = `${firstNames[Math.floor(rand() * firstNames.length)]} ${lastNames[Math.floor(rand() * lastNames.length)]}`
      const normalized = name.toLowerCase()

      let customerId = customerCache.get(normalized)
      if (!customerId) {
        const [created] = await db
          .insert(schema.customers)
          .values({ name, normalizedName: normalized, email: `${normalized.replace(/\s+/g, '.')}@exemplo.com` })
          .returning({ id: schema.customers.id })
        customerId = created.id
        customerCache.set(normalized, customerId)
      }

      const platform = isInfoproduct ? (rand() < 0.5 ? 'kiwify' : 'cakto') : 'infinitepay'
      const origins = ['instagram', 'indicacao', 'meta ads', 'organico', null]
      const origin = origins[Math.floor(rand() * origins.length)]

      rows.push({
        accountId: operating.id,
        platform: platform as 'infinitepay' | 'kiwify' | 'cakto',
        source: platform === 'infinitepay' ? 'csv_upload' : 'api',
        dedupeHash: createHash('sha256').update(`demo-${rows.length}-${saleDate}-${gross}`).digest('hex'),
        kind: 'sale',
        status: 'approved',
        method: method as 'pix' | 'credit_card',
        installments,
        grossCents: gross,
        feeCents: fee,
        netCents: net,
        saleDate,
        receiptDate: saleDate,
        description: product.name,
        counterpartyName: name,
        customerId,
        productId: product.id,
        origin,
        classifiedBy: 'rule',
      })

      accumulated += gross
    }
  }

  const CHUNK = 200
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(schema.transactions).values(rows.slice(i, i + CHUNK))
  }

  // Despesas recorrentes plausíveis
  const categories = await db.select().from(schema.expenseCategories)
  const tools = categories.find((c) => c.name.startsWith('Ferramentas'))!
  const ads = categories.find((c) => c.name === 'Tráfego pago')!
  const infra = categories.find((c) => c.name.startsWith('Infraestrutura'))!

  const expenseRows: Array<typeof schema.expenses.$inferInsert> = []
  for (let monthOffset = 17; monthOffset >= 0; monthOffset--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1)
    const competence = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}-01`
    expenseRows.push(
      {
        description: 'Ferramentas e assinaturas',
        categoryId: tools.id,
        kind: 'fixed_cost',
        amountCents: 42_000 + Math.round(rand() * 8_000),
        competenceDate: competence,
        dueDate: competence,
        paidDate: competence,
        status: 'paid',
        recurrence: 'monthly',
      },
      {
        description: 'Tráfego pago — Meta Ads',
        categoryId: ads.id,
        kind: 'marketing',
        amountCents: 60_000 + Math.round(rand() * 90_000),
        competenceDate: competence,
        dueDate: competence,
        paidDate: competence,
        status: 'paid',
        channel: 'meta_ads',
      },
      {
        description: 'Hospedagem e domínio',
        categoryId: infra.id,
        kind: 'fixed_cost',
        amountCents: 9_000,
        competenceDate: competence,
        dueDate: competence,
        paidDate: competence,
        status: 'paid',
        recurrence: 'monthly',
      },
    )
  }
  await db.insert(schema.expenses).values(expenseRows)

  // Retiradas dos sócios dos últimos 6 meses
  const withdrawals: Array<typeof schema.partnerWithdrawals.$inferInsert> = []
  for (let monthOffset = 5; monthOffset >= 0; monthOffset--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - monthOffset, 5)
    const date = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}-05`
    withdrawals.push(
      { partner: 'yuri', amountCents: 750_000 + Math.round(rand() * 100_000), date },
      { partner: 'gustavo', amountCents: 180_000 + Math.round(rand() * 60_000), date },
    )
  }
  await db.insert(schema.partnerWithdrawals).values(withdrawals)

  // Saldos das contas
  await db
    .update(schema.accounts)
    .set({ balanceCents: 1_240_000, balanceUpdatedAt: new Date() })
    .where(raw`${schema.accounts.kind} = 'operating'`)
  await db
    .update(schema.accounts)
    .set({ balanceCents: 860_000, balanceUpdatedAt: new Date() })
    .where(raw`${schema.accounts.kind} = 'reserve'`)

  // Agregados de cliente
  const agg = await db
    .select({
      customerId: schema.transactions.customerId,
      count: raw<number>`count(*)::int`,
      total: raw<number>`coalesce(sum(${schema.transactions.netCents}), 0)::int`,
      first: raw<string>`min(${schema.transactions.saleDate})`,
      last: raw<string>`max(${schema.transactions.saleDate})`,
    })
    .from(schema.transactions)
    .groupBy(schema.transactions.customerId)

  for (const row of agg) {
    if (!row.customerId) continue
    await db
      .update(schema.customers)
      .set({
        purchaseCount: row.count,
        totalNetCents: row.total,
        firstPurchaseAt: row.first,
        lastPurchaseAt: row.last,
      })
      .where(raw`${schema.customers.id} = ${row.customerId}`)
  }

  console.log(`Demo: ${rows.length} transações, ${customerCache.size} clientes, ${expenseRows.length} despesas.`)
}

main().catch(async (error) => {
  console.error(error)
  await client.end()
  process.exit(1)
})
