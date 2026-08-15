import { redirect } from 'next/navigation'
import { authenticate, createSession, getSession } from '@/lib/auth'
import { Button, Input, Field } from '@/components/ui/primitives'

export const metadata = { title: 'Entrar — Financeiro' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; from?: string }>
}) {
  const session = await getSession()
  if (session) redirect('/')

  const params = await searchParams

  async function signIn(formData: FormData) {
    'use server'
    const email = String(formData.get('email') ?? '')
    const password = String(formData.get('password') ?? '')
    const from = String(formData.get('from') ?? '/')

    const result = await authenticate(email, password)
    if (!result.ok) redirect(`/login?erro=${encodeURIComponent(result.error)}`)

    await createSession(result.user)
    redirect(from.startsWith('/') ? from : '/')
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-7">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Financeiro</h1>
          <p className="mt-1 text-[13.5px] text-ink-muted">
            Painel de resultados da operação — Yuri dos Anjos
          </p>
        </div>

        <form action={signIn} className="space-y-4 rounded-[10px] border border-hairline bg-surface p-6">
          <input type="hidden" name="from" value={params.from ?? '/'} />

          <Field label="E-mail">
            <Input name="email" type="email" required autoComplete="email" placeholder="voce@dominio.com" />
          </Field>

          <Field label="Senha">
            <Input name="password" type="password" required autoComplete="current-password" placeholder="••••••••" />
          </Field>

          {params.erro && (
            <p className="rounded-lg border border-[color-mix(in_srgb,var(--critical)_35%,transparent)] bg-[color-mix(in_srgb,var(--critical)_10%,transparent)] px-3 py-2 text-[13px] text-[var(--critical)]">
              {params.erro}
            </p>
          )}

          <Button type="submit" className="w-full">
            Entrar
          </Button>
        </form>
      </div>
    </main>
  )
}
