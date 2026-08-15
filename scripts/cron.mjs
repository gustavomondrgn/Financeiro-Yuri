/* eslint-disable no-console */

/**
 * Disparador dos jobs agendados.
 *
 * Existe porque o campo `command` das Scheduled Tasks do Coolify é
 * `varchar(255)` — um `curl` com token e query não cabe, e a imagem gerada
 * pelo nixpacks não garante o `curl`. Aqui o comando agendado fica curto e
 * legível:
 *
 *   node /app/scripts/cron.mjs sync
 *   node /app/scripts/cron.mjs semanal
 *   node /app/scripts/cron.mjs mensal
 *   node /app/scripts/cron.mjs sync --dias=400     (backfill pontual)
 *
 * O segredo vai no header, não na URL, para não aparecer no log de execução
 * da task. A chamada é em localhost — não passa pela Cloudflare nem depende
 * do DNS externo para um job interno.
 */

const ROTAS = {
  sync: { path: '/api/cron/sync', params: { dias: '15' } },
  semanal: { path: '/api/cron/relatorio', params: { tipo: 'semanal' } },
  mensal: { path: '/api/cron/relatorio', params: { tipo: 'mensal' } },
}

const nome = process.argv[2]
const rota = ROTAS[nome]

if (!rota) {
  console.error(`Job desconhecido: ${nome ?? '(nenhum)'}. Use: ${Object.keys(ROTAS).join(', ')}`)
  process.exit(2)
}

const secret = process.env.CRON_SECRET
if (!secret) {
  console.error('CRON_SECRET ausente no ambiente do container.')
  process.exit(2)
}

const base = `http://127.0.0.1:${process.env.PORT ?? 3000}`
const url = new URL(rota.path, base)
for (const [k, v] of Object.entries(rota.params)) url.searchParams.set(k, v)

// `--chave=valor` sobrescreve o padrão (ex.: --dias=400 para backfill).
for (const arg of process.argv.slice(3)) {
  const match = arg.match(/^--([a-z]+)=(.+)$/)
  if (match) url.searchParams.set(match[1], match[2])
}

// Os jobs de sync podem levar minutos com janelas largas.
const TIMEOUT_MS = Number(process.env.CRON_TIMEOUT_MS ?? 15 * 60 * 1000)

try {
  const response = await fetch(url, {
    headers: { 'x-cron-token': secret },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const body = await response.text()
  console.log(`[cron:${nome}] ${response.status} ${body.slice(0, 4000)}`)
  process.exit(response.ok ? 0 : 1)
} catch (error) {
  console.error(`[cron:${nome}] falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
