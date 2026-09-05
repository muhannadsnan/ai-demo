import { requireAiProvider } from '../utils/ai/provider'
import type { ChatMessage } from '../utils/ai/types'
import { enforceRateLimit, validateMessages } from '../utils/guardrails'

/**
 * Streaming chat endpoint.
 *
 * THE ONE RULE OF AI INTEGRATION
 * ------------------------------
 * This code runs on the server. The browser never sees the API key, never
 * talks to OpenAI, and cannot change the system prompt. Every call goes
 *
 *     browser -> your server (auth, limits, logging, prompt) -> model vendor
 *
 * If you take one thing from this whole demo, take that shape. It is the same
 * reason you never put database credentials in JavaScript.
 *
 * A NOTE ON "MEMORY"
 * ------------------
 * The model has none. It is a pure function of the messages you send it. The
 * conversation appears to have memory only because the client resends the
 * entire history on every turn, and we forward it. That is also why long chats
 * get expensive: you re-pay for the whole transcript each time.
 */

const SYSTEM_PROMPT = `You are a helpful assistant embedded in a demo application
for a senior PHP/MySQL developer who is learning AI integration.

Guidelines:
- Be concise and concrete. Prefer short paragraphs and examples over preamble.
- If you do not know something, say so plainly rather than inventing details.
- When explaining an AI concept, relate it to ordinary backend engineering
  (HTTP APIs, caching, indexing, batching) where the analogy is honest.`

export default defineEventHandler(async (event) => {
  enforceRateLimit(event, 'chat')

  const body = await readBody<{ messages?: unknown }>(event)
  const history = validateMessages(body?.messages)
  const provider = requireAiProvider()

  // The system prompt is prepended here, server-side, on every request.
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history
  ]

  // If the user closes the tab mid-answer, stop generating. Without this you
  // keep paying for tokens nobody will ever read.
  const abortController = new AbortController()
  event.node.req.on('close', () => abortController.abort())

  /**
   * Server-Sent Events: a one-way HTTP stream the browser reads incrementally.
   * Simpler than WebSockets and a natural fit, because tokens only ever flow
   * server -> client. We wrap each token in JSON so we can also send typed
   * `done` and `error` events down the same channel.
   */
  const stream = createEventStream(event)

  ;(async () => {
    const startedAt = Date.now()
    let characters = 0
    try {
      for await (const delta of provider.streamChat(messages, {
        temperature: 0.4,
        maxTokens: 800,
        signal: abortController.signal
      })) {
        characters += delta.length
        await stream.push(JSON.stringify({ type: 'delta', text: delta }))
      }

      await stream.push(JSON.stringify({
        type: 'done',
        meta: {
          providerId: provider.id,
          model: provider.chatModel,
          ms: Date.now() - startedAt,
          characters
        }
      }))
    } catch (err) {
      // The stream headers are already sent, so we cannot switch to a 500 here.
      // Errors have to travel *inside* the stream — a real and slightly
      // annoying property of streaming endpoints.
      const message = err instanceof Error ? err.message : String(err)
      console.error('[api/chat] stream failed:', message)
      await stream.push(JSON.stringify({ type: 'error', message }))
    } finally {
      await stream.close()
    }
  })()

  return stream.send()
})
