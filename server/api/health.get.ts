import { getAiProvider, getEmbeddingProvider } from '../utils/ai/provider'

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
  let embedder
  let error: string | null = null
  try {
    provider = getAiProvider()
    // Reported separately because it can be a different vendor: the vectors in
    // the database are bound to whichever model made them, so the embedder is
    // configured on its own and the badge should say which one is answering.
    embedder = getEmbeddingProvider()
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
    embedder: embedder
      ? {
          id: embedder.id,
          embeddingModel: embedder.embeddingModel,
          billable: embedder.billable
        }
      : null,
    configured: {
      requestedProvider: config.aiProvider,
      requestedEmbeddingProvider: config.embeddingProvider || config.aiProvider,
      openaiKeyPresent: Boolean(config.openaiApiKey),   // boolean only, never the key
      openaiBaseUrl: config.openaiBaseUrl,
      ollamaBaseUrl: config.ollamaBaseUrl
    }
  }
})
