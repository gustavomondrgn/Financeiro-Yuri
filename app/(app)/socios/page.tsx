import { desc, and, gte, lte } from 'drizzle-orm'
import { Trash2 } from 'lucide-react'
import { db } from '@/lib/db'
import { partnerWithdrawals } from '@/lib/db/schema'
import { currentMonth, lastNMonths, formatDateBR, today, monthLabel } from '@/lib/dates'
import { formatBRL, formatPercent } from '@/lib/money'
import { computeSplit, getRules, getRuleFor, revenueNeededFor, netToGross } from '@/lib/analytics/split'
import { getRevenue } from '@/lib/analytics/queries'
import { getSetting } from '@/lib/settings'
import { createPartnerRule, updatePartnerFloor } from '@/lib/actions/partners'
import { createWithdrawal, deleteWithdrawal } from '@/lib/actions/expenses'
import { PageHeader } from '@/components/shell'
import { Card, Stat, Table, Th, Td, Money, Badge, Button, Field, Input, Select, ProgressBar } from '@/components/ui/primitives'
import { StackedMixChart } from '@/components/charts'

export const dynamic = 'force-dynamic'

export default async function SociosPage() {
  const month = currentMonth()
  const [split, rules, revenue, floor] = await Promise.all([
    computeSplit(month),
    getRules(),
    getRevenue(month),
    getSetting('partner_floor'),
  ])

  const activeRule = await getRuleFor(today(), null)
  const feeRatio = revenue.grossCents > 0 ? revenue.feeCents / revenue.grossCents : 0

  const neededNetYuri = activeRule ? revenueNeededFor(floor.yuriCents, 'yuri', activeRule) : null
  const neededGrossYuri = neededNetYuri !== null ? netToGross(neededNetYuri, feeRatio) : null

  const withdrawals = await db
    .select()
    .from(partnerWithdrawals)
    .orderBy(desc(partnerWithdrawals.date))
    .limit(30)

  // Histórico de divisão dos últimos 6 meses.
  const months = lastNMonths(6)
  const historySplits = await Promise.all(months.map((m) => computeSplit(m)))
  const historyData = months.map((m, index) => ({
    label: monthLabel(m.start, true),
    caixa: historySplits[index].companyCents / 100,
    yuri: historySplits[index].yuriCents / 100,
    gustavo: historySplits[index].gustavoCents / 100,
  }))

  return (
    <>
      <PageHeader
        title="Sócios"
        description={`${month.label} · regra vigente ${activeRule ? `${Number(activeRule.companyPct)}% caixa · ${Number(activeRule.yuriPct)}/${Number(activeRule.gustavoPct)}` : 'não definida'}`}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Base do mês (líquido)" value={formatBRL(split.baseCents)} hint="depois das taxas" />
        <Stat label="Caixa da empresa" value={formatBRL(split.companyCents)} />
        <Stat
          label="Yuri — a receber"
          value={formatBRL(split.balance.yuri)}
          hint={`devido ${formatBRL(split.yuriCents)} · retirado ${formatBRL(split.withdrawals.yuri)}`}
          tone={split.balance.yuri < 0 ? 'warning' : 'neutral'}
        />
        <Stat
          label="Gustavo — a receber"
          value={formatBRL(split.balance.gustavo)}
          hint={`devido ${formatBRL(split.gustavoCents)} · retirado ${formatBRL(split.withdrawals.gustavo)}`}
          tone={split.balance.gustavo < 0 ? 'warning' : 'neutral'}
        />
      </div>

      {neededGrossYuri !== null && (
        <Card className="mt-3 px-5 py-4">
          <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">
            Piso de retirada do Yuri
          </p>
          <p className="mt-1.5 text-[15px] text-ink">
            Para o Yuri retirar <strong>{formatBRL(floor.yuriCents)}</strong> neste mês, o faturamento bruto
            precisa chegar a <strong className="tabular">{formatBRL(neededGrossYuri)}</strong>
            <span className="text-ink-muted"> (líquido de {formatBRL(neededNetYuri!)}, à taxa efetiva de {formatPercent(feeRatio)})</span>.
          </p>
          <p className="mt-1 text-[13.5px] text-ink-2">
            {revenue.grossCents >= neededGrossYuri ? (
              <span className="text-[var(--good-text)]">Já alcançado neste mês.</span>
            ) : (
              <>
                Faltam <strong className="tabular">{formatBRL(neededGrossYuri - revenue.grossCents)}</strong> de
                faturamento.
              </>
            )}
          </p>
          <ProgressBar
            className="mt-3"
            ratio={revenue.grossCents / neededGrossYuri}
            tone={revenue.grossCents >= neededGrossYuri ? 'good' : 'info'}
          />
        </Card>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Divisão mês a mês" subtitle="Últimos 6 meses pela regra vigente em cada data">
          <div className="px-2 pb-3 pt-4">
            <StackedMixChart
              data={historyData}
              keys={[
                { key: 'yuri', label: 'Yuri' },
                { key: 'gustavo', label: 'Gustavo' },
                { key: 'caixa', label: 'Caixa da empresa' },
              ]}
            />
          </div>
        </Card>

        <Card title="Piso de sobrevivência" subtitle="Quanto cada sócio precisa por mês">
          <form action={updatePartnerFloor} className="space-y-3 px-5 py-4">
            <Field label="Yuri" hint="Usado no cálculo de faturamento mínimo">
              <Input name="yuri" defaultValue={formatBRL(floor.yuriCents)} />
            </Field>
            <Field label="Gustavo">
              <Input name="gustavo" defaultValue={formatBRL(floor.gustavoCents)} />
            </Field>
            <Button type="submit" variant="secondary" className="w-full">
              Salvar
            </Button>
          </form>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Regras de divisão" subtitle="Versionadas por vigência e tipo de produto">
          <Table className="min-w-[520px]">
            <thead>
              <tr>
                <Th>Vigência</Th>
                <Th>Escopo</Th>
                <Th align="right">Caixa</Th>
                <Th align="right">Yuri</Th>
                <Th align="right">Gustavo</Th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => {
                const active = rule.effectiveFrom <= today() && (!rule.effectiveTo || rule.effectiveTo >= today())
                return (
                  <tr key={rule.id}>
                    <Td>
                      {formatDateBR(rule.effectiveFrom)} — {rule.effectiveTo ? formatDateBR(rule.effectiveTo) : 'hoje'}
                      {active && (
                        <Badge tone="good" className="ml-2">
                          vigente
                        </Badge>
                      )}
                    </Td>
                    <Td>
                      {rule.productType === 'service'
                        ? 'Serviços'
                        : rule.productType === 'infoproduct'
                          ? 'Infoprodutos'
                          : 'Geral'}
                    </Td>
                    <Td align="right">{Number(rule.companyPct)}%</Td>
                    <Td align="right">{Number(rule.yuriPct)}%</Td>
                    <Td align="right">{Number(rule.gustavoPct)}%</Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>

          <form action={createPartnerRule} className="space-y-3 border-t border-hairline px-5 py-4">
            <p className="text-[13px] font-medium text-ink">Nova vigência</p>
            <p className="text-[12.5px] text-ink-muted">
              O caixa fica com sua fatia do líquido; Yuri e Gustavo dividem o que sobra (precisa somar 100%).
              Criar aqui fecha a regra anterior sem alterar meses já fechados.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="A partir de">
                <Input type="date" name="effectiveFrom" required />
              </Field>
              <Field label="Aplica a">
                <Select name="productType" defaultValue="" className="w-full">
                  <option value="">Tudo</option>
                  <option value="service">Só serviços</option>
                  <option value="infoproduct">Só infoprodutos</option>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Caixa %">
                <Input name="companyPct" defaultValue="10" inputMode="decimal" />
              </Field>
              <Field label="Yuri %">
                <Input name="yuriPct" defaultValue="80" inputMode="decimal" />
              </Field>
              <Field label="Gustavo %">
                <Input name="gustavoPct" defaultValue="20" inputMode="decimal" />
              </Field>
            </div>
            <Field label="Nome">
              <Input name="name" placeholder="Ex.: Escola de astrologia 50/50" />
            </Field>
            <Button type="submit" className="w-full">
              Criar vigência
            </Button>
          </form>
        </Card>

        <Card title="Retiradas" subtitle="Registro de quanto cada sócio já tirou">
          <form action={createWithdrawal} className="grid gap-3 border-b border-hairline px-5 py-4 sm:grid-cols-4">
            <Field label="Sócio">
              <Select name="partner" defaultValue="yuri" className="w-full">
                <option value="yuri">Yuri</option>
                <option value="gustavo">Gustavo</option>
                <option value="company">Caixa da empresa</option>
              </Select>
            </Field>
            <Field label="Valor">
              <Input name="amount" placeholder="R$ 0,00" required />
            </Field>
            <Field label="Data">
              <Input type="date" name="date" defaultValue={today()} />
            </Field>
            <div className="flex items-end">
              <Button type="submit" className="w-full">
                Registrar
              </Button>
            </div>
          </form>

          <Table className="min-w-[420px]">
            <thead>
              <tr>
                <Th>Data</Th>
                <Th>Sócio</Th>
                <Th align="right">Valor</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {withdrawals.map((w) => (
                <tr key={w.id}>
                  <Td>{formatDateBR(w.date)}</Td>
                  <Td className="capitalize">{w.partner === 'company' ? 'Caixa' : w.partner}</Td>
                  <Td align="right">
                    <Money cents={w.amountCents} />
                  </Td>
                  <Td align="right">
                    <form action={deleteWithdrawal}>
                      <input type="hidden" name="id" value={w.id} />
                      <Button type="submit" variant="ghost" size="sm" title="Excluir">
                        <Trash2 size={15} />
                      </Button>
                    </form>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  )
}
