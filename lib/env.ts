import 'server-only'

/**
 * Acesso tipado às variáveis de ambiente.
 *
 * `required()` explode cedo e com mensagem clara — errar por env faltando em
 * produção deve falhar no boot, não no meio de um cálculo financeiro.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Variável de ambiente obrigatória ausente: ${name}. ` +
        `Defina em .env.local (dev) ou nas env vars do Coolify (produção).`,
    )
  }
  return value
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback
}

export const env = {
  get databaseUrl() {
    return required('DATABASE_URL')
  },
  get authSecret() {
    return required('AUTH_SECRET')
  },
  get encryptionKey() {
    return required('ENCRYPTION_KEY')
  },
  get cronSecret() {
    return required('CRON_SECRET')
  },
  get webhookSecret() {
    return required('WEBHOOK_SECRET')
  },
  get appUrl() {
    return optional('APP_URL', 'http://localhost:3000')
  },

  kiwify: {
    get clientId() {
      return optional('KIWIFY_CLIENT_ID')
    },
    get clientSecret() {
      return optional('KIWIFY_CLIENT_SECRET')
    },
    get accountId() {
      return optional('KIWIFY_ACCOUNT_ID')
    },
    get configured() {
      return Boolean(
        process.env.KIWIFY_CLIENT_ID &&
          process.env.KIWIFY_CLIENT_SECRET &&
          process.env.KIWIFY_ACCOUNT_ID,
      )
    },
  },

  cakto: {
    get token() {
      return optional('CAKTO_API_TOKEN')
    },
    get configured() {
      return Boolean(process.env.CAKTO_API_TOKEN)
    },
  },

  infinitepay: {
    get sessionToken() {
      return optional('INFINITEPAY_SESSION_TOKEN')
    },
    get configured() {
      return Boolean(process.env.INFINITEPAY_SESSION_TOKEN)
    },
  },

  google: {
    get clientId() {
      return optional('GOOGLE_CLIENT_ID')
    },
    get clientSecret() {
      return optional('GOOGLE_CLIENT_SECRET')
    },
    get refreshToken() {
      return optional('GOOGLE_REFRESH_TOKEN')
    },
    get calendarId() {
      return optional('GOOGLE_CALENDAR_ID', 'primary')
    },
    get configured() {
      return Boolean(
        process.env.GOOGLE_CLIENT_ID &&
          process.env.GOOGLE_CLIENT_SECRET &&
          process.env.GOOGLE_REFRESH_TOKEN,
      )
    },
  },

  anthropic: {
    get apiKey() {
      return optional('ANTHROPIC_API_KEY')
    },
    get configured() {
      return Boolean(process.env.ANTHROPIC_API_KEY)
    },
  },

  smtp: {
    get host() {
      return optional('SMTP_HOST')
    },
    get port() {
      return Number(optional('SMTP_PORT', '587'))
    },
    get user() {
      return optional('SMTP_USER')
    },
    get password() {
      return optional('SMTP_PASSWORD')
    },
    get from() {
      return optional('SMTP_FROM')
    },
    get recipients() {
      return optional('REPORT_RECIPIENTS')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    },
    get configured() {
      return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER)
    },
  },

  imap: {
    get host() {
      return optional('IMAP_HOST')
    },
    get port() {
      return Number(optional('IMAP_PORT', '993'))
    },
    get user() {
      return optional('IMAP_USER')
    },
    get password() {
      return optional('IMAP_PASSWORD')
    },
    get configured() {
      return Boolean(process.env.IMAP_HOST && process.env.IMAP_USER)
    },
  },
}

export const TIMEZONE = 'America/Sao_Paulo'
