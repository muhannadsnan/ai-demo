import type { AiProvider, ChatMessage, ChatOptions } from './types'

/**
 * Ollama — runs open-weight models on your own machine. Free, private, no key.
 *
 * This is your escape hatch while you wait for the company to hand over an
 * OpenAI key: you get a genuinely working AI feature today, and nothing about
 * your application code changes when the key finally arrives.
 *
 * Setup:
 *   1. Install from https://ollama.com
 *   2. ollama pull llama3.2          (chat model,  ~2 GB)
 *   3. ollama pull nomic-embed-text  (embeddings,  ~275 MB)
 *   4. NUXT_AI_PROVIDER=ollama in .env, restart the dev server
 *
 * Note the wire format differs from OpenAI: Ollama streams newline-delimited
 * JSON (NDJSON), not SSE. Same idea, no `data:` prefix. A good illustration
 * that "streaming" is not one standard — which is precisely why the parsing
 * lives down here in the adapter and not in your API route.
 */

interface OllamaConfig {
  baseUrl: string
  chatModel: string
  embeddingModel: string
}

function connectionHint(baseUrl: string, err: unknown): Error {
  return new Error(
    `Could not reach Ollama at ${baseUrl}. Is it running? Try \`ollama serve\`. `
    + `(${err instanceof Error ? err.message : String(err)})`
  )
}

export function createOllamaProvider(config: OllamaConfig): AiProvider {
  return {
    id: 'ollama',
    chatModel: config.chatModel,
    embeddingModel: config.embeddingModel,
    billable: false,
    // Measured with nomic-embed-text: noise 0.444, genuine matches 0.54-0.81.
    relevanceFloor: 0.50,
    // Measured on this corpus: genuine matches sit below 0.62, unrelated
    // companies above it.
    distanseTak: 0.62,

    async *streamChat(messages: ChatMessage[], opts: ChatOptions = {}) {
      let res: Response
      try {
        res = await fetch(`${config.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: opts.signal,
          body: JSON.stringify({
            model: opts.model || config.chatModel,
            messages,
            stream: true,
            // Structured output: constrains sampling so the reply cannot be
            // anything but valid JSON matching this schema.
            ...(opts.jsonSchema ? { format: opts.jsonSchema } : {}),
            options: {
              temperature: opts.temperature ?? 0.3,
              num_predict: opts.maxTokens ?? 800
            }
          })
        })
      } catch (err) {
        throw connectionHint(config.baseUrl, err)
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(
          `Ollama chat failed: ${res.status}. ${body.slice(0, 300)} `
          + `(is the model pulled? try \`ollama pull ${config.chatModel}\`)`
        )
      }
      if (!res.body) throw new Error('Ollama chat returned no response body')

      // NDJSON: one complete JSON object per line. Same partial-line buffering
      // discipline as SSE — the network still splits wherever it likes.
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const parsed = JSON.parse(line)
              const delta = parsed?.message?.content
              if (delta) yield delta as string
              if (parsed?.done) return
            } catch {
              // Ignore an unparsable line rather than dropping the whole stream.
            }
          }
        }
      } finally {
        reader.cancel().catch(() => {})
      }
    },

    async embed(texts: string[]) {
      let res: Response
      try {
        res = await fetch(`${config.baseUrl}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: config.embeddingModel, input: texts })
        })
      } catch (err) {
        throw connectionHint(config.baseUrl, err)
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(
          `Ollama embeddings failed: ${res.status}. ${body.slice(0, 300)} `
          + `(try \`ollama pull ${config.embeddingModel}\`)`
        )
      }

      const json = await res.json() as { embeddings: number[][] }
      return json.embeddings
    }
  }
}
