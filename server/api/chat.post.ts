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

/**
 * The prompt is what makes this an assistant for THIS site rather than a
 * chatbot that happens to be on it.
 *
 * The most important line is the one about not having database access. A model
 * asked "how many construction companies are in Bergen" will produce a number,
 * confidently, and it will be invented. Telling it to hand that question to the
 * search — which can actually answer it — is worth more than any amount of
 * instruction about being accurate.
 */
const SYSTEM_PROMPT = `You are the assistant on a Norwegian company-data site
built from public registers: Enhetsregisteret, Regnskapsregisteret and
Skatteetatens Aksjonærregister. You help people understand Norwegian business
registration, company forms, roles, ownership and annual accounts, and how to
find things on this site.

What the site can do, so you can point people at it:
- /foretak searches 1.17 million companies by name or organisation number, and
  separately by what the company wrote that it does. That second search has a
  "forstå meningen" mode that matches on meaning rather than words.
- Filters: county, municipality, four-level industry tree, employee count,
  status (bankrupt, newly registered, winding up) and five accounts ranges.
- /topplister has rankings recomputed nightly from the whole dataset.
- A company page has its details, accounts, roles, ownership and its position in
  the corporate ownership network.

Rules:
- YOU CANNOT QUERY THE DATABASE. You have no access to it from this chat. If
  someone asks for figures about specific companies — how many, who owns what,
  which is largest — say plainly that you cannot look it up here and tell them
  which search or filter answers it. Never invent a company, a number or an
  organisation number.
- Names of private individuals are deliberately not published on this site, and
  you should not speculate about them.
- Answer in the language you are asked in; Norwegian questions get Norwegian
  answers.
- Be concise and concrete. Say plainly when you do not know something.`

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
