'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { syncNow, type SyncActionState } from '@/lib/actions/sync'
import { Card, Button, Badge, Textarea, Field } from '@/components/ui/primitives'
import type { TokenStatus } from '@/lib/ingest/infinitepay-token'

/**
 * Sincronização da InfinitePay pela tela.
 *
 * O token do painel dura 30 minutos, então há dois caminhos: o atalho de
 * navegador, que captura sozinho e reenvia a cada renovação enquanto a aba
 * estiver aberta, e o campo manual, para quando o atalho não estiver à mão.
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

/** Minutos restantes lidos do próprio token colado. */
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

export function SyncPanel({
  bookmarklet,
  tokenStatus,
}: {
  bookmarklet: string
  tokenStatus: TokenStatus
}) {
  const [state, action] = useActionState<SyncActionState | null, FormData>(syncNow, null)
  const [token, setToken] = useState('')
  const [manual, setManual] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const atalhoRef = useRef<HTMLAnchorElement>(null)

  // O React recusa `href="javascript:…"` no JSX, então o endereço é aplicado
  // no DOM depois da montagem. É o que permite arrastar para os favoritos.
  useEffect(() => {
    atalhoRef.current?.setAttribute('href', bookmarklet)
  }, [bookmarklet])

  const restante = token.trim() ? minutesLeft(token) : null

  return (
    <>
      <Card
        className="mt-3"
        title="Conectar a InfinitePay"
        subtitle="Uma vez só: arraste o atalho para a barra de favoritos"
      >
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <a
              ref={atalhoRef}
              onClick={(e) => e.preventDefault()}
              draggable
              className="inline-flex cursor-grab items-center rounded-lg border border-hairline bg-surface-2 px-3.5 py-2 text-[13.5px] font-medium text-ink active:cursor-grabbing"
            >
              Capturar token da InfinitePay
            </a>
            <span className="text-[12.5px] text-ink-muted">← arraste este botão para os favoritos</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(bookmarklet)
                setCopiado(true)
                setTimeout(() => setCopiado(false), 2500)
              }}
            >
              {copiado ? 'copiado' : 'ou copiar o endereço'}
            </Button>
          </div>

          <ol className="mt-4 space-y-1.5 text-[13px] text-ink-2">
            <li>
              1. Arraste o botão acima para a barra de favoritos. (Ou clique em “copiar o
              endereço”, crie um favorito qualquer e cole no campo de endereço dele.)
            </li>
            <li>
              2. Abra <code>app.infinitepay.io</code> logado e clique nesse favorito.
            </li>
            <li>3. Navegue pelo painel — clique em Vendas, por exemplo. Pronto.</li>
          </ol>

          <p className="mt-3 text-[12.5px] text-ink-muted">
            O atalho lê o token que o painel já envia nas próprias chamadas e manda para cá. Não lê
            senha, não toca em cookie, não guarda nada no navegador. Enquanto a aba ficar aberta,
            cada token novo chega sozinho — o painel gera um a cada 30 minutos.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {tokenStatus.valid ? (
              <>
                <Badge tone="good">conectado</Badge>
                <span className="text-[13px] text-ink">
                  Token válido por mais {tokenStatus.minutesLeft} min.
                </span>
              </>
            ) : tokenStatus.present ? (
              <>
                <Badge tone="warning">token expirado</Badge>
                <span className="text-[13px] text-ink-2">
                  O último chegou há {Math.abs(tokenStatus.minutesLeft ?? 0)} min. Clique no favorito
                  de novo com o painel aberto.
                </span>
              </>
            ) : (
              <>
                <Badge tone="info">ainda não conectado</Badge>
                <span className="text-[13px] text-ink-2">Nenhum token recebido até agora.</span>
              </>
            )}
          </div>

          {tokenStatus.seenAt && (
            <p className="mt-2 truncate text-[12px] text-ink-muted" title={tokenStatus.seenAt}>
              Última captura em: <code>{tokenStatus.seenAt}</code>
            </p>
          )}
        </div>
      </Card>

      <Card
        className="mt-3"
        title="Sincronizar"
        subtitle="Busca vendas e saídas direto da conta, sem planilha"
      >
        <form action={action} className="px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
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

          {!manual ? (
            <button
              type="button"
              onClick={() => setManual(true)}
              className="mt-3 text-[12.5px] text-ink-muted underline underline-offset-2 hover:text-ink"
            >
              Colar o token à mão
            </button>
          ) : (
            <div className="mt-4">
              <Field
                label="Token da sessão"
                hint="Em app.infinitepay.io: F12 → Network → clique numa chamada para services.production.infinitepay.io → copie o header Authorization."
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
                      Esse token expirou há {Math.abs(restante)} min.
                    </span>
                  )}
                </p>
              )}
            </div>
          )}

          {state && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge tone={state.ok ? 'good' : 'critical'}>{state.ok ? 'concluído' : 'erro'}</Badge>
              <span className="text-[13px] text-ink">{state.message}</span>
              {state.detail && <span className="text-[12.5px] text-ink-muted">{state.detail}</span>}
            </div>
          )}
        </form>
      </Card>
    </>
  )
}
