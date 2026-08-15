import { desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { taxProvisions } from '@/lib/db/schema'
import { today, formatDateBR, monthLabel, currentMonth } from '@/lib/dates'
import { formatBRL, formatPercent, parseBRLToCents } from '@/lib/money'
import { getMeiStatus, getRbt12, simulateSimples, FATOR_R_THRESHOLD } from '@/lib/analytics/tax'
import { getRevenue } from '@/lib/analytics/queries'
import { computeSplit } from '@/lib/analytics/split'
import { createTaxProvision, markTaxPaid } from '@/lib/actions/expenses'
import { PageHeader } from '@/components/shell'
import { Card, Stat, Table, Th, Td, Money, Badge, Button, Field, Input, ProgressBar, EmptyState } from '@/components/ui/primitives'

export const dynamic = 'force-dynamic'

export default async function FiscalPage({
  searchParams,
}: {
  searchParams: Promise<{ folha?: string }>
}) {
  const params = await searchParams
  const month = currentMonth()

  const [mei, rbt12, revenue, split, provisions] = await Promise.all([
    getMeiStatus(),
    getRbt12(),
    getRevenue(month),
    computeSplit(month),
    db.select().from(taxProvisions).orderBy(desc(taxProvisions.referenceMonth)).limit(12),
  ])

  // Folha simulada: por padrão, o que os sócios já retiram — que é
  // exatamente o valor candidato a virar pró-labore formal.
  const defaultPayroll = split.yuriCents + split.gustavoCents
  const payrollCents = params.folha ? parseBRLToCents(params.folha) : defaultPayroll

  const simulation = simulateSimples(rbt12, revenue.grossCents, payrollCents)
  const withoutFatorR = simulateSimples(rbt12, revenue.grossCents, 0)

  const severityTone = {
    ok: 'good',
    atencao: 'warning',
    estourado: 'serious',
    critico: 'critical',
  }[mei.severity] as 'good' | 'warning' | 'serious' | 'critical'

  return (
    <>
      <PageHeader title="Fiscal" description={`Situação tributária · ${monthLabel(today())}`} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={`Faturamento ${mei.year}`}
          value={formatBRL(mei.accumulatedCents)}
          hint={`teto do MEI: ${formatBRL(mei.limitCents)}`}
          tone={mei.severity === 'ok' ? 'neutral' : 'critical'}
        />
        <Stat
          label="Excesso sobre o teto"
          value={formatBRL(mei.excessCents)}
          tone={mei.excessCents > 0 ? 'critical' : 'good'}
          hint={mei.exceedsTolerance ? 'acima da tolerância de 20%' : 'dentro da tolerância de 20%'}
        />
        <Stat label="Projeção do ano" value={formatBRL(mei.projectedYearEndCents)} hint="no ritmo atual" />
        <Stat label="RBT12" value={formatBRL(rbt12)} hint="base do Simples nos últimos 12 meses" />
      </div>

      <Card className="mt-3 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">Teto do MEI</p>
            <p className="mt-1.5 text-[15px] text-ink">{mei.message}</p>
            {mei.breachMonth && (
              <p className="mt-1 text-[13.5px] text-ink-2">
                O teto foi ultrapassado em <strong>{monthLabel(`${mei.breachMonth}-01`)}</strong>.
              </p>
            )}
          </div>
          <Badge tone={severityTone}>
            {mei.severity === 'ok'
              ? 'dentro do limite'
              : mei.severity === 'atencao'
                ? 'atenção'
                : mei.severity === 'estourado'
                  ? 'teto estourado'
                  : 'desenquadramento retroativo'}
          </Badge>
        </div>
        <ProgressBar
          className="mt-3"
          ratio={mei.usageRatio}
          tone={mei.usageRatio >= 1 ? 'critical' : mei.usageRatio > 0.8 ? 'warning' : 'good'}
          markers={[{ at: 1 / (1 + 0.2), label: 'Teto' }]}
        />
        <p className="mt-2 text-[12.5px] text-ink-muted">
          {formatPercent(mei.usageRatio)} do teto usado · tolerância até {formatBRL(mei.toleranceLimitCents)}
        </p>
      </Card>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card
          title="Simulador do Simples Nacional"
          subtitle="Quanto de imposto no cenário de CNPJ, com e sem Fator R"
        >
          <form className="grid gap-3 border-b border-hairline px-5 py-4 sm:grid-cols-3" method="get">
            <Field label="Folha / pró-labore mensal" hint="Padrão: o que vocês já retiram">
              <Input name="folha" defaultValue={formatBRL(payrollCents)} />
            </Field>
            <div className="flex items-end sm:col-span-2">
              <Button type="submit" variant="secondary">
                Recalcular
              </Button>
            </div>
          </form>

          <Table>
            <thead>
              <tr>
                <Th>Cenário</Th>
                <Th align="center">Anexo</Th>
                <Th align="right">Alíquota efetiva</Th>
                <Th align="right">Imposto no mês</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td className="text-ink">Com a folha informada</Td>
                <Td align="center">
                  <Badge tone={simulation.annex === 'III' ? 'good' : 'warning'}>Anexo {simulation.annex}</Badge>
                </Td>
                <Td align="right">{formatPercent(simulation.effectiveRate)}</Td>
                <Td align="right">
                  <Money cents={simulation.monthlyTaxCents} />
                </Td>
              </tr>
              <tr>
                <Td className="text-ink">Sem pró-labore</Td>
                <Td align="center">
                  <Badge tone="warning">Anexo {withoutFatorR.annex}</Badge>
                </Td>
                <Td align="right">{formatPercent(withoutFatorR.effectiveRate)}</Td>
                <Td align="right">
                  <Money cents={withoutFatorR.monthlyTaxCents} />
                </Td>
              </tr>
            </tbody>
          </Table>

          <div className="space-y-2 border-t border-hairline px-5 py-4 text-[13px] text-ink-2">
            <p>
              Fator R atual da simulação: <strong>{formatPercent(simulation.fatorR)}</strong> — o limite para cair
              no Anexo III é {formatPercent(FATOR_R_THRESHOLD)}.
            </p>
            <p>
              Para garantir o Anexo III, a folha mensal precisaria ser de pelo menos{' '}
              <strong>{formatBRL(simulation.payrollForAnnexIIICents)}</strong>.
            </p>
            <p className="text-ink-muted">
              Como vocês já retiram praticamente tudo, formalizar parte disso como pró-labore costuma ser a
              diferença entre pagar {formatPercent(withoutFatorR.effectiveRate)} e{' '}
              {formatPercent(simulation.effectiveRate)} de imposto. A diferença no mês seria de{' '}
              {formatBRL(Math.abs(withoutFatorR.monthlyTaxCents - simulation.monthlyTaxCents))}.
            </p>
            <p className="text-[12px] text-ink-muted">
              Simulação gerencial com as tabelas do Simples. Confirme com o contador antes de decidir a migração.
            </p>
          </div>
        </Card>

        <Card title="Provisões de imposto" subtitle="Separar o que é do governo antes de dividir">
          <form action={createTaxProvision} className="grid gap-3 border-b border-hairline px-5 py-4 sm:grid-cols-2">
            <Field label="Referência">
              <Input type="date" name="referenceMonth" defaultValue={month.start} />
            </Field>
            <Field label="Descrição">
              <Input name="label" defaultValue="Provisão mensal" />
            </Field>
            <Field label="Base de cálculo">
              <Input name="base" defaultValue={formatBRL(revenue.grossCents)} />
            </Field>
            <Field label="Alíquota (%)">
              <Input name="rate" defaultValue="6" inputMode="decimal" />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" className="w-full">
                Provisionar
              </Button>
            </div>
          </form>

          {provisions.length === 0 ? (
            <EmptyState title="Nenhuma provisão registrada" description="Provisionar mostra o caixa livre de verdade." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Referência</Th>
                  <Th>Descrição</Th>
                  <Th align="right">Alíquota</Th>
                  <Th align="right">Valor</Th>
                  <Th align="center">Estado</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {provisions.map((p) => (
                  <tr key={p.id}>
                    <Td>{monthLabel(p.referenceMonth, true)}</Td>
                    <Td className="text-ink">{p.label}</Td>
                    <Td align="right">{Number(p.ratePct)}%</Td>
                    <Td align="right">
                      <Money cents={p.amountCents} />
                    </Td>
                    <Td align="center">
                      <Badge tone={p.status === 'paid' ? 'good' : 'warning'}>
                        {p.status === 'paid' ? `pago em ${formatDateBR(p.paidDate)}` : 'em aberto'}
                      </Badge>
                    </Td>
                    <Td align="right">
                      {p.status !== 'paid' && (
                        <form action={markTaxPaid}>
                          <input type="hidden" name="id" value={p.id} />
                          <Button type="submit" variant="ghost" size="sm">
                            Marcar pago
                          </Button>
                        </form>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  )
}
