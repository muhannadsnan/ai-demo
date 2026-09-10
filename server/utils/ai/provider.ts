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

const cache = new Map<string, AiProvider>()

function bygg(requested: string): AiProvider {
  const config = useRuntimeConfig()
  let cached: AiProvider

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
        `Unknown provider "${requested}". Expected: mock | openai | ollama`
      )
  }

  return cached
}

function hent(requested: string): AiProvider {
  const funnet = cache.get(requested)
  if (funnet) return funnet
  const laget = bygg(requested)
  cache.set(requested, laget)
  return laget
}

/** The provider for chat and structured output. */
export function getAiProvider(): AiProvider {
  return hent(String(useRuntimeConfig().aiProvider || 'mock').toLowerCase())
}

/**
 * The provider for EMBEDDINGS, which is not always the same one.
 *
 * Chat and embeddings have different reasons to be local or hosted. Chat can
 * run on a local model for free and be swapped whenever you like — a different
 * model just answers differently. Embeddings cannot: every stored vector was
 * produced by one specific model, and the question has to be embedded by that
 * same model or the comparison is meaningless. 1.11 million rows is not
 * something to rebuild because the chat model changed.
 *
 * So they are configured separately. With embeddings on OpenAI and chat left on
 * Ollama, semantic search matches the vectors in the database while the
 * assistant stays local and free.
 *
 * Defaults to whatever `aiProvider` is, so a single-provider setup needs no
 * extra configuration.
 */
export function getEmbeddingProvider(): AiProvider {
  const config = useRuntimeConfig()
  return hent(String(config.embeddingProvider || config.aiProvider || 'mock').toLowerCase())
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
  return kreve(getAiProvider)
}

/** As requireAiProvider(), for the embedding side. */
export function requireEmbeddingProvider() {
  return kreve(getEmbeddingProvider)
}

function kreve(hentProvider: () => AiProvider) {
  try {
    return hentProvider()
  } catch (err) {
    throw createError({
      statusCode: 503,
      statusMessage: err instanceof Error ? err.message : 'AI provider is not configured'
    })
  }
}

/** Drop the cache so a provider swap during `nuxt dev` is picked up on reload. */
export function resetAiProvider() {
  cache.clear()
}
