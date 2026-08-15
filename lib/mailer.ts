import 'server-only'
import nodemailer from 'nodemailer'
import { env } from '@/lib/env'

/**
 * Envio de e-mail.
 *
 * SMTP genérico de propósito: funciona com Gmail, Zoho, Resend SMTP ou o
 * servidor do domínio — sem prender o sistema a um fornecedor.
 */

export async function sendMail(subject: string, body: string, html?: string): Promise<void> {
  if (!env.smtp.configured) {
    throw new Error('SMTP não configurado (SMTP_HOST e SMTP_USER).')
  }

  const recipients = env.smtp.recipients
  if (recipients.length === 0) {
    throw new Error('Nenhum destinatário em REPORT_RECIPIENTS.')
  }

  const transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: { user: env.smtp.user, pass: env.smtp.password },
  })

  await transporter.sendMail({
    from: env.smtp.from || env.smtp.user,
    to: recipients.join(', '),
    subject,
    text: body,
    html: html ?? `<pre style="font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.6">${escapeHtml(body)}</pre>`,
  })
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
