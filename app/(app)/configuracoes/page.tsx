import { desc, eq } from 'drizzle-orm'
import { CheckCircle2, XCircle } from 'lucide-react'
import { db } from '@/lib/db'
import { products, accounts, users, timelineMarkers, jobRuns } from '@/lib/db/schema'
import { env } from '@/lib/env'
import { requireSession } from '@/lib/auth'
import { formatBRL } from '@/lib/money'
import { formatDateBR, formatDateTimeBR, today } from '@/lib/dates'
import { getSetting } from '@/lib/settings'
import {
  saveProduct,
  saveCapacity,
  saveGoal,
  saveTaxSetting,
  saveAccountBalance,
  createAccount,
  changePassword,
  createMarker,
} from '@/lib/actions/settings'
import { PageHeader } from '@/components/shell'
import { Card, Table, Th, Td, Money, Badge, Button, Field, Input, Select } from '@/components/ui/primitives'

export const dynamic = 'force-dynamic'

export default async function ConfiguracoesPage() {
  const session = await requireSession()

  const [productList, accountList, userList, markers, runs, capacity, goal, tax] = await Promise.all([
    db.select().from(products).orderBy(products.type, products.name),
    db.select().from(accounts).orderBy(accounts.name),
    db.select().from(users).orderBy(users.name),
    db.select().from(timelineMarkers).orderBy(desc(timelineMarkers.startDate)).limit(12),
    db.select().from(jobRuns).where(eq(jobRuns.status, 'error')).orderBy(desc(jobRuns.startedAt)).limit(5),
    getSetting('capacity'),
    getSetting('goal'),
    getSetting('tax'),
  ])

  const integrations = [
    { name: 'Kiwify', ok: env.kiwify.configured, hint: 'client id, secret e account id' },
    { name: 'Cakto', ok: env.cakto.configured, hint: 'token da API' },
    { name: 'InfinitePay (API interna)', ok: env.infinitepay.configured, hint: 'token de sessão — depende do HAR' },
    { name: 'Google Calendar', ok: env.google.configured, hint: 'client id, secret e refresh token' },
    { name: 'Analista de IA', ok: env.anthropic.configured, hint: 'ANTHROPIC_API_KEY' },
    { name: 'E-mail (SMTP)', ok: env.smtp.configured, hint: 'host, usuário e destinatários' },
    { name: 'Caixa de entrada (IMAP)', ok: env.imap.configured, hint: 'para ingestão do extrato por e-mail' },
  ]

  return (
    <>
      <PageHeader title="Configurações" description="Cadastros, integrações e preferências do sistema" />

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Integrações" subtitle="O que já está ligado">
          <Table>
            <tbody>
              {integrations.map((integration) => (
                <tr key={integration.name}>
                  <Td className="text-ink">{integration.name}</Td>
                  <Td className="text-[12.5px]">{integration.hint}</Td>
                  <Td align="right">
                    {integration.ok ? (
                      <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--good-text)]">
                        <CheckCircle2 size={15} /> ativa
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted">
                        <XCircle size={15} /> pendente
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {runs.length > 0 && (
            <div className="border-t border-hairline px-5 py-4">
              <p className="mb-2 text-[13px] font-medium text-[var(--critical)]">Últimas falhas de sincronização</p>
              <ul className="space-y-1.5 text-[12.5px] text-ink-muted">
                {runs.map((run) => (
                  <li key={run.id}>
                    <strong className="text-ink-2">{run.job}</strong> · {formatDateTimeBR(run.startedAt)} —{' '}
                    {(run.error ?? '').slice(0, 120)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Metas e capacidade" subtitle="Parâmetros que alimentam os cálculos">
          <form action={saveGoal} className="grid gap-3 border-b border-hairline px-5 py-4 sm:grid-cols-3">
            <Field label="Meta mensal">
              <Input name="target" defaultValue={formatBRL(goal.targetCents)} />
            </Field>
            <Field label="Prazo">
              <Input type="date" name="deadline" defaultValue={goal.deadline} />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="secondary" className="w-full">
                Salvar meta
              </Button>
            </div>
          </form>

          <form action={saveCapacity} className="grid gap-3 border-b border-hairline px-5 py-4 sm:grid-cols-3">
            <Field label="Horas por semana">
              <Input type="number" name="weeklyHours" defaultValue={capacity.weeklyHours} min={1} max={80} />
            </Field>
            <Field label="Duração média (min)">
              <Input
                type="number"
                name="averageSessionMinutes"
                defaultValue={capacity.averageSessionMinutes}
                min={15}
                max={240}
              />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="secondary" className="w-full">
                Salvar agenda
              </Button>
            </div>
          </form>

          <form action={saveTaxSetting} className="grid gap-3 px-5 py-4 sm:grid-cols-3">
            <Field label="DAS mensal do MEI">
              <Input name="das" defaultValue={formatBRL(tax.meiMonthlyDasCents)} />
            </Field>
            <Field label="Alíquota de provisão (%)">
              <Input name="rate" defaultValue={String(tax.provisionRate)} inputMode="decimal" />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="secondary" className="w-full">
                Salvar fiscal
              </Button>
            </div>
          </form>
        </Card>
      </div>

      <Card className="mt-3" title="Serviços e produtos" subtitle="Base da classificação e do cálculo de margem">
        <Table className="min-w-[720px]">
          <thead>
            <tr>
              <Th>Nome</Th>
              <Th>Tipo</Th>
              <Th align="right">Preço</Th>
              <Th align="right">Duração</Th>
              <Th align="right">Custo unitário</Th>
              <Th align="center">Ativo</Th>
            </tr>
          </thead>
          <tbody>
            {productList.map((product) => (
              <tr key={product.id}>
                <Td>
                  <form action={saveProduct} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={product.id} />
                    <Input name="name" defaultValue={product.name} className="w-[220px]" />
                    <Select name="type" defaultValue={product.type}>
                      <option value="service">Serviço</option>
                      <option value="infoproduct">Infoproduto</option>
                      <option value="other">Outro</option>
                    </Select>
                    <Input
                      name="price"
                      defaultValue={product.defaultPriceCents ? formatBRL(product.defaultPriceCents) : ''}
                      placeholder="preço"
                      className="w-[120px]"
                    />
                    <Input
                      name="duration"
                      type="number"
                      defaultValue={product.durationMinutes ?? ''}
                      placeholder="min"
                      className="w-[80px]"
                    />
                    <Input
                      name="unitCost"
                      defaultValue={product.unitCostCents ? formatBRL(product.unitCostCents) : ''}
                      placeholder="custo"
                      className="w-[110px]"
                    />
                    <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
                      <input type="checkbox" name="active" defaultChecked={product.active} className="accent-[var(--series-1)]" />
                      ativo
                    </label>
                    <Button type="submit" size="sm" variant="secondary">
                      Salvar
                    </Button>
                  </form>
                </Td>
                <Td colSpan={5} />
              </tr>
            ))}
          </tbody>
        </Table>

        <form action={saveProduct} className="grid gap-3 border-t border-hairline px-5 py-4 sm:grid-cols-6">
          <Field label="Novo serviço">
            <Input name="name" placeholder="Nome" required />
          </Field>
          <Field label="Tipo">
            <Select name="type" defaultValue="service" className="w-full">
              <option value="service">Serviço</option>
              <option value="infoproduct">Infoproduto</option>
              <option value="other">Outro</option>
            </Select>
          </Field>
          <Field label="Preço">
            <Input name="price" placeholder="R$ 0,00" />
          </Field>
          <Field label="Duração (min)">
            <Input type="number" name="duration" placeholder="60" />
          </Field>
          <Field label="Custo unitário">
            <Input name="unitCost" placeholder="R$ 0,00" />
          </Field>
          <div className="flex items-end">
            <Button type="submit" className="w-full">
              Adicionar
            </Button>
          </div>
        </form>
      </Card>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Contas" subtitle="Saldos usados no caixa e no runway">
          <Table>
            <thead>
              <tr>
                <Th>Conta</Th>
                <Th>Tipo</Th>
                <Th align="right">Saldo</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {accountList.map((account) => (
                <tr key={account.id}>
                  <Td className="text-ink">{account.name}</Td>
                  <Td>
                    {account.kind === 'reserve' ? 'Caixa da empresa' : account.kind === 'bank' ? 'Banco' : 'Operacional'}
                  </Td>
                  <Td align="right">
                    <Money cents={account.balanceCents} />
                  </Td>
                  <Td align="right">
                    <form action={saveAccountBalance} className="flex items-center justify-end gap-1.5">
                      <input type="hidden" name="id" value={account.id} />
                      <Input name="balance" placeholder="novo saldo" className="w-[130px]" />
                      <Button type="submit" size="sm" variant="secondary">
                        Atualizar
                      </Button>
                    </form>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          <form action={createAccount} className="grid gap-3 border-t border-hairline px-5 py-4 sm:grid-cols-4">
            <Field label="Nova conta">
              <Input name="name" placeholder="Ex.: Inter PJ" required />
            </Field>
            <Field label="Plataforma">
              <Select name="platform" defaultValue="inter" className="w-full">
                <option value="infinitepay">InfinitePay</option>
                <option value="inter">Banco Inter</option>
                <option value="manual">Outra</option>
              </Select>
            </Field>
            <Field label="Tipo">
              <Select name="kind" defaultValue="bank" className="w-full">
                <option value="operating">Operacional</option>
                <option value="reserve">Caixa da empresa</option>
                <option value="bank">Banco</option>
              </Select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" className="w-full">
                Criar
              </Button>
            </div>
          </form>
        </Card>

        <Card title="Marcadores da linha do tempo" subtitle="Campanhas e lançamentos, para ler o efeito na receita">
          <form action={createMarker} className="grid gap-3 border-b border-hairline px-5 py-4 sm:grid-cols-4">
            <Field label="Título">
              <Input name="title" placeholder="Ex.: Campanha de retorno" required />
            </Field>
            <Field label="Tipo">
              <Select name="type" defaultValue="campaign" className="w-full">
                <option value="campaign">Campanha</option>
                <option value="launch">Lançamento</option>
                <option value="appearance">Aparição / mídia</option>
                <option value="seasonal">Sazonal</option>
                <option value="other">Outro</option>
              </Select>
            </Field>
            <Field label="Início">
              <Input type="date" name="startDate" defaultValue={today()} />
            </Field>
            <div className="flex items-end">
              <Button type="submit" className="w-full">
                Marcar
              </Button>
            </div>
          </form>

          <Table>
            <tbody>
              {markers.map((marker) => (
                <tr key={marker.id}>
                  <Td className="text-ink">{marker.title}</Td>
                  <Td>{formatDateBR(marker.startDate)}</Td>
                  <Td align="right">
                    <Badge tone="neutral">{marker.type}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Usuários" subtitle="Quem tem acesso ao painel">
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>E-mail</Th>
                <Th>Papel</Th>
                <Th>Último acesso</Th>
              </tr>
            </thead>
            <tbody>
              {userList.map((user) => (
                <tr key={user.id}>
                  <Td className="text-ink">{user.name}</Td>
                  <Td>{user.email}</Td>
                  <Td>{user.role === 'owner' ? 'Administrador' : 'Sócio'}</Td>
                  <Td>{user.lastLoginAt ? formatDateTimeBR(user.lastLoginAt) : 'nunca'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card title="Trocar minha senha" subtitle={session.email}>
          <form action={changePassword} className="space-y-3 px-5 py-4">
            <Field label="Senha atual">
              <Input type="password" name="current" required autoComplete="current-password" />
            </Field>
            <Field label="Nova senha" hint="Mínimo de 10 caracteres">
              <Input type="password" name="next" required minLength={10} autoComplete="new-password" />
            </Field>
            <Button type="submit" className="w-full">
              Alterar senha
            </Button>
          </form>
        </Card>
      </div>
    </>
  )
}
