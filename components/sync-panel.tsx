'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { syncNow, type SyncActionState } from '@/lib/actions/sync'
import { Card, Button, Badge, Textarea, Field } from '@/components/ui/primitives'

/**
 * Sincronização da InfinitePay pela tela.
 *
 * O token do painel dura 30 minutos, então ele é colado na hora e usado só
 * nesta execução — não fica guardado em lugar nenhum. Um backfill do histórico
 * inteiro cabe folgado nessa janela.
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

/** Minutos restantes lidos do próprio token, para avisar antes de tentar. */
function minutesLeft(token: string): number | null {
  try {
    const payload = token.trim().replace(/^bearer /i, '').split('.')[1]
    if (!payload) return null
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }
    if (!json.exp) return null
    return Math.round((json.exp * 1000 - Date.now()) / 60000)
  } catch {
    return null
  }
}

export function SyncPanel({ configured }: { configured: boolean }) {
  const [state, action] = useActionState<SyncActionState | null, FormData>(syncNow, null)
  const [token, setToken] = useState('')

  const restante = token.trim() ? minutesLeft(token) : null

  return (
    <Card
      className="mt-3"
      title="Sincronizar com a InfinitePay"
      subtitle="Busca vendas e saídas direto da conta, sem planilha"
    >
      <form action={action} className="px-5 py-4">
        <Field
          label="Token da sessão"
          hint="Em app.infinitepay.io: F12 → aba Network → clique numa chamada para services.production.infinitepay.io → copie o header Authorization e cole aqui. Ele dura 30 minutos e não fica guardado."
        >
          <Textarea
            name="token"
            rows={3}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiIs…"
            className="font-mono text-[12px]"
            spellCheck={false}
            autoComplete="off"
          />
        </Field>

        {restante !== null && (
          <p className="mt-2 text-[12.5px]">
            {restante > 0 ? (
              <span className="text-ink-muted">
                Token válido por mais <strong className="text-ink">{restante} min</strong>.
              </span>
            ) : (
              <span className="text-[var(--critical)]">
                Esse token expirou há {Math.abs(restante)} min. Copie um novo.
              </span>
            )}
          </p>
        )}

        {configured && !token.trim() && (
          <p className="mt-2 text-[12.5px] text-ink-muted">
            Sem colar nada, usa o token do ambiente — que provavelmente já expirou.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <SubmitButton dias={3000} variant="primary">
            Histórico completo
          </SubmitButton>
          <SubmitButton dias={90} variant="secondary">
            Últimos 90 dias
          </SubmitButton>
          <SubmitButton dias={15} variant="secondary">
            Últimos 15 dias
          </SubmitButton>
        </div>

        <p className="mt-3 text-[12.5px] text-ink-muted">
          O histórico completo puxa desde 2020 e pode levar alguns minutos. Rodar de novo não
          duplica nada: vendas que já existem são reconhecidas, e as que mudaram de status são
          corrigidas.
        </p>

        {state && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge tone={state.ok ? 'good' : 'critical'}>{state.ok ? 'concluído' : 'erro'}</Badge>
            <span className="text-[13px] text-ink">{state.message}</span>
            {state.detail && <span className="text-[12.5px] text-ink-muted">{state.detail}</span>}
          </div>
        )}
      </form>
    </Card>
  )
}
