import type { AiProvider, ChatMessage, ChatOptions } from './types'
import { hashString, l2Normalize } from '../rag/vector'
import { tokenize, tokenizeWithBigrams, splitSentences } from '../rag/text'

/**
 * The offline provider. No key, no network, no cost, fully deterministic.
 *
 * WHY BOTHER?
 * -----------
 * 1. The demo runs for you today, before anyone hands you an API key.
 * 2. It is how you write tests for AI features. You cannot assert on a real
 *    model's output — it changes every call. You can assert on this one.
 * 3. It proves the architecture: if the app works identically against `mock`
 *    and `openai`, your abstraction boundary is in the right place.
 *
 * BE HONEST ABOUT WHAT IT IS NOT.
 * The embeddings below are *lexical* — a TF-IDF vector, 1970s technology. They
 * match words, not meaning. Ask about "invoicing" and they will not find a
 * chunk that only says "billing"; ask in Norwegian and they will find nothing.
 * A real embedding model handles all of that, because meaning is baked into its
 * weights. That gap is exactly what you are buying, and you can see the size of
 * it by flipping NUXT_AI_PROVIDER and re-running the same queries.
 */

/**
 * Comfortably larger than the corpus vocabulary, to keep hash collisions rare.
 *
 * This number has a directly observable effect. Drop it to 256 and unrelated
 * text starts scoring 0.2+ purely from collisions, which destroys any hope of
 * a meaningful relevance threshold. Real embedding models use 384-3072
 * dimensions for the same reason: you need room to keep distinct things apart.
 */
const EMBEDDING_DIM = 4096

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export function createMockProvider(): AiProvider {
  /**
   * Corpus statistics, learned from the documents as they are indexed.
   *
   * This is IDF — inverse document frequency. A word appearing in almost every
   * chunk ("order", "service") tells you nothing about which chunk you want, so
   * it gets a low weight. A word appearing in two chunks ("certificate") is
   * highly discriminating, so it gets a high one. Without this, long chunks
   * full of common vocabulary win every query, which is exactly the failure you
   * see if you delete these three lines.
   *
   * If you have ever tuned MySQL FULLTEXT relevance, this is the same idea.
   */
  const documentFrequency = new Map<string, number>()
  let documentCount = 0

  function learnFrom(texts: string[]) {
    for (const text of texts) {
      documentCount++
      for (const token of new Set(tokenizeWithBigrams(text))) {
        documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1)
      }
    }
  }

  function inverseDocumentFrequency(token: string): number {
    const df = documentFrequency.get(token) ?? 0
    // Smoothed, and floored at 1 so an unseen query word is treated as rare
    // rather than as infinitely important.
    return Math.log((documentCount + 1) / (df + 1)) + 1
  }

  /**
   * The "hashing trick": rather than maintaining a vocabulary-to-column map,
   * hash each token straight into a fixed array slot. Collisions happen and are
   * tolerable; a second hash decides the sign so that two unrelated tokens
   * sharing a slot tend to cancel instead of always reinforcing.
   *
   * Term weight is sublinear TF (1 + log(count)) times IDF — the textbook
   * TF-IDF weighting.
   */
  function embedText(text: string): number[] {
    const vector = new Array<number>(EMBEDDING_DIM).fill(0)
    const counts = new Map<string, number>()

    for (const token of tokenizeWithBigrams(text)) {
      counts.set(token, (counts.get(token) ?? 0) + 1)
    }

    for (const [token, count] of counts) {
      const weight = (1 + Math.log(count)) * inverseDocumentFrequency(token)
      const slot = hashString(token) % EMBEDDING_DIM
      const sign = hashString(`${token}#sign`) % 2 === 0 ? 1 : -1
      vector[slot]! += sign * weight
    }

    return l2Normalize(vector)
  }

  /** Pull the retrieved passages out of the system prompt, if the caller sent any. */
  function extractContext(messages: ChatMessage[]): string {
    const joined = messages.filter(m => m.role === 'system').map(m => m.content).join('\n')
    return joined.match(/<context>([\s\S]*?)<\/context>/)?.[1]?.trim() ?? ''
  }

  /**
   * Extractive answering: pick the sentences from the retrieved context that
   * overlap most with the question, and quote them with their source markers.
   *
   * A real model does something categorically different — it synthesises across
   * passages, resolves references and writes prose. This only quotes. But it
   * demonstrates the honest truth of RAG: if retrieval hands over the wrong
   * passages, no model on earth rescues the answer.
   */
  function extractiveAnswer(question: string, context: string): string {
    const questionTokens = new Set(tokenize(question))
    if (questionTokens.size === 0) return 'Please ask a full question.'

    const blocks = context.split(/\n(?=\[S\d+\])/)
    const scored: Array<{ sentence: string; marker: string; score: number }> = []

    for (const block of blocks) {
      const marker = block.match(/^\[S\d+\]/)?.[0] ?? '[S?]'
      // Strip the [S1] marker line, then the "DocTitle > Heading" breadcrumb
      // that chunking prepended — it helps the maths but is not a sentence.
      const body = block
        .replace(/^\[S\d+\][^\n]*\n?/, '')
        .replace(/^[^\n]+ > [^\n]+\n+/, '')

      for (const sentence of splitSentences(body)) {
        const sentenceTokens = tokenize(sentence)
        if (sentenceTokens.length === 0) continue

        // Score by IDF-weighted overlap, normalised by length so that long
        // sentences do not win on sheer volume.
        let overlap = 0
        for (const token of new Set(sentenceTokens)) {
          if (questionTokens.has(token)) overlap += inverseDocumentFrequency(token)
        }
        if (overlap > 0) {
          scored.push({ sentence, marker, score: overlap / Math.sqrt(sentenceTokens.length) })
        }
      }
    }

    if (scored.length === 0) {
      return 'The retrieved passages do not appear to answer that question. '
        + 'Try rephrasing using words that actually appear in the knowledge base — '
        + 'the offline provider matches words, not meaning.'
    }

    scored.sort((a, b) => b.score - a.score)

    return 'Based on the retrieved documents:\n\n'
      + scored.slice(0, 3)
        .map(s => `- ${s.sentence.replace(/\s+/g, ' ').trim()} ${s.marker}`)
        .join('\n')
      + '\n\n(Offline mock provider: these sentences were selected by weighted word '
      + 'overlap, not written by a language model. Set NUXT_AI_PROVIDER=openai or '
      + '=ollama in .env for a real, synthesised answer.)'
  }

  return {
    id: 'mock',
    chatModel: 'offline-extractive',
    embeddingModel: `offline-tfidf-${EMBEDDING_DIM}d`,
    billable: false,
    // Measured: off-topic questions top out at 0.064 on this corpus.
    distanseTak: 1.0,  // no company vectors exist offline; never filters
  relevanceFloor: 0.07,

    async *streamChat(messages: ChatMessage[], opts: ChatOptions = {}) {
      const question = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
      const context = extractContext(messages)

      const reply = context
        ? extractiveAnswer(question, context)
        : `You said: "${question.slice(0, 200)}"\n\n`
          + 'This is the offline mock provider, so there is no language model behind '
          + 'this reply — it is a fixed template. Everything else about the request was '
          + 'real: your message went to the Nuxt server route, through the provider '
          + 'abstraction, and streamed back to the browser token by token over SSE.\n\n'
          + 'For real answers set NUXT_AI_PROVIDER=openai with a key in .env, or install '
          + 'Ollama and set NUXT_AI_PROVIDER=ollama for a free local model.'

      // Emit word by word so the streaming path is exercised exactly as it
      // would be against a real provider.
      for (const word of reply.split(/(\s+)/)) {
        if (opts.signal?.aborted) return
        yield word
        await sleep(12)
      }
    },

    async embed(texts: string[]) {
      // Only a multi-text batch is treated as "indexing a corpus". Single-text
      // calls are search queries, and letting queries pollute the document
      // statistics would slowly degrade ranking over the life of the process.
      if (texts.length > 1) learnFrom(texts)
      return texts.map(embedText)
    }
  }
}
