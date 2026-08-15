import { eq, desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { transactions, products, classificationRules } from '@/lib/db/schema'
import { formatDateBR } from '@/lib/dates'
import { formatBRL } from '@/lib/money'
import { classifyTransaction, reapplyRules } from '@/lib/actions/classification'
import { PLATFORM_LABELS, KIND_LABELS } from '@/lib/analytics/transactions'
import { PageHeader } from '@/components/shell'
import { Card, Table, Th, Td, Money, Badge, EmptyState, Button } from '@/components/ui/primitives'

export const dynamic = 'force-dynamic'

export default async function ClassificarPage() {
  const [pending, productList, rules] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(eq(transactions.needsReview, true))
      .orderBy(desc(transactions.saleDate))
      .limit(100),
    db.select().from(products).where(eq(products.active, true)).orderBy(products.name),
    db.select().from(classificationRules).orderBy(desc(classificationRules.hitCount)).limit(20),
  ])

  async function reapply() {
    'use server'
    await reapplyRules()
  }

  return (
    <>
      <PageHeader
        title="Classificar receitas"
        description="Toda transação sem serviço identificado cai aqui. Marque 'criar regra' e as próximas iguais entram classificadas sozinhas."
        action={
          <form action={reapply}>
            <Button type="submit" variant="secondary">
              Reaplicar regras
            </Button>
          </form>
        }
      />

      {pending.length === 0 ? (
        <Card>
          <EmptyState
            title="Nada pendente"
            description="Todas as transações estão classificadas. Novas importações que não casarem com nenhuma regra aparecem aqui."
          />
        </Card>
      ) : (
        <Card title={`${pending.length} transações pendentes`} subtitle="Da mais recente para a mais antiga">
          <Table className="min-w-[900px]">
            <thead>
              <tr>
                <Th>Data</Th>
                <Th>Descrição</Th>
                <Th>Pagador</Th>
                <Th align="right">Valor</Th>
                <Th>Classificar como</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {pending.map((tx) => (
                <tr key={tx.id}>
                  <Td className="whitespace-nowrap">{formatDateBR(tx.saleDate)}</Td>
                  <Td>
                    <span className="text-ink">{tx.description ?? '—'}</span>
                    <span className="ml-2 text-[12px] text-ink-muted">
                      {PLATFORM_LABELS[tx.platform] ?? tx.platform}
                    </span>
                  </Td>
                  <Td>{tx.counterpartyName ?? '—'}</Td>
                  <Td align="right">
                    <Money cents={tx.grossCents} />
                  </Td>
                  <Td colSpan={2}>
                    <form action={classifyTransaction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="transactionId" value={tx.id} />
                      <select
                        name="productId"
                        defaultValue=""
                        className="rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[13px] text-ink"
                      >
                        <option value="">Selecione o serviço</option>
                        {productList.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                            {product.defaultPriceCents ? ` — ${formatBRL(product.defaultPriceCents)}` : ''}
                          </option>
                        ))}
                      </select>
                      <select
                        name="kind"
                        defaultValue={tx.kind}
                        className="rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[13px] text-ink"
                      >
                        {Object.entries(KIND_LABELS).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        name="origin"
                        placeholder="origem (opcional)"
                        defaultValue={tx.origin ?? ''}
                        className="w-[150px] rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[13px] text-ink"
                      />
                      <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
                        <input type="checkbox" name="createRule" defaultChecked className="accent-[var(--series-1)]" />
                        criar regra
                      </label>
                      <Button type="submit" size="sm">
                        Salvar
                      </Button>
                    </form>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {rules.length > 0 && (
        <Card className="mt-3" title="Regras ativas" subtitle="Ordenadas pelo número de acertos">
          <Table>
            <thead>
              <tr>
                <Th>Regra</Th>
                <Th>Critério</Th>
                <Th align="right">Acertos</Th>
                <Th align="center">Estado</Th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <Td className="text-ink">{rule.name}</Td>
                  <Td className="text-[12.5px]">
                    {rule.pattern
                      ? `texto contém "${rule.pattern}"`
                      : rule.minCents !== null
                        ? `valor entre ${formatBRL(rule.minCents)} e ${formatBRL(rule.maxCents ?? rule.minCents)}`
                        : '—'}
                  </Td>
                  <Td align="right">{rule.hitCount}</Td>
                  <Td align="center">
                    <Badge tone={rule.active ? 'good' : 'neutral'}>{rule.active ? 'ativa' : 'inativa'}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  )
}
