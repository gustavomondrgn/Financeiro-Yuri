import { desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { jobRuns } from '@/lib/db/schema'
import { formatDateTimeBR } from '@/lib/dates'
import { PageHeader } from '@/components/shell'
import { Card, Table, Th, Td, Badge, EmptyState } from '@/components/ui/primitives'
import { ImportWizard } from '@/components/import-wizard'

export const dynamic = 'force-dynamic'

export default async function ImportarPage() {
  const runs = await db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(15)

  return (
    <>
      <PageHeader
        title="Importar"
        description="Suba o extrato da InfinitePay. Reimportar o mesmo período não duplica nada."
      />

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
