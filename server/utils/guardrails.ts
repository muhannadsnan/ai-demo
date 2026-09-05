import type { H3Event } from 'h3'
import type { ChatMessage } from './ai/types'

/**
 * The unglamorous half of an AI feature. An LLM endpoint is an endpoint that
 * costs real money per call and accepts arbitrary text — so it needs the same
 * discipline you already apply to a file-upload endpoint, plus a budget.
 */

/** ---- Rate limiting -------------------------------------------------------
 * A fixed-window counter per client. In-memory, so it resets on restart and is
 * per-instance — fine for a demo and for a single-server app. Behind a load
 * balancer or on multiple PHP-FPM workers you would put this in Redis or a
 * MySQL table, exactly as you would for login throttling.
 */
const WINDOW_MS = 60_000
const MAX_REQUESTS_PER_WINDOW = 20

const buckets = new Map<string, { count: number; resetAt: number }>()

export function enforceRateLimit(event: H3Event, key = 'default') {
  // x-forwarded-for matters the moment there is a proxy in front of you.
  const ip = getRequestHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim()
    || event.node.req.socket.remoteAddress
    || 'unknown'
  const bucketKey = `${key}:${ip}`
  const now = Date.now()
  const bucket = buckets.get(bucketKey)

  if (!bucket || now > bucket.resetAt) {
    buckets.set(bucketKey, { count: 1, resetAt: now + WINDOW_MS })
    return
  }

  bucket.count++
  if (bucket.count > MAX_REQUESTS_PER_WINDOW) {
    throw createError({
      statusCode: 429,
      statusMessage: `Rate limit: max ${MAX_REQUESTS_PER_WINDOW} requests per minute.`
    })
  }
}

/** Opportunistic cleanup so the map cannot grow without bound. */
setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key)
  }
}, WINDOW_MS).unref?.()

/** ---- Input validation ---------------------------------------------------- */

const MAX_MESSAGE_CHARS = 4_000
const MAX_HISTORY_MESSAGES = 20

/**
 * Validate and clamp an incoming conversation.
 *
 * The length caps are cost control, not paranoia: you pay per token of input on
 * every single turn, and a chat client that naively sends the whole history
 * makes turn 30 roughly thirty times the price of turn 1.
 *
 * Note we reject client-supplied `system` messages. The system prompt is your
 * application's instruction to the model; letting the browser set it hands the
 * user a switch to turn your assistant into something else entirely.
 */
export function validateMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'messages must be a non-empty array' })
  }

  const messages = input.slice(-MAX_HISTORY_MESSAGES).map((raw, i) => {
    const role = (raw as ChatMessage)?.role
    const content = (raw as ChatMessage)?.content

    if (role !== 'user' && role !== 'assistant') {
      throw createError({
        statusCode: 400,
        statusMessage: `messages[${i}].role must be "user" or "assistant"`
      })
    }
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `messages[${i}].content must be a non-empty string`
      })
    }
    return { role, content: content.slice(0, MAX_MESSAGE_CHARS) }
  })

  if (messages.at(-1)?.role !== 'user') {
    throw createError({ statusCode: 400, statusMessage: 'The last message must be from the user' })
  }
  return messages
}

/** Validate a single free-text field (a search query, a question). */
export function validateQuery(input: unknown, field = 'query'): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a non-empty string` })
  }
  if (input.length > MAX_MESSAGE_CHARS) {
    throw createError({ statusCode: 400, statusMessage: `${field} is too long (max ${MAX_MESSAGE_CHARS} chars)` })
  }
  return input.trim()
}
