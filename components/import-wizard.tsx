'use client'

import { useState } from 'react'
import { Upload, FileCheck2, TriangleAlert, CheckCircle2 } from 'lucide-react'
import { parseInfinitePayCsv, type ColumnMap, type FieldName } from '@/lib/ingest/adapters/infinitepay-csv'
import { parseOfx } from '@/lib/ingest/adapters/ofx'
import type { NormalizedTx } from '@/lib/ingest/types'
import { formatBRL } from '@/lib/money'
import { formatDateBR } from '@/lib/dates'
import { Card, Button, Badge, Table, Th, Td, Money } from '@/components/ui/primitives'

/**
 * Importador de extrato.
 *
 * O arquivo é lido e convertido no próprio navegador — nada é gravado antes
 * de o usuário conferir o mapeamento e a prévia. Quando a detecção automática
 * erra uma coluna, ele corrige aqui em vez de descobrir o problema no DRE.
 */

const FIELD_LABELS: Record<FieldName, string> = {
  date: 'Data da venda',
  receiptDate: 'Data de recebimento',
  description: 'Descrição',
  counterparty: 'Cliente / pagador',
  gross: 'Valor bruto',
  fee: 'Taxa',
  net: 'Valor líquido',
  method: 'Forma de pagamento',
  installments: 'Parcelas',
  status: 'Status',
  type: 'Tipo de movimentação',
  externalId: 'Identificador',
}

interface ParsedState {
  fileName: string
  headers: string[]
  rows: Record<string, string>[]
  mapping: ColumnMap
  transactions: NormalizedTx[]
  rowErrors: Array<{ rowIndex: number; error?: string }>
  isOfx: boolean
}

interface ImportResult {
  processed: number
  created: number
  duplicated: number
  needsReview: number
  errors: string[]
}

export function ImportWizard() {
  const [parsed, setParsed] = useState<ParsedState | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null)
    setResult(null)

    try {
      const text = await file.text()
      const isOfx = /\.(ofx|qfx)$/i.test(file.name) || text.includes('<STMTTRN>')

      if (isOfx) {
        const transactions = parseOfx(text)
        setParsed({
          fileName: file.name,
          headers: [],
          rows: [],
          mapping: {},
          transactions,
          rowErrors: [],
          isOfx: true,
        })
        return
      }

      const outcome = parseInfinitePayCsv(text)
      setParsed({
        fileName: file.name,
        headers: outcome.headers,
        rows: outcome.rows,
        mapping: outcome.mapping,
        transactions: outcome.transactions,
        rowErrors: outcome.rowErrors,
        isOfx: false,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível ler o arquivo.')
    }
  }

  function remap(field: FieldName, column: string) {
    if (!parsed || parsed.isOfx) return
    const mapping = { ...parsed.mapping, [field]: column || undefined }
    const outcome = parseInfinitePayCsv(
      // Reconstrói a partir das linhas já lidas para não pedir o arquivo de novo.
      toCsv(parsed.headers, parsed.rows),
      mapping,
    )
    setParsed({ ...parsed, mapping, transactions: outcome.transactions, rowErrors: outcome.rowErrors })
  }

  async function submit(dryRun: boolean) {
    if (!parsed) return
    setBusy(true)
    setError(null)

    try {
      const response = await fetch('/api/import/infinitepay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactions: parsed.transactions,
          batchRef: parsed.fileName,
          dryRun,
        }),
      })

      if (!response.ok) {
        throw new Error((await response.text()) || `Falha na importação (${response.status})`)
      }

      setResult(await response.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na importação.')
    } finally {
      setBusy(false)
    }
  }

  const totals = parsed
    ? parsed.transactions.reduce(
        (acc, tx) => {
          if (tx.kind === 'sale') acc.sales += tx.grossCents
          else acc.other += tx.netCents
          return acc
        },
        { sales: 0, other: 0 },
      )
    : null

  return (
    <div className="space-y-3">
      <Card title="Arquivo" subtitle="CSV ou OFX exportado do app da InfinitePay">
        <div className="px-5 py-5">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-[var(--axis)] px-6 py-10 text-center transition-colors hover:bg-surface-2">
            <Upload size={22} className="text-ink-muted" />
            <span className="text-[14px] font-medium text-ink">
              {parsed ? parsed.fileName : 'Escolher arquivo ou arrastar aqui'}
            </span>
            <span className="text-[12.5px] text-ink-muted">
              Formatos aceitos: .csv, .ofx, .txt — o arquivo é lido no seu navegador
            </span>
            <input
              type="file"
              accept=".csv,.ofx,.qfx,.txt,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleFile(file)
              }}
            />
          </label>

          {error && (
            <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--critical)_35%,transparent)] bg-[color-mix(in_srgb,var(--critical)_10%,transparent)] px-3 py-2 text-[13px] text-[var(--critical)]">
              {error}
            </p>
          )}
        </div>
      </Card>

      {parsed && !parsed.isOfx && (
        <Card title="Mapeamento das colunas" subtitle="Confira antes de importar — errar aqui contamina o DRE">
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(FIELD_LABELS) as FieldName[]).map((field) => (
              <label key={field} className="text-[12.5px] text-ink-2">
                {FIELD_LABELS[field]}
                <select
                  value={parsed.mapping[field] ?? ''}
                  onChange={(e) => remap(field, e.target.value)}
                  className="mt-1 w-full rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-[13px] text-ink"
                >
                  <option value="">— não usar —</option>
                  {parsed.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </Card>
      )}

      {parsed && (
        <Card
          title="Prévia"
          subtitle={`${parsed.transactions.length} lançamentos lidos${parsed.rowErrors.length > 0 ? ` · ${parsed.rowErrors.length} linhas ignoradas` : ''}`}
          action={
            <div className="flex gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => void submit(true)}>
                Simular
              </Button>
              <Button disabled={busy} onClick={() => void submit(false)}>
                {busy ? 'Importando…' : 'Importar'}
              </Button>
            </div>
          }
        >
          <div className="flex flex-wrap gap-4 border-b border-hairline px-5 py-3 text-[13px]">
            <span className="text-ink-2">
              Vendas: <strong className="tabular text-ink">{formatBRL(totals?.sales ?? 0)}</strong>
            </span>
            <span className="text-ink-2">
              Outras movimentações:{' '}
              <strong className="tabular text-ink">{formatBRL(totals?.other ?? 0)}</strong>
            </span>
            {parsed.rowErrors.length > 0 && (
              <Badge tone="warning" icon={<TriangleAlert size={13} />}>
                {parsed.rowErrors.length} linhas sem data ou sem valor
              </Badge>
            )}
          </div>

          <Table className="min-w-[720px]">
            <thead>
              <tr>
                <Th>Data</Th>
                <Th>Descrição</Th>
                <Th>Pagador</Th>
                <Th>Tipo</Th>
                <Th align="right">Bruto</Th>
                <Th align="right">Taxa</Th>
                <Th align="right">Líquido</Th>
              </tr>
            </thead>
            <tbody>
              {parsed.transactions.slice(0, 12).map((tx, index) => (
                <tr key={index}>
                  <Td className="whitespace-nowrap">{formatDateBR(tx.saleDate)}</Td>
                  <Td className="text-ink">{tx.description ?? '—'}</Td>
                  <Td>{tx.counterpartyName ?? '—'}</Td>
                  <Td>{tx.kind === 'sale' ? 'Venda' : tx.kind}</Td>
                  <Td align="right">
                    <Money cents={tx.grossCents} />
                  </Td>
                  <Td align="right">
                    <Money cents={tx.feeCents} />
                  </Td>
                  <Td align="right">
                    <Money cents={tx.netCents} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {parsed.transactions.length > 12 && (
            <p className="px-5 py-3 text-[12.5px] text-ink-muted">
              Mostrando 12 de {parsed.transactions.length} lançamentos.
            </p>
          )}
        </Card>
      )}

      {result && (
        <Card title="Resultado da importação">
          <div className="grid gap-px bg-[var(--border)] sm:grid-cols-4">
            <ResultBox label="Processados" value={result.processed} />
            <ResultBox label="Criados" value={result.created} tone="good" />
            <ResultBox label="Duplicados (ignorados)" value={result.duplicated} />
            <ResultBox label="Sem classificação" value={result.needsReview} tone="warning" />
          </div>
          {result.errors.length > 0 ? (
            <div className="px-5 py-4">
              <p className="mb-2 text-[13px] font-medium text-[var(--critical)]">
                {result.errors.length} erros
              </p>
              <ul className="space-y-1 text-[12.5px] text-ink-muted">
                {result.errors.slice(0, 10).map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="flex items-center gap-2 px-5 py-4 text-[13.5px] text-ink-2">
              <CheckCircle2 size={16} className="text-[var(--good)]" />
              Importação concluída sem erros. Reimportar o mesmo arquivo não duplica nada.
            </p>
          )}
        </Card>
      )}

      {!parsed && (
        <Card title="Como exportar o extrato" subtitle="Passo a passo no app da InfinitePay">
          <ol className="list-decimal space-y-1.5 px-9 py-4 text-[13.5px] text-ink-2">
            <li>Abra o app da InfinitePay e toque no saldo disponível.</li>
            <li>Use os filtros para escolher o período que quer importar.</li>
            <li>Toque no ícone de download e escolha o formato CSV.</li>
            <li>O relatório chega no e-mail cadastrado — baixe e solte o arquivo aqui.</li>
          </ol>
          <p className="flex items-center gap-2 border-t border-hairline px-5 py-3 text-[12.5px] text-ink-muted">
            <FileCheck2 size={15} />
            Pode importar períodos sobrepostos à vontade: a deduplicação garante que nada entre duas vezes.
          </p>
        </Card>
      )}
    </div>
  )
}

function ResultBox({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'good' | 'warning'
}) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="text-[12px] font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p
        className={`mt-1 text-[22px] font-semibold ${
          tone === 'good' ? 'text-[var(--good-text)]' : tone === 'warning' ? 'text-[var(--serious)]' : 'text-ink'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

/** Reconstrói o CSV a partir das linhas já lidas, para reprocessar o mapeamento. */
function toCsv(headers: string[], rows: Record<string, string>[]): string {
  const escape = (value: string) => {
    const text = value ?? ''
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [headers.map(escape).join(';')]
  for (const row of rows) lines.push(headers.map((h) => escape(String(row[h] ?? ''))).join(';'))
  return lines.join('\n')
}
