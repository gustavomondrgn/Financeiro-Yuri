/**
 * Dinheiro é sempre inteiro em centavos.
 *
 * Ponto flutuante em valor financeiro produz erro que só aparece no
 * fechamento do mês, quando ninguém mais lembra de onde veio.
 */

export type Cents = number

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const BRL_COMPACT = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})

const PCT = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export function formatBRL(cents: Cents | null | undefined): string {
  return BRL.format((cents ?? 0) / 100)
}

/** R$ 18,5 mil — para cartões e eixos de gráfico. */
export function formatBRLCompact(cents: Cents | null | undefined): string {
  return BRL_COMPACT.format((cents ?? 0) / 100)
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—'
  return PCT.format(ratio)
}

/** Variação relativa entre dois períodos; null quando a base é zero. */
export function variation(current: number, previous: number): number | null {
  if (!previous) return null
  return (current - previous) / Math.abs(previous)
}

export function formatVariation(ratio: number | null): string {
  if (ratio === null) return '—'
  const sign = ratio > 0 ? '+' : ''
  return `${sign}${PCT.format(ratio)}`
}

/**
 * Converte texto monetário brasileiro em centavos.
 * Aceita "R$ 1.234,56", "1234,56", "-1.234,56", "1234.56" e "(1.234,56)".
 */
export function parseBRLToCents(input: string | number | null | undefined): Cents {
  if (input === null || input === undefined || input === '') return 0
  if (typeof input === 'number') return Math.round(input * 100)

  let text = String(input).trim()
  if (!text) return 0

  let negative = text.startsWith('-')
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true
    text = text.slice(1, -1)
  }

  text = text.replace(/[R$\s ]/gi, '').replace(/^-/, '')

  const lastComma = text.lastIndexOf(',')
  const lastDot = text.lastIndexOf('.')

  if (lastComma > lastDot) {
    // Formato brasileiro: ponto é milhar, vírgula é decimal.
    text = text.replace(/\./g, '').replace(',', '.')
  } else if (lastDot > lastComma) {
    // Formato americano: vírgula é milhar.
    text = text.replace(/,/g, '')
  } else {
    text = text.replace(/[.,]/g, '')
  }

  const value = Number(text)
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) * (negative ? -1 : 1)
}

/** Rateio de um total em percentuais sem perder centavo por arredondamento. */
export function splitCents(total: Cents, percentages: number[]): Cents[] {
  const raw = percentages.map((pct) => (total * pct) / 100)
  const floored = raw.map((v) => Math.floor(v))
  let remainder = total - floored.reduce((a, b) => a + b, 0)

  // O centavo residual vai para quem tem a maior parte fracionária.
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)

  const result = [...floored]
  let k = 0
  while (remainder > 0 && order.length > 0) {
    result[order[k % order.length].i] += 1
    remainder -= 1
    k += 1
  }
  return result
}

export function sumCents(values: Array<Cents | null | undefined>): Cents {
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0)
}

export function toCents(value: number): Cents {
  return Math.round(value * 100)
}

export function fromCents(cents: Cents): number {
  return cents / 100
}
