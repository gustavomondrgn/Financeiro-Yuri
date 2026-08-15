'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { syncPlatforms } from '@/lib/ingest/sync'
import { tokenMinutesLeft } from '@/lib/ingest/adapters/infinitepay-api'

/**
 * Sincronização disparada pela tela.
 *
 * O token da InfinitePay é colado na hora e usado só nesta execução — nada é
 * gravado. É a resposta ao fato de o access token do painel durar 30 minutos:
 * guardá-lo em variável de ambiente serviria para uma execução e depois viraria
 * segredo morto no servidor.
 */

export interface SyncActionState {
  ok: boolean
  message: string
  detail?: string
}

export async function syncNow(
  _previous: SyncActionState | null,
  formData: FormData,
): Promise<SyncActionState> {
  await requireSession()

  const token = String(formData.get('token') ?? '').trim()

  if (!token && !env.infinitepay.configured) {
    return {
      ok: false,
      message: 'Cole o token da InfinitePay para sincronizar.',
      detail:
        'Em app.infinitepay.io, F12 → Network → clique numa chamada para services.production.infinitepay.io → copie o header Authorization.',
    }
  }

  // Avisa antes de gastar minutos num backfill que vai morrer no meio.
  if (token) {
    const minutes = tokenMinutesLeft(token)
    if (minutes !== null && minutes <= 0) {
      return {
        ok: false,
        message: `Esse token já expirou (há ${Math.abs(minutes)} min).`,
        detail: 'Eles duram 30 minutos. Copie um novo do painel e cole de novo.',
      }
    }
  }

  const days = Math.min(5000, Math.max(1, Number(formData.get('dias') ?? 15)))

  try {
    const results = await syncPlatforms(days, {
      only: ['infinitepay'],
      infinitepayToken: token || undefined,
    })
    const result = results.infinitepay

    if (!result || 'skipped' in result) {
      return { ok: false, message: 'Sincronização pulada.', detail: result?.skipped }
    }

    revalidatePath('/importar')
    revalidatePath('/')
    revalidatePath('/receitas')

    const partes = [
      `${result.created} criada(s)`,
      `${result.updated} atualizada(s)`,
      `${result.duplicated} já existia(m)`,
    ]
    if (result.needsReview > 0) partes.push(`${result.needsReview} sem classificação`)

    return {
      ok: result.errors.length === 0,
      message: `${result.processed} transação(ões) lidas — ${partes.join(', ')}.`,
      detail: result.errors.length > 0 ? result.errors.slice(0, 3).join(' · ') : undefined,
    }
  } catch (error) {
    return {
      ok: false,
      message: 'A sincronização falhou.',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}
