/**
 * The contract every AI backend must satisfy.
 *
 * WHY THIS EXISTS
 * ---------------
 * The single biggest mistake in a first AI integration is scattering
 * `fetch('https://api.openai.com/...')` calls across controllers. Six months
 * later the company switches to Azure OpenAI, or you want to run tests without
 * burning money, and you have to touch forty files.
 *
 * So: one narrow interface, several implementations, one factory that picks.
 * This is the same Strategy/adapter pattern you would use for a payment gateway
 * or an SMS provider in CodeIgniter — nothing AI-specific about it.
 */

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ChatOptions {
  /** 0 = deterministic/factual, 1 = creative. Use low values for RAG answers. */
  temperature?: number
  /** Hard cap on the reply length, in tokens. Your main cost lever. */
  maxTokens?: number
  /** Lets the caller abort when the browser disconnects, so you stop paying. */
  signal?: AbortSignal

  /**
   * A JSON Schema the reply must conform to.
   *
   * This is structured output, and it is categorically stronger than asking
   * nicely in the prompt. The runtime restricts token sampling to those that
   * keep the output valid against the schema, so a field name outside the enum
   * is not unlikely — it is unreachable. Prompt rules reduce mistakes;
   * a schema removes a class of them.
   *
   * Supported by Ollama (`format`) and by OpenAI (`response_format`).
   */
  jsonSchema?: Record<string, unknown>

  /**
   * Override the configured chat model for this one call.
   *
   * Useful for comparing models on the same prompt without restarting, and for
   * letting a caller pick a cheaper or stronger model per task. Ignored by the
   * offline provider, which has only one.
   */
  model?: string
}

export interface AiProvider {
  /** 'mock' | 'openai' | 'ollama' — shown in the UI so you always know what ran. */
  readonly id: string
  readonly chatModel: string
  readonly embeddingModel: string
  /** True when this provider makes real network calls that cost money. */
  readonly billable: boolean

  /**
   * Cosine score below which a retrieved passage is treated as irrelevant.
   *
   * This MUST travel with the provider, because different embedding models put
   * "relevant" at completely different values. Measured on this corpus:
   *
   *   offline TF-IDF     noise ~0.06,  genuine matches 0.09-0.36  -> floor 0.07
   *   nomic-embed-text   noise ~0.44,  genuine matches 0.54-0.81  -> floor 0.50
   *
   * Using one number for both silently disables the filter: a 0.07 floor
   * against nomic-embed-text admits absolutely everything, including answers
   * to questions the corpus cannot answer at all. Re-measure with `npm run
   * eval`, which prints the noise floor, whenever you change model or corpus.
   */
  readonly relevanceFloor: number

  /**
   * Streams the assistant reply back as text fragments ("deltas").
   * An async generator is used so the caller can `for await (...)` over it and
   * forward each fragment to the browser immediately.
   */
  streamChat(messages: ChatMessage[], opts?: ChatOptions): AsyncGenerator<string>

  /**
   * Turns text into vectors. Always batch: one HTTP call for 50 chunks is far
   * cheaper and faster than 50 calls. Returns one vector per input, in order.
   */
  embed(texts: string[]): Promise<number[][]>
}
