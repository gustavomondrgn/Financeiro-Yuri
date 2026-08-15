/**
 * Normalização de texto, isolada num módulo puro.
 *
 * Vive fora de `ingest/dedupe.ts` de propósito: o parser de CSV roda no
 * navegador, e `dedupe.ts` importa `node:crypto`. Separar evita arrastar
 * um módulo de Node para dentro do bundle do cliente.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
