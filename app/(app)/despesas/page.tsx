import { and, desc, eq, gte, lte, ne } from 'drizzle-orm'
import { Check, Trash2 } from 'lucide-react'
import { db } from '@/lib/db'
import { expenses, expenseCategories } from '@/lib/db/schema'
import { currentMonth, formatDateBR, today, addDays, type Period } from '@/lib/dates'
import { formatBRL } from '@/lib/money'
import { getExpenses, getExpensesByCategory } from '@/lib/analytics/queries'
import { getCashPosition, forecastCash } from '@/lib/analytics/cashflow'
import { createExpense, markExpensePaid, deleteExpense } from '@/lib/actions/expenses'
import { PageHeader } from '@/components/shell'
import { Card, Stat, Table, Th, Td, Money, Badge, Button, Field, Input, Select, EmptyState } from '@/components/ui/primitives'
import { BreakdownChart, CashFlowChart } from '@/components/charts'

export const dynamic = 'force-dynamic'

const KIND_LABELS: Record<string, string> = {
  fixed_cost: 'Custo fixo',
  variable_cost: 'Custo variável',
  direct_cost: 'Custo direto',
  investment: 'Investimento',
  marketing: 'Marketing e tráfego',
  tax: 'Imposto',
  partner_withdrawal: 'Retirada de sócio',
}

export default async function DespesasPage({
  searchParams,
}: {
  searchParams: Promise<{ inicio?: string; fim?: string }>
}) {
  const params = await searchParams
  const period: Period =
    params.inicio && params.fim
      ? { start: params.inicio, end: params.fim, label: `${formatDateBR(params.inicio)} a ${formatDateBR(params.fim)}` }
      : currentMonth()

  const [summary, byCategory, categories, cash, forecast] = await Promise.all([
    getExpenses(period),
    getExpensesByCategory(period),
    db.select().from(expenseCategories).where(eq(expenseCategories.active, true)).orderBy(expenseCategories.name),
    getCashPosition(),
    forecastCash(90),
  ])

  const rows = await db
    .select({
      id: expenses.id,
      description: expenses.description,
      kind: expenses.kind,
      amountCents: expenses.amountCents,
      competenceDate: expenses.competenceDate,
      dueDate: expenses.dueDate,
      paidDate: expenses.paidDate,
      status: expenses.status,
      recurrence: expenses.recurrence,
      supplier: expenses.supplier,
      categoryName: expenseCategories.name,
    })
    .from(expenses)
    .leftJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
    .where(and(gte(expenses.competenceDate, period.start), lte(expenses.competenceDate, period.end)))
    .orderBy(desc(expenses.competenceDate))
    .limit(200)

  const upcoming = await db
    .select({
      id: expenses.id,
      description: expenses.description,
      amountCents: expenses.amountCents,
      dueDate: expenses.dueDate,
      status: expenses.status,
    })
    .from(expenses)
    .where(and(eq(expenses.status, 'pending'), ne(expenses.kind, 'partner_withdrawal'), lte(expenses.dueDate, addDays(today(), 45))))
    .orderBy(expenses.dueDate)
    .limit(15)

  return (
    <>
      <PageHeader title="Despesas e contas" description={`${period.label} · ${summary.count} lançamentos`} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total do período" value={formatBRL(summary.totalCents)} />
        <Stat label="Custo fixo" value={formatBRL(summary.byKind.fixed_cost ?? 0)} hint="estrutura recorrente" />
        <Stat label="Marketing" value={formatBRL(summary.byKind.marketing ?? 0)} hint="tráfego e mídia" />
        <Stat
          label="Contas em aberto"
          value={formatBRL(cash.payableCents)}
          tone={cash.payableCents > 0 ? 'warning' : 'neutral'}
          hint="a pagar no total"
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Previsão de caixa" subtitle="Próximos 90 dias com recebíveis e contas agendadas">
          <div className="px-2 pb-3 pt-4">
            <CashFlowChart data={forecast} />
          </div>
        </Card>

        <Card title="Novo lançamento" subtitle="Despesa, conta a pagar ou investimento">
          <form action={createExpense} className="space-y-3 px-5 py-4">
            <Field label="Descrição">
              <Input name="description" required placeholder="Ex.: assinatura Canva" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Valor">
                <Input name="amount" required placeholder="R$ 0,00" inputMode="decimal" />
              </Field>
              <Field label="Tipo">
                <Select name="kind" defaultValue="fixed_cost" className="w-full">
                  {Object.entries(KIND_LABELS)
                    .filter(([key]) => key !== 'partner_withdrawal')
                    .map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
            <Field label="Categoria">
              <Select name="categoryId" className="w-full" defaultValue="">
                <option value="">Sem categoria</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Competência">
                <Input type="date" name="competenceDate" defaultValue={today()} />
              </Field>
              <Field label="Vencimento">
                <Input type="date" name="dueDate" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Recorrência">
                <Select name="recurrence" defaultValue="none" className="w-full">
                  <option value="none">Única</option>
                  <option value="monthly">Mensal</option>
                  <option value="quarterly">Trimestral</option>
                  <option value="yearly">Anual</option>
                </Select>
              </Field>
              <Field label="Repetir por (meses)">
                <Input type="number" name="recurrenceMonths" defaultValue={12} min={1} max={36} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" name="paid" className="accent-[var(--series-1)]" />
              Já está paga
            </label>
            <Button type="submit" className="w-full">
              Lançar
            </Button>
          </form>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Por categoria" subtitle={period.label}>
          <div className="px-2 pb-3 pt-4">
            {byCategory.length > 0 ? (
              <BreakdownChart data={byCategory.slice(0, 8).map((c) => ({ label: c.label, valueCents: c.amountCents }))} />
            ) : (
              <EmptyState title="Nenhuma despesa no período" />
            )}
          </div>
        </Card>

        <Card title="A vencer" subtitle="Próximos 45 dias">
          {upcoming.length === 0 ? (
            <EmptyState title="Nada a vencer" description="Nenhuma conta pendente no horizonte." />
          ) : (
            <Table className="min-w-[420px]">
              <thead>
                <tr>
                  <Th>Conta</Th>
                  <Th>Vencimento</Th>
                  <Th align="right">Valor</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {upcoming.map((bill) => {
                  const overdue = bill.dueDate !== null && bill.dueDate < today()
                  return (
                    <tr key={bill.id}>
                      <Td className="text-ink">{bill.description}</Td>
                      <Td>
                        {formatDateBR(bill.dueDate)}
                        {overdue && (
                          <Badge tone="critical" className="ml-2">
                            vencida
                          </Badge>
                        )}
                      </Td>
                      <Td align="right">
                        <Money cents={bill.amountCents} />
                      </Td>
                      <Td align="right">
                        <form action={markExpensePaid}>
                          <input type="hidden" name="id" value={bill.id} />
                          <Button type="submit" variant="ghost" size="sm" title="Marcar como paga">
                            <Check size={15} />
                          </Button>
                        </form>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card className="mt-3" title="Lançamentos do período" subtitle={period.label}>
        {rows.length === 0 ? (
          <EmptyState title="Nenhuma despesa lançada" description="Use o formulário acima para registrar o primeiro gasto." />
        ) : (
          <Table className="min-w-[760px]">
            <thead>
              <tr>
                <Th>Descrição</Th>
                <Th>Categoria</Th>
                <Th>Tipo</Th>
                <Th>Competência</Th>
                <Th>Vencimento</Th>
                <Th align="center">Estado</Th>
                <Th align="right">Valor</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <Td className="text-ink">
                    {row.description}
                    {row.recurrence !== 'none' && (
                      <Badge tone="neutral" className="ml-2">
                        recorrente
                      </Badge>
                    )}
                  </Td>
                  <Td>{row.categoryName ?? '—'}</Td>
                  <Td>{KIND_LABELS[row.kind] ?? row.kind}</Td>
                  <Td>{formatDateBR(row.competenceDate)}</Td>
                  <Td>{formatDateBR(row.dueDate)}</Td>
                  <Td align="center">
                    <Badge tone={row.status === 'paid' ? 'good' : row.dueDate && row.dueDate < today() ? 'critical' : 'warning'}>
                      {row.status === 'paid' ? 'paga' : 'em aberto'}
                    </Badge>
                  </Td>
                  <Td align="right">
                    <Money cents={row.amountCents} />
                  </Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      {row.status !== 'paid' && (
                        <form action={markExpensePaid}>
                          <input type="hidden" name="id" value={row.id} />
                          <Button type="submit" variant="ghost" size="sm" title="Marcar como paga">
                            <Check size={15} />
                          </Button>
                        </form>
                      )}
                      <form action={deleteExpense}>
                        <input type="hidden" name="id" value={row.id} />
                        <Button type="submit" variant="ghost" size="sm" title="Excluir">
                          <Trash2 size={15} />
                        </Button>
                      </form>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  )
}
