import type { AiProvider } from './types'
import { createMockProvider } from './mock'
import { createOpenAiProvider } from './openai'
import { createOllamaProvider } from './ollama'

/**
 * The factory. Every API route asks for the provider here and nowhere else,
 * so switching backends is one environment variable and zero code changes.
 *
 * The instance is cached per process: providers are stateless config holders,
 * and re-reading runtimeConfig on every request buys nothing.
 */

let cached: AiProvider | null = null
let cachedFor = ''

export function getAiProvider(): AiProvider {
  const config = useRuntimeConfig()
  const requested = String(config.aiProvider || 'mock').toLowerCase()

  if (cached && cachedFor === requested) return cached

  switch (requested) {
    case 'openai':
      cached = createOpenAiProvider({
        apiKey: config.openaiApiKey,
        baseUrl: config.openaiBaseUrl,
        chatModel: config.openaiChatModel,
        embeddingModel: config.openaiEmbeddingModel
      })
      break

    case 'ollama':
      cached = createOllamaProvider({
        baseUrl: config.ollamaBaseUrl,
        chatModel: config.ollamaChatModel,
        embeddingModel: config.ollamaEmbeddingModel
      })
      break

    case 'mock':
      cached = createMockProvider()
      break

    default:
      throw new Error(
        `Unknown NUXT_AI_PROVIDER "${requested}". Expected: mock | openai | ollama`
      )
  }

  cachedFor = requested
  return cached
}

/**
 * Same as getAiProvider(), but turns a configuration problem into a proper HTTP
 * response instead of an unhandled exception.
 *
 * This matters more than it looks. In production Nitro masks unhandled errors as
 * a bare "Server Error" — correct, because raw exception text can leak internals.
 * But a misconfigured provider is not an internal detail, it is *the* thing the
 * developer needs told. Raising it deliberately with `createError` means the
 * message survives to the client, while genuine surprises stay masked.
 *
 * Use this in API routes; use getAiProvider() where you want to handle the
 * failure yourself, as /api/health does.
 */
export function requireAiProvider() {
  try {
    return getAiProvider()
  } catch (err) {
    throw createError({
      statusCode: 503,
      statusMessage: err instanceof Error ? err.message : 'AI provider is not configured'
    })
  }
}

/** Drop the cache so a provider swap during `nuxt dev` is picked up on reload. */
export function resetAiProvider() {
  cached = null
  cachedFor = ''
}
