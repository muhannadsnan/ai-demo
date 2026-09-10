import type { AiProvider, ChatMessage, ChatOptions } from './types'

/**
 * The real OpenAI provider — written with plain `fetch`, deliberately.
 *
 * WHY NO SDK?
 * -----------
 * The official `openai` npm package would be three lines shorter here. But you
 * are going to re-implement this in PHP/CodeIgniter with cURL, and the thing
 * that actually transfers is the HTTP contract: the URL, the headers, the JSON
 * body, and the shape of the streaming response. An SDK hides exactly that.
 * Read this file once and you can write the PHP version from memory.
 *
 * The same contract is spoken by Azure OpenAI, Groq, Together, OpenRouter,
 * vLLM and LM Studio — "OpenAI-compatible" is the de-facto standard. Which is
 * why `baseUrl` is configurable: swapping vendors is often just a URL change.
 */

interface OpenAiConfig {
  apiKey: string
  baseUrl: string
  chatModel: string
  embeddingModel: string
}

/** Turn a failed response into an error message worth putting in a log file. */
async function toError(res: Response, what: string): Promise<Error> {
  const body = await res.text().catch(() => '')
  let detail = body.slice(0, 500)
  try {
    detail = JSON.parse(body)?.error?.message ?? detail
  } catch {
    // Not JSON — keep the raw text.
  }
  const hint = res.status === 401
    ? ' (check NUXT_OPENAI_API_KEY)'
    : res.status === 429
      ? ' (rate limit or no credit on the account)'
      : ''
  return new Error(`OpenAI ${what} failed: ${res.status} ${res.statusText}${hint}. ${detail}`)
}

export function createOpenAiProvider(config: OpenAiConfig): AiProvider {
  if (!config.apiKey) {
    throw new Error(
      'NUXT_AI_PROVIDER=openai but NUXT_OPENAI_API_KEY is empty. '
      + 'Put your key in .env and restart the dev server.'
    )
  }

  const headers = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json'
  }

  return {
    id: 'openai',
    chatModel: config.chatModel,
    embeddingModel: config.embeddingModel,
    billable: true,
    /**
     * Measured with `npm run eval` against text-embedding-3-small, 33 chunks:
     *
     *   noise floor (unanswerable questions)  0.067 – 0.139
     *   genuine matches                       0.310 – 0.640
     *
     * 0.22 sits clear of both: well above the loudest noise, well below the
     * quietest real answer.
     *
     * The placeholder here was 0.35, guessed before a key existed — and it was
     * ABOVE two genuine matches (0.310 and 0.317). Those questions retrieved the
     * correct passage and would then have been refused as irrelevant: a wrong
     * answer produced by a filter doing its job on a wrong number. This is the
     * failure docs/03 describes, in the direction nobody looks for — a floor set
     * too HIGH is silent, because the only symptom is an answer you never see.
     */
    relevanceFloor: 0.22,
    // PROVISIONAL until measured against text-embedding-3-small on this
    // corpus. Do not copy nomic's 0.62 — the models put "related" at
    // different distances, and a borrowed cutoff silently stops filtering.
    distanseTak: 0.62,

    async *streamChat(messages: ChatMessage[], opts: ChatOptions = {}) {
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        signal: opts.signal,
        body: JSON.stringify({
          model: opts.model || config.chatModel,
          messages,                                  // full conversation, every time
          temperature: opts.temperature ?? 0.3,
          max_tokens: opts.maxTokens ?? 800,
          // Same guarantee as Ollama's `format`, different spelling.
          ...(opts.jsonSchema
            ? { response_format: { type: 'json_schema', json_schema: { name: 'svar', schema: opts.jsonSchema, strict: false } } }
            : {}),
          stream: true                               // <- the only line that makes it stream
        })
      })

      if (!res.ok) throw await toError(res, 'chat')
      if (!res.body) throw new Error('OpenAI chat returned no response body')

      /**
       * The response is Server-Sent Events. On the wire it looks like:
       *
       *   data: {"choices":[{"delta":{"content":"Hel"}}]}
       *   data: {"choices":[{"delta":{"content":"lo"}}]}
       *   data: [DONE]
       *
       * TCP does not respect message boundaries, so a chunk can end mid-line.
       * Hence the `buffer`: we only process up to the last complete newline and
       * carry the remainder into the next iteration. Forgetting this is the
       * classic streaming bug — it works on localhost and corrupts in production.
       */
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''            // keep the possibly-partial last line

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue

            const payload = trimmed.slice(5).trim()
            if (payload === '[DONE]') return

            try {
              const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content
              if (delta) yield delta as string
            } catch {
              // A malformed keep-alive line is not worth killing the stream over.
            }
          }
        }
      } finally {
        reader.cancel().catch(() => {})
      }
    },

    async embed(texts: string[]) {
      // One request, many inputs. Batching is the difference between a 200ms
      // index build and a 20-second one, and it costs exactly the same.
      const res = await fetch(`${config.baseUrl}/embeddings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: config.embeddingModel, input: texts })
      })

      if (!res.ok) throw await toError(res, 'embeddings')

      const json = await res.json() as { data: Array<{ index: number; embedding: number[] }> }
      // The API does not promise ordering, so sort by the index it returns.
      return json.data.sort((a, b) => a.index - b.index).map(d => d.embedding)
    }
  }
}
