CREATE TYPE "public"."account_kind" AS ENUM('operating', 'reserve', 'bank');--> statement-breakpoint
CREATE TYPE "public"."expense_kind" AS ENUM('fixed_cost', 'variable_cost', 'direct_cost', 'investment', 'marketing', 'tax', 'partner_withdrawal');--> statement-breakpoint
CREATE TYPE "public"."expense_status" AS ENUM('pending', 'paid', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."ingest_source" AS ENUM('webhook', 'api', 'internal_api', 'csv_upload', 'email', 'playwright', 'manual');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('running', 'success', 'error');--> statement-breakpoint
CREATE TYPE "public"."marker_type" AS ENUM('campaign', 'launch', 'appearance', 'seasonal', 'other');--> statement-breakpoint
CREATE TYPE "public"."partner" AS ENUM('yuri', 'gustavo', 'company');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('pix', 'credit_card', 'debit_card', 'boleto', 'transfer', 'other');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('infinitepay', 'kiwify', 'cakto', 'inter', 'manual');--> statement-breakpoint
CREATE TYPE "public"."product_type" AS ENUM('service', 'infoproduct', 'other');--> statement-breakpoint
CREATE TYPE "public"."recurrence" AS ENUM('none', 'weekly', 'monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."tx_kind" AS ENUM('sale', 'refund', 'chargeback', 'fee', 'transfer_in', 'transfer_out', 'withdrawal', 'other');--> statement-breakpoint
CREATE TYPE "public"."tx_status" AS ENUM('pending', 'approved', 'refunded', 'chargeback', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'partner');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"platform" "platform" NOT NULL,
	"kind" "account_kind" DEFAULT 'operating' NOT NULL,
	"external_ref" text,
	"balance_cents" integer DEFAULT 0 NOT NULL,
	"balance_updated_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"content" text NOT NULL,
	"model" text,
	"input_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"google_event_id" text NOT NULL,
	"calendar_id" text NOT NULL,
	"title" text,
	"description" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"attendee_email" text,
	"status" text,
	"is_consultation" boolean DEFAULT true NOT NULL,
	"customer_id" integer,
	"transaction_id" integer,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classification_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"platform" "platform",
	"match_field" text DEFAULT 'any' NOT NULL,
	"match_type" text DEFAULT 'contains' NOT NULL,
	"pattern" text,
	"min_cents" integer,
	"max_cents" integer,
	"method" "payment_method",
	"product_id" integer,
	"kind" "tx_kind",
	"origin" text,
	"active" boolean DEFAULT true NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"email" text,
	"phone" text,
	"document" text,
	"first_purchase_at" date,
	"last_purchase_at" date,
	"purchase_count" integer DEFAULT 0 NOT NULL,
	"total_net_cents" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "expense_kind" DEFAULT 'fixed_cost' NOT NULL,
	"color" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"category_id" integer,
	"kind" "expense_kind" DEFAULT 'fixed_cost' NOT NULL,
	"amount_cents" integer NOT NULL,
	"competence_date" date NOT NULL,
	"due_date" date,
	"paid_date" date,
	"status" "expense_status" DEFAULT 'pending' NOT NULL,
	"recurrence" "recurrence" DEFAULT 'none' NOT NULL,
	"recurrence_parent_id" integer,
	"recurrence_until" date,
	"account_id" integer,
	"supplier" text,
	"channel" text,
	"campaign" text,
	"product_id" integer,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'monthly_revenue' NOT NULL,
	"target_cents" integer NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"product_id" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"status" "job_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"items_created" integer DEFAULT 0 NOT NULL,
	"items_duplicated" integer DEFAULT 0 NOT NULL,
	"error" text,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "partner_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"product_type" "product_type",
	"company_pct" numeric(5, 2) NOT NULL,
	"yuri_pct" numeric(5, 2) NOT NULL,
	"gustavo_pct" numeric(5, 2) NOT NULL,
	"basis" text DEFAULT 'net' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_withdrawals" (
	"id" serial PRIMARY KEY NOT NULL,
	"partner" "partner" NOT NULL,
	"amount_cents" integer NOT NULL,
	"date" date NOT NULL,
	"account_id" integer,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "product_type" DEFAULT 'service' NOT NULL,
	"default_price_cents" integer,
	"duration_minutes" integer,
	"unit_cost_cents" integer DEFAULT 0 NOT NULL,
	"platform" "platform",
	"external_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" "platform" NOT NULL,
	"source" "ingest_source" NOT NULL,
	"external_id" text,
	"payload" jsonb NOT NULL,
	"batch_ref" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_provisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference_month" date NOT NULL,
	"label" text NOT NULL,
	"base_cents" integer NOT NULL,
	"rate_pct" numeric(5, 2) NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "expense_status" DEFAULT 'pending' NOT NULL,
	"paid_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_markers" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"type" "marker_type" DEFAULT 'campaign' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"description" text,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer,
	"platform" "platform" NOT NULL,
	"source" "ingest_source" NOT NULL,
	"external_id" text,
	"dedupe_hash" text NOT NULL,
	"kind" "tx_kind" DEFAULT 'sale' NOT NULL,
	"status" "tx_status" DEFAULT 'approved' NOT NULL,
	"method" "payment_method",
	"installments" integer DEFAULT 1 NOT NULL,
	"gross_cents" integer NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"net_cents" integer NOT NULL,
	"sale_date" date NOT NULL,
	"receipt_date" date,
	"description" text,
	"counterparty_name" text,
	"counterparty_email" text,
	"counterparty_phone" text,
	"counterparty_document" text,
	"customer_id" integer,
	"product_id" integer,
	"origin" text,
	"classified_by" text,
	"classification_rule_id" integer,
	"needs_review" boolean DEFAULT false NOT NULL,
	"raw_event_id" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'partner' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_rules" ADD CONSTRAINT "classification_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_withdrawals" ADD CONSTRAINT "partner_withdrawals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_withdrawals" ADD CONSTRAINT "partner_withdrawals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_google_idx" ON "calendar_events" USING btree ("google_event_id");--> statement-breakpoint
CREATE INDEX "calendar_events_start_idx" ON "calendar_events" USING btree ("start_at");--> statement-breakpoint
CREATE INDEX "customers_normalized_idx" ON "customers" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "customers_email_idx" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "expenses_competence_idx" ON "expenses" USING btree ("competence_date");--> statement-breakpoint
CREATE INDEX "expenses_due_idx" ON "expenses" USING btree ("due_date","status");--> statement-breakpoint
CREATE INDEX "expenses_kind_idx" ON "expenses" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "job_runs_job_idx" ON "job_runs" USING btree ("job","started_at");--> statement-breakpoint
CREATE INDEX "partner_rules_effective_idx" ON "partner_rules" USING btree ("effective_from","effective_to");--> statement-breakpoint
CREATE INDEX "partner_withdrawals_date_idx" ON "partner_withdrawals" USING btree ("date","partner");--> statement-breakpoint
CREATE INDEX "raw_events_platform_idx" ON "raw_events" USING btree ("platform","received_at");--> statement-breakpoint
CREATE INDEX "raw_events_external_idx" ON "raw_events" USING btree ("platform","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_dedupe_idx" ON "transactions" USING btree ("dedupe_hash");--> statement-breakpoint
CREATE INDEX "transactions_sale_date_idx" ON "transactions" USING btree ("sale_date");--> statement-breakpoint
CREATE INDEX "transactions_receipt_date_idx" ON "transactions" USING btree ("receipt_date");--> statement-breakpoint
CREATE INDEX "transactions_platform_idx" ON "transactions" USING btree ("platform","sale_date");--> statement-breakpoint
CREATE INDEX "transactions_customer_idx" ON "transactions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "transactions_product_idx" ON "transactions" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "transactions_review_idx" ON "transactions" USING btree ("needs_review");