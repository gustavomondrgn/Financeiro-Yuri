import {
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
  index,
  numeric,
} from 'drizzle-orm/pg-core'

/* ------------------------------------------------------------------ *
 * Enums
 * ------------------------------------------------------------------ */

export const platformEnum = pgEnum('platform', [
  'infinitepay',
  'kiwify',
  'cakto',
  'inter',
  'manual',
])

export const ingestSourceEnum = pgEnum('ingest_source', [
  'webhook',
  'api',
  'internal_api',
  'csv_upload',
  'email',
  'playwright',
  'manual',
])

export const txKindEnum = pgEnum('tx_kind', [
  'sale',
  'refund',
  'chargeback',
  'fee',
  'transfer_in',
  'transfer_out',
  'withdrawal',
  'other',
])

export const txStatusEnum = pgEnum('tx_status', [
  'pending',
  'approved',
  'refunded',
  'chargeback',
  'canceled',
])

export const paymentMethodEnum = pgEnum('payment_method', [
  'pix',
  'credit_card',
  'debit_card',
  'boleto',
  'transfer',
  'other',
])

export const productTypeEnum = pgEnum('product_type', [
  'service',
  'infoproduct',
  'other',
])

export const accountKindEnum = pgEnum('account_kind', [
  'operating',
  'reserve',
  'bank',
])

export const expenseKindEnum = pgEnum('expense_kind', [
  'fixed_cost',
  'variable_cost',
  'direct_cost',
  'investment',
  'marketing',
  'tax',
  'partner_withdrawal',
])

export const expenseStatusEnum = pgEnum('expense_status', [
  'pending',
  'paid',
  'canceled',
])

export const recurrenceEnum = pgEnum('recurrence', [
  'none',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
])

export const partnerEnum = pgEnum('partner', ['yuri', 'gustavo', 'company'])

export const userRoleEnum = pgEnum('user_role', ['owner', 'partner'])

export const jobStatusEnum = pgEnum('job_status', ['running', 'success', 'error'])

export const markerTypeEnum = pgEnum('marker_type', [
  'campaign',
  'launch',
  'appearance',
  'seasonal',
  'other',
])

/* ------------------------------------------------------------------ *
 * Usuários e auditoria
 * ------------------------------------------------------------------ */

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRoleEnum('role').notNull().default('partner'),
  active: boolean('active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const auditLog = pgTable(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_entity_idx').on(t.entity, t.entityId)],
)

/* ------------------------------------------------------------------ *
 * Contas (InfinitePay operacional, InfinitePay caixa, Inter PJ...)
 * ------------------------------------------------------------------ */

export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  platform: platformEnum('platform').notNull(),
  kind: accountKindEnum('kind').notNull().default('operating'),
  externalRef: text('external_ref'),
  /** Saldo informado/conciliado, em centavos. */
  balanceCents: integer('balance_cents').notNull().default(0),
  balanceUpdatedAt: timestamp('balance_updated_at', { withTimezone: true }),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/* ------------------------------------------------------------------ *
 * Ingestão: payload cru e imutável de toda fonte
 * ------------------------------------------------------------------ */

export const rawEvents = pgTable(
  'raw_events',
  {
    id: serial('id').primaryKey(),
    platform: platformEnum('platform').notNull(),
    source: ingestSourceEnum('source').notNull(),
    /** Id da transação na origem, quando existe. */
    externalId: text('external_id'),
    payload: jsonb('payload').notNull(),
    /** Nome do arquivo/lote de origem, para rastrear importações. */
    batchRef: text('batch_ref'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingError: text('processing_error'),
  },
  (t) => [
    index('raw_events_platform_idx').on(t.platform, t.receivedAt),
    index('raw_events_external_idx').on(t.platform, t.externalId),
  ],
)

/* ------------------------------------------------------------------ *
 * Clientes e produtos
 * ------------------------------------------------------------------ */

export const customers = pgTable(
  'customers',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    /** Nome minúsculo sem acento/pontuação — usado para unificar identidade. */
    normalizedName: text('normalized_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    document: text('document'),
    firstPurchaseAt: date('first_purchase_at'),
    lastPurchaseAt: date('last_purchase_at'),
    purchaseCount: integer('purchase_count').notNull().default(0),
    totalNetCents: integer('total_net_cents').notNull().default(0),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('customers_normalized_idx').on(t.normalizedName),
    index('customers_email_idx').on(t.email),
    index('customers_phone_idx').on(t.phone),
  ],
)

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  type: productTypeEnum('type').notNull().default('service'),
  defaultPriceCents: integer('default_price_cents'),
  /** Duração do atendimento, base para receita por hora e ocupação. */
  durationMinutes: integer('duration_minutes'),
  /** Custo direto por unidade vendida (material, plataforma de aula, etc). */
  unitCostCents: integer('unit_cost_cents').notNull().default(0),
  platform: platformEnum('platform'),
  externalId: text('external_id'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/* ------------------------------------------------------------------ *
 * Transações — fonte única da verdade da receita
 * ------------------------------------------------------------------ */

export const transactions = pgTable(
  'transactions',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id').references(() => accounts.id),
    platform: platformEnum('platform').notNull(),
    source: ingestSourceEnum('source').notNull(),
    externalId: text('external_id'),
    /** Hash de deduplicação: sha256 de (plataforma, external_id) ou dos campos naturais. */
    dedupeHash: text('dedupe_hash').notNull(),

    kind: txKindEnum('kind').notNull().default('sale'),
    status: txStatusEnum('status').notNull().default('approved'),
    method: paymentMethodEnum('method'),
    installments: integer('installments').notNull().default(1),

    grossCents: integer('gross_cents').notNull(),
    feeCents: integer('fee_cents').notNull().default(0),
    netCents: integer('net_cents').notNull(),

    /** Competência: quando a venda aconteceu. */
    saleDate: date('sale_date').notNull(),
    /** Caixa: quando o dinheiro entrou/entra na conta. */
    receiptDate: date('receipt_date'),

    description: text('description'),
    counterpartyName: text('counterparty_name'),
    counterpartyEmail: text('counterparty_email'),
    counterpartyPhone: text('counterparty_phone'),
    counterpartyDocument: text('counterparty_document'),

    customerId: integer('customer_id').references(() => customers.id),
    productId: integer('product_id').references(() => products.id),
    /** Origem/campanha: utm, indicação, instagram, etc. */
    origin: text('origin'),

    classifiedBy: text('classified_by'),
    classificationRuleId: integer('classification_rule_id'),
    needsReview: boolean('needs_review').notNull().default(false),

    rawEventId: integer('raw_event_id').references(() => rawEvents.id),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('transactions_dedupe_idx').on(t.dedupeHash),
    index('transactions_sale_date_idx').on(t.saleDate),
    index('transactions_receipt_date_idx').on(t.receiptDate),
    index('transactions_platform_idx').on(t.platform, t.saleDate),
    index('transactions_customer_idx').on(t.customerId),
    index('transactions_product_idx').on(t.productId),
    index('transactions_review_idx').on(t.needsReview),
  ],
)

/* ------------------------------------------------------------------ *
 * Classificação automática
 * ------------------------------------------------------------------ */

export const classificationRules = pgTable('classification_rules', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  priority: integer('priority').notNull().default(100),
  platform: platformEnum('platform'),
  /** description | counterparty | any */
  matchField: text('match_field').notNull().default('any'),
  /** contains | equals | regex */
  matchType: text('match_type').notNull().default('contains'),
  pattern: text('pattern'),
  minCents: integer('min_cents'),
  maxCents: integer('max_cents'),
  method: paymentMethodEnum('method'),
  productId: integer('product_id').references(() => products.id),
  kind: txKindEnum('kind'),
  origin: text('origin'),
  active: boolean('active').notNull().default(true),
  hitCount: integer('hit_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/* ------------------------------------------------------------------ *
 * Despesas, contas a pagar e investimentos
 * ------------------------------------------------------------------ */

export const expenseCategories = pgTable('expense_categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  kind: expenseKindEnum('kind').notNull().default('fixed_cost'),
  color: text('color'),
  active: boolean('active').notNull().default(true),
})

export const expenses = pgTable(
  'expenses',
  {
    id: serial('id').primaryKey(),
    description: text('description').notNull(),
    categoryId: integer('category_id').references(() => expenseCategories.id),
    kind: expenseKindEnum('kind').notNull().default('fixed_cost'),
    amountCents: integer('amount_cents').notNull(),
    /** Competência (mês a que a despesa se refere). */
    competenceDate: date('competence_date').notNull(),
    dueDate: date('due_date'),
    paidDate: date('paid_date'),
    status: expenseStatusEnum('status').notNull().default('pending'),
    recurrence: recurrenceEnum('recurrence').notNull().default('none'),
    /** Série-mãe quando a despesa é uma ocorrência gerada de uma recorrência. */
    recurrenceParentId: integer('recurrence_parent_id'),
    recurrenceUntil: date('recurrence_until'),
    accountId: integer('account_id').references(() => accounts.id),
    supplier: text('supplier'),
    /** Canal de mídia quando kind = marketing (meta_ads, google_ads, influencer...). */
    channel: text('channel'),
    campaign: text('campaign'),
    productId: integer('product_id').references(() => products.id),
    notes: text('notes'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('expenses_competence_idx').on(t.competenceDate),
    index('expenses_due_idx').on(t.dueDate, t.status),
    index('expenses_kind_idx').on(t.kind),
  ],
)

/* ------------------------------------------------------------------ *
 * Sócios: regras de divisão versionadas + retiradas
 * ------------------------------------------------------------------ */

export const partnerRules = pgTable(
  'partner_rules',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    /** Nulo = vale para todos os tipos de produto. */
    productType: productTypeEnum('product_type'),
    /** Percentuais com 2 casas: 10.00 = 10%. */
    companyPct: numeric('company_pct', { precision: 5, scale: 2 }).notNull(),
    yuriPct: numeric('yuri_pct', { precision: 5, scale: 2 }).notNull(),
    gustavoPct: numeric('gustavo_pct', { precision: 5, scale: 2 }).notNull(),
    /** net = sobre o líquido recebido; gross = sobre o bruto. */
    basis: text('basis').notNull().default('net'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('partner_rules_effective_idx').on(t.effectiveFrom, t.effectiveTo)],
)

export const partnerWithdrawals = pgTable(
  'partner_withdrawals',
  {
    id: serial('id').primaryKey(),
    partner: partnerEnum('partner').notNull(),
    amountCents: integer('amount_cents').notNull(),
    date: date('date').notNull(),
    accountId: integer('account_id').references(() => accounts.id),
    notes: text('notes'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('partner_withdrawals_date_idx').on(t.date, t.partner)],
)

/* ------------------------------------------------------------------ *
 * Fiscal
 * ------------------------------------------------------------------ */

export const taxProvisions = pgTable('tax_provisions', {
  id: serial('id').primaryKey(),
  /** Primeiro dia do mês de referência. */
  referenceMonth: date('reference_month').notNull(),
  label: text('label').notNull(),
  baseCents: integer('base_cents').notNull(),
  ratePct: numeric('rate_pct', { precision: 5, scale: 2 }).notNull(),
  amountCents: integer('amount_cents').notNull(),
  status: expenseStatusEnum('status').notNull().default('pending'),
  paidDate: date('paid_date'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/* ------------------------------------------------------------------ *
 * Metas, agenda, marcadores, jobs e configurações
 * ------------------------------------------------------------------ */

export const goals = pgTable('goals', {
  id: serial('id').primaryKey(),
  label: text('label').notNull(),
  /** monthly_revenue | annual_revenue | product | custom */
  kind: text('kind').notNull().default('monthly_revenue'),
  targetCents: integer('target_cents').notNull(),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  productId: integer('product_id').references(() => products.id),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: serial('id').primaryKey(),
    googleEventId: text('google_event_id').notNull(),
    calendarId: text('calendar_id').notNull(),
    title: text('title'),
    description: text('description'),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    attendeeEmail: text('attendee_email'),
    /** confirmed | tentative | cancelled */
    status: text('status'),
    isConsultation: boolean('is_consultation').notNull().default(true),
    customerId: integer('customer_id').references(() => customers.id),
    transactionId: integer('transaction_id').references(() => transactions.id),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('calendar_events_google_idx').on(t.googleEventId),
    index('calendar_events_start_idx').on(t.startAt),
  ],
)

export const timelineMarkers = pgTable('timeline_markers', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  type: markerTypeEnum('type').notNull().default('campaign'),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  description: text('description'),
  color: text('color'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const jobRuns = pgTable(
  'job_runs',
  {
    id: serial('id').primaryKey(),
    job: text('job').notNull(),
    status: jobStatusEnum('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    itemsProcessed: integer('items_processed').notNull().default(0),
    itemsCreated: integer('items_created').notNull().default(0),
    itemsDuplicated: integer('items_duplicated').notNull().default(0),
    error: text('error'),
    meta: jsonb('meta'),
  },
  (t) => [index('job_runs_job_idx').on(t.job, t.startedAt)],
)

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const aiReports = pgTable('ai_reports', {
  id: serial('id').primaryKey(),
  /** weekly | monthly | ad_hoc */
  kind: text('kind').notNull(),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  content: text('content').notNull(),
  model: text('model'),
  inputSnapshot: jsonb('input_snapshot'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/* ------------------------------------------------------------------ *
 * Tipos inferidos
 * ------------------------------------------------------------------ */

export type User = typeof users.$inferSelect
export type Account = typeof accounts.$inferSelect
export type RawEvent = typeof rawEvents.$inferSelect
export type Transaction = typeof transactions.$inferSelect
export type NewTransaction = typeof transactions.$inferInsert
export type Customer = typeof customers.$inferSelect
export type Product = typeof products.$inferSelect
export type ClassificationRule = typeof classificationRules.$inferSelect
export type Expense = typeof expenses.$inferSelect
export type NewExpense = typeof expenses.$inferInsert
export type PartnerRule = typeof partnerRules.$inferSelect
export type PartnerWithdrawal = typeof partnerWithdrawals.$inferSelect
export type TaxProvision = typeof taxProvisions.$inferSelect
export type Goal = typeof goals.$inferSelect
export type CalendarEvent = typeof calendarEvents.$inferSelect
export type TimelineMarker = typeof timelineMarkers.$inferSelect
export type JobRun = typeof jobRuns.$inferSelect
export type AiReport = typeof aiReports.$inferSelect
