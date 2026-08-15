import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { getSession } from '@/lib/auth'
import { currentMonth, formatDateBR, type Period } from '@/lib/dates'
import { fromCents } from '@/lib/money'
import { listTransactions, PLATFORM_LABELS, METHOD_LABELS, KIND_LABELS, STATUS_LABELS } from '@/lib/analytics/transactions'
import { buildDre } from '@/lib/analytics/dre'
import { computeSplit } from '@/lib/analytics/split'
import type { Regime } from '@/lib/analytics/queries'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * Exportação.
 *
 * /api/export/transacoes?start=&end=&formato=csv|xlsx
 * /api/export/dre?start=&end=&regime=caixa|competencia&formato=csv|xlsx
 *
 * CSV sai com ponto-e-vírgula e BOM: é o que o Excel brasileiro abre sem
 * embaralhar coluna e sem quebrar acento.
 */

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const lines = [headers.map(csvEscape).join(';')]
  for (const row of rows) lines.push(row.map(csvEscape).join(';'))
  return `﻿${lines.join('\r\n')}`
}

async function toXlsx(sheetName: string, headers: string[], rows: Array<Array<string | number>>) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName)

  sheet.addRow(headers)
  sheet.getRow(1).font = { bold: true }
  for (const row of rows) sheet.addRow(row)

  sheet.columns.forEach((column) => {
    let width = 12
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      width = Math.max(width, String(cell.value ?? '').length + 2)
    })
    column.width = Math.min(48, width)
  })

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function GET(request: Request, context: { params: Promise<{ dataset: string }> }) {
  const session = await getSession()
  if (!session) return new NextResponse('Não autenticado.', { status: 401 })

  const { dataset } = await context.params
  const url = new URL(request.url)
  const month = currentMonth()

  const period: Period = {
    start: url.searchParams.get('start') ?? month.start,
    end: url.searchParams.get('end') ?? month.end,
    label: 'período',
  }
  const format = url.searchParams.get('formato') === 'xlsx' ? 'xlsx' : 'csv'
  const regime: Regime = url.searchParams.get('regime') === 'competencia' ? 'accrual' : 'cash'

  let headers: string[]
  let rows: Array<Array<string | number>>
  let filename: string

  if (dataset === 'transacoes') {
    const list = await listTransactions(
      { start: period.start, end: period.end, platform: url.searchParams.get('platform') ?? undefined, regime },
      1,
      20_000,
    )

    headers = [
      'Data da venda',
      'Data de recebimento',
      'Plataforma',
      'Tipo',
      'Status',
      'Descrição',
      'Cliente',
      'Serviço',
      'Método',
      'Parcelas',
      'Bruto',
      'Taxa',
      'Líquido',
      'Origem',
    ]
    rows = list.rows.map((tx) => [
      formatDateBR(tx.saleDate),
      formatDateBR(tx.receiptDate),
      PLATFORM_LABELS[tx.platform] ?? tx.platform,
      KIND_LABELS[tx.kind] ?? tx.kind,
      STATUS_LABELS[tx.status] ?? tx.status,
      tx.description ?? '',
      tx.customerName ?? tx.counterpartyName ?? '',
      tx.productName ?? 'Não classificado',
      tx.method ? (METHOD_LABELS[tx.method] ?? tx.method) : '',
      tx.installments,
      fromCents(tx.grossCents),
      fromCents(tx.feeCents),
      fromCents(tx.netCents),
      tx.origin ?? '',
    ])
    filename = `transacoes_${period.start}_a_${period.end}`
  } else if (dataset === 'dre') {
    const dre = await buildDre(period, regime)
    const split = await computeSplit(period, regime)

    headers = ['Linha', 'Valor', '% da receita bruta']
    rows = dre.lines.map((line) => [
      `${'  '.repeat(line.level)}${line.label}`,
      fromCents(line.amountCents),
      line.share !== undefined ? Number((line.share * 100).toFixed(2)) : '',
    ])
    rows.push([], ['Retiradas — Yuri', fromCents(split.withdrawals.yuri), ''])
    rows.push(['Retiradas — Gustavo', fromCents(split.withdrawals.gustavo), ''])
    filename = `dre_${period.start}_a_${period.end}`
  } else {
    return new NextResponse('Conjunto de dados desconhecido.', { status: 404 })
  }

  if (format === 'xlsx') {
    const buffer = await toXlsx(dataset === 'dre' ? 'DRE' : 'Transações', headers, rows)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
      },
    })
  }

  return new NextResponse(toCsv(headers, rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.csv"`,
    },
  })
}
