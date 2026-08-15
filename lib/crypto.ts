import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from '@/lib/env'

/**
 * Segredos em repouso.
 *
 * AES-256-GCM: além de cifrar, autentica — um valor adulterado no banco falha
 * ao decifrar em vez de virar lixo silencioso. A chave sai de `ENCRYPTION_KEY`
 * passada por SHA-256, então qualquer formato de chave (hex, base64, frase)
 * vira 32 bytes válidos sem exigir formato específico na configuração.
 *
 * Formato guardado: `v1.<iv>.<tag>.<payload>`, tudo em base64url. O prefixo de
 * versão existe para trocar de algoritmo um dia sem quebrar o que já está
 * gravado.
 */

const VERSION = 'v1'

function key(): Buffer {
  return createHash('sha256').update(env.encryptionKey).digest()
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const payload = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), payload.toString('base64url')].join('.')
}

export function decryptSecret(stored: string): string | null {
  try {
    const [version, iv, tag, payload] = stored.split('.')
    if (version !== VERSION || !iv || !tag || !payload) return null

    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))

    return Buffer.concat([
      decipher.update(Buffer.from(payload, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    // Chave trocada ou valor corrompido: trata como ausente, não derruba a
    // chamada — quem depende do segredo já sabe lidar com "não tem".
    return null
  }
}
