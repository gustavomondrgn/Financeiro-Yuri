'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { syncNow, type SyncActionState } from '@/lib/actions/sync'
import { Card, Button, Badge } from '@/components/ui/primitives'

/**
 * Sincronização da InfinitePay pela tela.
 *
 * Existe para o backfill não depender de `curl` com token: a janela larga é um
 * botão. A operação é repetível — a deduplicação cuida de rodar de novo.
 */

function SubmitButton({
  dias,
  variant,
  children,
}: {
  dias: number
  variant: 'primary' | 'secondary'
  children: React.ReactNode
}) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" name="dias" value={String(dias)} variant={variant} disabled={pending}>
      {pending ? 'Sincronizando…' : children}
    </Button>
  )
}

export function SyncPanel({ configured }: { configured: boolean }) {
  const [state, action] = useActionState<SyncActionState | null, FormData>(syncNow, null)

  return (
    <Card
      className="mt-3"
      title="Sincronizar com a InfinitePay"
      subtitle="Busca vendas e saídas direto da conta, sem planilha"
    >
      <div className="px-5 py-4">
        {!configured && (
          <p className="mb-3 text-[13px] text-ink-muted">
            Falta o token de sessão. Defina <code>INFINITEPAY_SESSION_TOKEN</code> nas variáveis de
            ambiente — o passo a passo está em <code>docs/infinitepay-api.md</code>.
          </p>
        )}

        <form action={action} className="flex flex-wrap items-center gap-2">
          <SubmitButton dias={15} variant="primary">
            Últimos 15 dias
          </SubmitButton>
          <SubmitButton dias={90} variant="secondary">
            Últimos 90 dias
          </SubmitButton>
          <SubmitButton dias={3000} variant="secondary">
            Histórico completo
          </SubmitButton>
        </form>

        <p className="mt-3 text-[12.5px] text-ink-muted">
          O histórico completo pode levar alguns minutos na primeira vez. Rodar de novo não duplica
          nada: vendas que já existem são reconhecidas, e as que mudaram de status são corrigidas.
        </p>

        {state && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge tone={state.ok ? 'good' : 'critical'}>{state.ok ? 'concluído' : 'erro'}</Badge>
            <span className="text-[13px] text-ink">{state.message}</span>
            {state.detail && <span className="text-[12.5px] text-ink-muted">{state.detail}</span>}
          </div>
        )}
      </div>
    </Card>
  )
}
