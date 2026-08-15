'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { syncPlatforms } from '@/lib/ingest/sync'

/** Sincronização disparada pela tela, sem depender das scheduled tasks. */

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

  if (!env.infinitepay.configured) {
    return {
      ok: false,
      message: 'Token de sessão da InfinitePay não configurado.',
      detail:
        'Defina INFINITEPAY_SESSION_TOKEN nas variáveis de ambiente. O passo a passo está em docs/infinitepay-api.md.',
    }
  }

  const days = Math.min(5000, Math.max(1, Number(formData.get('dias') ?? 15)))

  try {
    const results = await syncPlatforms(days, ['infinitepay'])
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
