import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { currentMonth, previousMonth, today, monthLabel } from '@/lib/dates'
import { buildWeeklyDigest, generateReport } from '@/lib/ai/analyst'
import { getAlerts } from '@/lib/analytics/alerts'
import { sendMail } from '@/lib/mailer'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Relatórios automáticos.
 *
 * Semanal:  /api/cron/relatorio?token=...&tipo=semanal   (segundas de manhã)
 * Mensal:   /api/cron/relatorio?token=...&tipo=mensal    (dia 1)
 *
 * O resumo semanal sai mesmo sem chave de IA — os números vêm do banco.
 * A análise em texto é adicionada quando a chave está configurada.
 */

export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token') ?? request.headers.get('x-cron-token')
  if (token !== env.cronSecret) return new NextResponse('Não autorizado.', { status: 401 })

  const kind = url.searchParams.get('tipo') === 'mensal' ? 'monthly' : 'weekly'
  const period = kind === 'monthly' ? previousMonth(currentMonth()) : currentMonth()

  try {
    const digest = await buildWeeklyDigest()
    const alerts = await getAlerts()

    const alertBlock =
      alerts.length > 0
        ? ['', 'Precisa de atenção:', ...alerts.slice(0, 5).map((a) => `• ${a.title} — ${a.detail}`)].join('\n')
        : ''

    let analysis = ''
    if (env.anthropic.configured) {
      try {
        const report = await generateReport(kind, period)
        analysis = `\n\n${'—'.repeat(40)}\n\n${report.content}`
      } catch (error) {
        analysis = `\n\n(A análise de IA falhou: ${error instanceof Error ? error.message : 'erro desconhecido'})`
      }
    }

    const subject =
      kind === 'monthly'
        ? `Fechamento de ${monthLabel(period.start)} — Financeiro Yuri`
        : `Resumo da semana — ${today()}`

    const body = `${digest}${alertBlock}${analysis}`

    if (env.smtp.configured) {
      await sendMail(subject, body)
      return NextResponse.json({ ok: true, sent: true, kind })
    }

    // Sem SMTP o relatório ainda é gerado e fica salvo — não silencia o job.
    return NextResponse.json({ ok: true, sent: false, reason: 'SMTP não configurado', body })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao gerar o relatório.'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export const POST = GET
