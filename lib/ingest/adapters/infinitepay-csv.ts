import Papa from 'papaparse'
import { parseBRLToCents } from '@/lib/money'
import { normalizeDate } from '@/lib/dates'
import { normalizeText } from '@/lib/text'
import type { NormalizedTx, PaymentMethod, TxKind, TxStatus } from '../types'

/**
 * Adaptador do extrato/relatório da InfinitePay (CSV e XLS convertido).
 *
 * A InfinitePay não publica esquema de exportação e já mudou o cabeçalho
 * entre versões do app. Em vez de fixar nomes de coluna, o parser detecta
 * por sinônimo e — quando não tem certeza — devolve o mapeamento para a
 * tela de importação, onde o usuário ajusta em dois cliques. Errar calado
 * o mapeamento de "valor líquido" contaminaria o DRE inteiro.
 */

export type FieldName =
  | 'date'
  | 'receiptDate'
  | 'description'
  | 'counterparty'
  | 'gross'
  | 'fee'
  | 'net'
  | 'method'
  | 'installments'
  | 'status'
  | 'type'
  | 'externalId'

const ALIASES: Record<FieldName, string[]> = {
  date: ['data', 'data da venda', 'data venda', 'data transacao', 'data da transacao', 'criado em', 'data hora', 'date'],
  receiptDate: ['data de recebimento', 'data recebimento', 'previsao de recebimento', 'data do credito', 'data pagamento', 'liquidacao'],
  description: ['descricao', 'historico', 'detalhe', 'detalhes', 'observacao', 'produto', 'item', 'titulo', 'lancamento', 'description'],
  counterparty: ['cliente', 'nome do cliente', 'pagador', 'nome', 'contraparte', 'destinatario', 'remetente', 'quem pagou', 'customer'],
  gross: ['valor bruto', 'valor da venda', 'valor total', 'valor', 'bruto', 'montante', 'amount', 'valor original'],
  fee: ['taxa', 'taxas', 'valor da taxa', 'tarifa', 'desconto', 'custo', 'fee'],
  net: ['valor liquido', 'liquido', 'valor a receber', 'valor recebido', 'net', 'total liquido'],
  method: ['forma de pagamento', 'metodo', 'metodo de pagamento', 'tipo de pagamento', 'bandeira', 'modalidade', 'payment method'],
  installments: ['parcelas', 'numero de parcelas', 'qtd parcelas', 'installments', 'parcelamento'],
  status: ['status', 'situacao', 'estado'],
  type: ['tipo', 'tipo de transacao', 'tipo de movimentacao', 'operacao', 'categoria'],
  externalId: ['id', 'id da transacao', 'nsu', 'codigo', 'identificador', 'transaction id', 'transaction_nsu', 'order_nsu'],
}

export type ColumnMap = Partial<Record<FieldName, string>>

export interface ParsedCsv {
  headers: string[]
  rows: Record<string, string>[]
  mapping: ColumnMap
  /** Campos essenciais que a detecção automática não conseguiu resolver. */
  missing: FieldName[]
  delimiter: string
}

export function detectMapping(headers: string[]): ColumnMap {
  const mapping: ColumnMap = {}
  const normalized = headers.map((h) => ({ original: h, norm: normalizeText(h) }))
  const taken = new Set<string>()

  // Passe 1: correspondência exata do sinônimo. Passe 2: contém.
  for (const pass of [0, 1]) {
    for (const [field, aliases] of Object.entries(ALIASES) as [FieldName, string[]][]) {
      if (mapping[field]) continue
      for (const alias of aliases) {
        const hit = normalized.find(
          (h) =>
            !taken.has(h.original) &&
            (pass === 0 ? h.norm === alias : h.norm.includes(alias)),
        )
        if (hit) {
          mapping[field] = hit.original
          taken.add(hit.original)
          break
        }
      }
    }
  }

  return mapping
}

export function parseCsv(content: string): ParsedCsv {
  // A exportação vem ora com vírgula, ora com ponto-e-vírgula (padrão pt-BR).
  const parsed = Papa.parse<Record<string, string>>(content.trim(), {
    header: true,
    skipEmptyLines: 'greedy',
    delimitersToGuess: [';', ',', '\t', '|'],
    transformHeader: (h) => h.trim(),
  })

  const headers = parsed.meta.fields ?? []
  const mapping = detectMapping(headers)

  const missing: FieldName[] = []
  if (!mapping.date) missing.push('date')
  if (!mapping.gross && !mapping.net) missing.push('gross')

  return {
    headers,
    rows: parsed.data.filter((r) => Object.values(r).some((v) => v && String(v).trim())),
    mapping,
    missing,
    delimiter: parsed.meta.delimiter,
  }
}

function detectMethod(value: string | undefined, description: string): PaymentMethod | null {
  const text = normalizeText(`${value ?? ''} ${description}`)
  if (!text) return null
  if (text.includes('pix')) return 'pix'
  if (text.includes('debito')) return 'debit_card'
  if (text.includes('credito') || text.includes('cartao') || text.includes('parcelado')) return 'credit_card'
  if (text.includes('boleto')) return 'boleto'
  if (text.includes('ted') || text.includes('transferencia') || text.includes('doc')) return 'transfer'
  return null
}

/**
 * Deduz a natureza da linha.
 *
 * Crítico para o DRE: transferência para a conta-caixa e saque não são
 * receita. Contadas como venda, inflariam o faturamento com dinheiro que
 * apenas mudou de bolso.
 */
export function detectKind(description: string, typeColumn: string | undefined, netCents: number): TxKind {
  const text = normalizeText(`${typeColumn ?? ''} ${description}`)

  if (text.includes('estorno') || text.includes('devolucao') || text.includes('reembolso')) return 'refund'
  if (text.includes('chargeback') || text.includes('contestacao')) return 'chargeback'
  if (text.includes('tarifa') || text.includes('taxa') || text.includes('anuidade')) return 'fee'
  if (text.includes('transferencia enviada') || text.includes('transferencia para') || text.includes('pix enviado')) {
    return 'transfer_out'
  }
  if (text.includes('transferencia recebida') || text.includes('transferencia de') || text.includes('pix recebido')) {
    return netCents < 0 ? 'transfer_out' : 'transfer_in'
  }
  if (text.includes('saque') || text.includes('retirada')) return 'withdrawal'
  if (text.includes('pagamento de conta') || text.includes('boleto pago')) return 'transfer_out'
  if (text.includes('antecipacao')) return 'fee'

  if (netCents < 0) return 'transfer_out'
  return 'sale'
}

function detectStatus(value: string | undefined): TxStatus {
  const text = normalizeText(value ?? '')
  if (!text) return 'approved'
  if (text.includes('pendente') || text.includes('aguardando') || text.includes('processando')) return 'pending'
  if (text.includes('estorn') || text.includes('reembols')) return 'refunded'
  if (text.includes('cancel') || text.includes('recusad') || text.includes('falh')) return 'canceled'
  if (text.includes('chargeback') || text.includes('contestad')) return 'chargeback'
  return 'approved'
}

export interface RowConversion {
  ok: boolean
  tx?: NormalizedTx
  error?: string
  rowIndex: number
}

export function rowsToTransactions(
  rows: Record<string, string>[],
  mapping: ColumnMap,
  source: NormalizedTx['source'] = 'csv_upload',
): { transactions: NormalizedTx[]; errors: RowConversion[] } {
  const out: NormalizedTx[] = []
  const errors: RowConversion[] = []

  rows.forEach((row, index) => {
    const get = (field: FieldName): string | undefined => {
      const column = mapping[field]
      if (!column) return undefined
      const value = row[column]
      return value === undefined || value === null ? undefined : String(value).trim()
    }

    const saleDate = normalizeDate(get('date'))
    if (!saleDate) {
      errors.push({ ok: false, rowIndex: index, error: 'Data ausente ou ilegível' })
      return
    }

    const description = get('description') ?? ''
    const grossRaw = get('gross')
    const netRaw = get('net')
    const feeRaw = get('fee')

    let grossCents = grossRaw !== undefined ? parseBRLToCents(grossRaw) : 0
    let netCents = netRaw !== undefined ? parseBRLToCents(netRaw) : 0
    const feeCents = Math.abs(feeRaw !== undefined ? parseBRLToCents(feeRaw) : 0)

    // O extrato às vezes traz só um dos dois valores.
    if (!grossCents && netCents) grossCents = netCents + feeCents
    if (!netCents && grossCents) netCents = grossCents - feeCents

    if (!grossCents && !netCents) {
      errors.push({ ok: false, rowIndex: index, error: 'Linha sem valor' })
      return
    }

    const kind = detectKind(description, get('type'), netCents)
    const method = detectMethod(get('method'), description)
    const installmentsRaw = get('installments')
    const installments = installmentsRaw ? Number(installmentsRaw.replace(/\D/g, '')) || 1 : 1

    out.push({
      platform: 'infinitepay',
      source,
      externalId: get('externalId') || null,
      kind,
      status: detectStatus(get('status')),
      method,
      installments,
      grossCents: Math.abs(grossCents),
      feeCents,
      netCents: Math.abs(netCents),
      saleDate,
      receiptDate: normalizeDate(get('receiptDate')) ?? saleDate,
      description: description || null,
      counterpartyName: get('counterparty') || null,
      productHint: description || null,
      raw: row,
    })
  })

  return { transactions: out, errors }
}

/** Converte texto de CSV direto para transações, com o mapeamento detectado. */
export function parseInfinitePayCsv(
  content: string,
  overrides?: ColumnMap,
  source: NormalizedTx['source'] = 'csv_upload',
) {
  const parsed = parseCsv(content)
  const mapping = { ...parsed.mapping, ...overrides }
  const { transactions, errors } = rowsToTransactions(parsed.rows, mapping, source)
  return { ...parsed, mapping, transactions, rowErrors: errors }
}
