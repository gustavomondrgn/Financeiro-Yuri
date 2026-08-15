import { desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { jobRuns } from '@/lib/db/schema'
import { formatDateTimeBR } from '@/lib/dates'
import { PageHeader } from '@/components/shell'
import { Card, Table, Th, Td, Badge, EmptyState } from '@/components/ui/primitives'
import { ImportWizard } from '@/components/import-wizard'
import { SyncPanel } from '@/components/sync-panel'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

/** Execuções antigas não têm o campo — mostra 0 em vez de vazio. */
function updatedOf(meta: unknown): number {
  if (meta && typeof meta === 'object' && 'updated' in meta) {
    const value = (meta as { updated: unknown }).updated
    if (typeof value === 'number') return value
  }
  return 0
}

export default async function ImportarPage() {
  const runs = await db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(15)

  return (
    <>
      <PageHeader
        title="Importar"
        description="Puxe direto da InfinitePay ou suba um extrato. Reimportar o mesmo período não duplica nada."
      />

      <SyncPanel configured={env.infinitepay.configured} />

      <ImportWizard />

      <Card className="mt-3" title="Histórico de importações e sincronizações" subtitle="Últimas 15 execuções">
        {runs.length === 0 ? (
          <EmptyState title="Nenhuma execução registrada" />
        ) : (
          <Table className="min-w-[680px]">
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>Início</Th>
                <Th align="center">Estado</Th>
                <Th align="right">Processados</Th>
                <Th align="right">Criados</Th>
                <Th align="right">Atualizados</Th>
                <Th align="right">Duplicados</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <Td className="text-ink">{run.job}</Td>
                  <Td>{formatDateTimeBR(run.startedAt)}</Td>
                  <Td align="center">
                    <Badge
                      tone={run.status === 'success' ? 'good' : run.status === 'error' ? 'critical' : 'info'}
                    >
                      {run.status === 'success' ? 'sucesso' : run.status === 'error' ? 'erro' : 'rodando'}
                    </Badge>
                  </Td>
                  <Td align="right">{run.itemsProcessed}</Td>
                  <Td align="right">{run.itemsCreated}</Td>
                  {/* `updated` fica no meta para não exigir coluna nova. */}
                  <Td align="right">{updatedOf(run.meta)}</Td>
                  <Td align="right">{run.itemsDuplicated}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  )
}
