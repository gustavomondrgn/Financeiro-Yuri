import { env } from '@/lib/env'
import { today, addDays } from '@/lib/dates'
import { ingestBatch, runJob, resolveAccount } from './pipeline'
import { fetchKiwifySales } from './adapters/kiwify'
import { fetchCaktoOrders } from './adapters/cakto'
import { fetchInfinitePaySales, fetchInfinitePayStatements } from './adapters/infinitepay-api'
import { refreshCustomerAggregates } from './customers'
import { getInfinitePayToken } from './infinitepay-token'
import type { IngestResult } from './types'

/**
 * Sincronização das plataformas com API.
 *
 * Mora aqui, e não na rota, porque tem dois chamadores: a scheduled task de
 * hora em hora e o botão de sincronizar da tela de importação.
 *
 * A janela é sobreposta de propósito — vendas mudam de status depois de
 * criadas, e a deduplicação garante que a sobreposição corrija o que mudou em
 * vez de virar lançamento novo. Uma janela larga (`dias=3000`) é o backfill do
 * histórico inteiro, pelo mesmo caminho.
 */

export type SyncOutcome = IngestResult | { skipped: string }
export type SyncResults = Record<string, SyncOutcome>

/** Plataformas que só entram no sync quando têm credencial configurada. */
export type SyncPlatform = 'infinitepay' | 'kiwify' | 'cakto'

export interface SyncOptions {
  only?: SyncPlatform[]
  /**
   * Token da InfinitePay para esta execução. O access token do painel dura 30
   * minutos, então o colado na hora vale mais que o do ambiente.
   */
  infinitepayToken?: string
}

export async function syncPlatforms(days: number, options: SyncOptions = {}): Promise<SyncResults> {
  const { only, infinitepayToken } = options
  const end = today()
  const start = addDays(end, -days)
  const out: SyncResults = {}
  const wanted = (platform: SyncPlatform) => !only || only.includes(platform)

  // InfinitePay primeiro: é a maior fatia da receita.
  if (wanted('infinitepay')) {
    // Ordem de preferência: colado agora > capturado pelo atalho > ambiente.
    // O do ambiente vem por último porque um token de 30 minutos gravado numa
    // env var quase sempre já morreu.
    const token = infinitepayToken || (await getInfinitePayToken()) || undefined

    if (token || env.infinitepay.configured) {
      const auth = { token }
      const accountId = await resolveAccount('infinitepay', 'InfinitePay')
      out.infinitepay = await runJob(
        'sync:infinitepay',
        async () => {
          const sales = await fetchInfinitePaySales(start, end, auth)
          const outflows = await fetchInfinitePayStatements(start, end, auth)
          return ingestBatch([...sales, ...outflows], {
            batchRef: `infinitepay:${start}..${end}`,
            defaultAccountId: accountId,
          })
        },
        { start, end },
      )
    } else {
      out.infinitepay = {
        skipped: 'sem token válido — o do painel dura 30 min; use o atalho na tela de importação',
      }
    }
  }

  if (wanted('kiwify')) {
    if (env.kiwify.configured) {
      const accountId = await resolveAccount('kiwify', 'Kiwify')
      out.kiwify = await runJob(
        'sync:kiwify',
        async () => {
          const transactions = await fetchKiwifySales(start, end)
          return ingestBatch(transactions, {
            batchRef: `kiwify:${start}..${end}`,
            defaultAccountId: accountId,
          })
        },
        { start, end },
      )
    } else {
      out.kiwify = { skipped: 'credenciais não configuradas' }
    }
  }

  if (wanted('cakto')) {
    if (env.cakto.configured) {
      const accountId = await resolveAccount('cakto', 'Cakto')
      out.cakto = await runJob(
        'sync:cakto',
        async () => {
          const transactions = await fetchCaktoOrders(start, end)
          return ingestBatch(transactions, {
            batchRef: `cakto:${start}..${end}`,
            defaultAccountId: accountId,
          })
        },
        { start, end },
      )
    } else {
      out.cakto = { skipped: 'token não configurado' }
    }
  }

  await refreshCustomerAggregates()
  return out
}
