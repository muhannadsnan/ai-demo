import { getAiProvider } from '../utils/ai/provider'

/**
 * A boring endpoint that saves hours. It answers "which brain is actually
 * plugged in right now?" — the question you will ask yourself every time
 * something behaves unexpectedly.
 *
 * Observe what it does NOT return: the API key. It returns whether one is
 * *configured*, which is all the UI ever needs to know.
 */
export default defineEventHandler(() => {
  const config = useRuntimeConfig()

  let provider
  let error: string | null = null
  try {
    provider = getAiProvider()
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  return {
    ok: !error,
    error,
    provider: provider
      ? {
          id: provider.id,
          chatModel: provider.chatModel,
          embeddingModel: provider.embeddingModel,
          billable: provider.billable
        }
      : null,
    configured: {
      requestedProvider: config.aiProvider,
      openaiKeyPresent: Boolean(config.openaiApiKey),   // boolean only, never the key
      openaiBaseUrl: config.openaiBaseUrl,
      ollamaBaseUrl: config.ollamaBaseUrl
    }
  }
})
