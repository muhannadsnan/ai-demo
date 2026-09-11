/**
 * Tokenisation for the offline mock provider. Used only by it — the real
 * pipeline sends text to an embedding API and never splits a word.
 */

/** Very common words carry no signal for retrieval, so we drop them. */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'does',
  'for', 'from', 'get', 'had', 'has', 'have', 'how', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'many', 'much', 'must', 'my', 'no', 'not', 'of', 'on',
  'or', 'our', 'should', 'so', 'some', 'than', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'to', 'was', 'we', 'were', 'what',
  'when', 'where', 'which', 'who', 'why', 'will', 'with', 'you', 'your'
])

/**
 * A deliberately crude stemmer: chops the common English suffixes so that
 * "retries", "retried" and "retry" collapse to one token.
 *
 * This is 1980s information-retrieval technology and it is here for a reason:
 * lexical search *needs* it, because "retry" and "retries" are different
 * strings and cosine similarity over word counts cannot know they are related.
 * A real embedding model needs none of this — handling morphology, synonyms
 * and paraphrase is precisely what you are paying it for. Deleting this
 * function is a good way to feel the difference.
 */
function stem(token: string): string {
  if (token.length <= 3) return token
  let t = token

  // Step 1 — plurals. Applied first so that "validations" and "validation"
  // both continue into step 2 and land on the same stem.
  if (t.endsWith('ies') && t.length > 4) t = t.slice(0, -3) + 'y'
  else if (t.endsWith('sses')) t = t.slice(0, -2)
  else if (t.endsWith('ses') && t.length > 4) t = t.slice(0, -2)
  else if (t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us')) t = t.slice(0, -1)

  // Step 2 — the common derivational endings.
  if (t.endsWith('ion') && t.length > 5) t = t.slice(0, -3)        // validation -> validat
  else if (t.endsWith('ing') && t.length > 5) t = t.slice(0, -3)   // picking    -> pick
  else if (t.endsWith('ed') && t.length > 4) t = t.slice(0, -2)    // validated  -> validat
  else if (t.endsWith('ly') && t.length > 4) t = t.slice(0, -2)    // directly   -> direct

  return t
}


/**
 * Lowercase, strip punctuation, split on whitespace, drop stop words and
 * 1-character tokens, then stem. Digits are kept (ports, versions, row counts).
 *
 * Note that `_` is a separator, so the table name `order_events` becomes the
 * tokens "order" and "event". The bigram pass below then rejoins them as
 * "order_event", so the identifier is still matchable as a unit — while a
 * question phrased as "the order events table" now matches it too.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t))
    .map(stem)
}

/**
 * Unigrams plus adjacent bigrams. Bigrams are what let "retry policy" outrank
 * a chunk that merely mentions "policy" somewhere — word order carries meaning
 * that a bag of single words throws away.
 */
export function tokenizeWithBigrams(text: string): string[] {
  const unigrams = tokenize(text)
  const bigrams: string[] = []
  for (let i = 0; i < unigrams.length - 1; i++) {
    bigrams.push(`${unigrams[i]}_${unigrams[i + 1]}`)
  }
  return [...unigrams, ...bigrams]
}

/** Rough sentence split, good enough for pulling quotable lines out of a chunk. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 20)
}
