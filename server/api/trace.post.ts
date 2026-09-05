import { requireAiProvider } from '../utils/ai/provider'
import { search, getIndex } from '../utils/rag/store'
import { chunkMarkdown } from '../utils/rag/chunk'
import { tokenize, tokenizeWithBigrams } from '../utils/rag/text'
import { hashString, cosineSimilarity } from '../utils/rag/vector'
import { selectRelevant, buildRagMessages, buildContext } from '../utils/rag/prompt'
import { validateQuery } from '../utils/guardrails'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * A "show your working" endpoint. It runs the same search a user would run, but
 * returns every intermediate value instead of just the answer.
 *
 * THIS IS A TEACHING / DEBUGGING ENDPOINT — it is deliberately not rate limited
 * and it returns full vectors, so do not ship it to production as-is. Behind
 * auth in a staging environment, though, something like it is the single most
 * useful thing you can have when retrieval misbehaves: it turns "the answer is
 * wrong" into "the right passage ranked 7th, and here is its score".
 */

const round = (n: number, places = 6) => Number(n.toFixed(places))

/** Describe a vector in a way a human can actually read. */
function describeVector(vector: number[], tokens: string[]) {
  const nonZero: Array<{ slot: number; value: number }> = []
  for (let i = 0; i < vector.length; i++) {
    if (vector[i] !== 0) nonZero.push({ slot: i, value: round(vector[i]!) })
  }

  // The vector is L2-normalised on write, so this should come back as 1.
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))

  // Where does each token land? This is the hashing trick, made concrete:
  // slot = hash(token) % dimensions. No vocabulary file, no lookup table.
  const slotOf = new Map<string, number>()
  for (const token of new Set(tokens)) {
    slotOf.set(token, hashString(token) % vector.length)
  }

  // Two tokens landing in the same slot is a collision — tolerated by design.
  const occupants = new Map<number, string[]>()
  for (const [token, slot] of slotOf) {
    occupants.set(slot, [...(occupants.get(slot) ?? []), token])
  }
  const collisions = [...occupants.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([slot, list]) => ({ slot, tokens: list }))

  return {
    dimensions: vector.length,
    nonZeroCount: nonZero.length,
    zeroCount: vector.length - nonZero.length,
    percentFilled: round((nonZero.length / vector.length) * 100, 2),
    l2Magnitude: round(magnitude),
    distinctTokens: slotOf.size,
    collisionCount: collisions.length,
    collisions: collisions.slice(0, 10),
    // Proof that the slot mapping above is real, not a story: every token's
    // slot should be non-zero in the actual vector the provider returned.
    slotMappingVerified:
      [...slotOf.values()].every(slot => vector[slot] !== 0),
    tokenSlots: [...slotOf.entries()]
      .map(([token, slot]) => ({ token, slot, valueAtSlot: round(vector[slot]!) }))
      .sort((a, b) => Math.abs(b.valueAtSlot) - Math.abs(a.valueAtSlot)),
    strongestSlots: [...nonZero]
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 20),
    allNonZeroSlots: nonZero
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ question?: unknown; topK?: number }>(event)
  const question = validateQuery(body?.question, 'question')
  const topK = Math.min(Math.max(Number(body?.topK) || 4, 1), 10)

  const provider = requireAiProvider()
  const { chunks, stats } = await getIndex()

  // Rank EVERY chunk, not just the top few, so the trace can show the full
  // scoreboard including the ones that lost.
  const { hits: allHits, searchMs } = await search(question, chunks.length)
  const hits = allHits.slice(0, topK)

  // ---- STAGE 1 · one document -> chunks ------------------------------------
  // Use the document that produced the winning chunk, so the whole trace tells
  // one story rather than jumping between files.
  const focusSource = allHits[0]!.chunk.source
  const rawMarkdown = await readFile(join(process.cwd(), 'knowledge', focusSource), 'utf8')
  const rebuiltChunks = chunkMarkdown(focusSource, rawMarkdown)

  // ---- STAGE 2 · one chunk -> tokens -> vector -----------------------------
  const focusChunk = chunks.find(c => c.id === allHits[0]!.chunk.id)!
  const chunkTokens = tokenizeWithBigrams(focusChunk.text)

  // ---- STAGE 3 · the question -> tokens -> vector --------------------------
  // NOTE: search() already embedded the question internally; this is a second
  // call purely so the trace can show the vector. Free and deterministic on the
  // offline provider; on a paid provider it would be a second billable call.
  const [questionVectorRaw] = await provider.embed([question])
  const questionVector = questionVectorRaw!

  // ---- STAGE 5 · relevance filtering ---------------------------------------
  const { relevant, topScore, cutoff } = selectRelevant(hits)

  // ---- STAGE 6 · the prompt ------------------------------------------------
  const messages = relevant.length ? buildRagMessages(question, relevant) : []
  const context = relevant.length ? buildContext(relevant) : ''
  const promptChars = messages.reduce((n, m) => n + m.content.length, 0)

  // ---- STAGE 7 · the answer ------------------------------------------------
  let answer = ''
  const generationStart = Date.now()
  if (relevant.length) {
    for await (const delta of provider.streamChat(messages, { temperature: 0.1, maxTokens: 600 })) {
      answer += delta
    }
  } else {
    answer = 'That is not covered in the indexed documents.'
  }
  const generationMs = Date.now() - generationStart

  return {
    question,
    provider: {
      id: provider.id,
      chatModel: provider.chatModel,
      embeddingModel: provider.embeddingModel,
      billable: provider.billable
    },
    index: stats,

    stage1_chunking: {
      document: focusSource,
      rawCharacters: rawMarkdown.length,
      chunksProduced: rebuiltChunks.length,
      note: 'Split on the document\'s own ## headings, then capped at ~900 chars. '
        + 'Each chunk\'s embedded text is prefixed with "DocTitle > Heading" so the '
        + 'heading words end up inside the vector.',
      chunks: rebuiltChunks.map(c => ({
        id: c.id,
        heading: c.heading,
        characters: c.text.length,
        embeddedText: c.text
      }))
    },

    stage2_documentVector: {
      chunkId: focusChunk.id,
      source: focusChunk.source,
      heading: focusChunk.heading,
      textThatGetsEmbedded: focusChunk.text,
      tokenisation: {
        note: 'Lowercase, strip punctuation, drop stop words, stem, then add '
          + 'adjacent bigrams. The embedder hashes this exact list.',
        unigramsAfterStemming: tokenize(focusChunk.text),
        totalTokensWithBigrams: chunkTokens.length,
        allTokens: chunkTokens
      },
      vector: describeVector(focusChunk.embedding, chunkTokens)
    },

    stage3_questionVector: {
      question,
      tokenisation: {
        unigramsAfterStemming: tokenize(question),
        totalTokensWithBigrams: tokenizeWithBigrams(question).length,
        allTokens: tokenizeWithBigrams(question)
      },
      vector: describeVector(questionVector, tokenizeWithBigrams(question))
    },

    stage4_ranking: {
      note: 'Cosine similarity between the question vector and every chunk '
        + 'vector, sorted. Both vectors are unit length, so cosine is just the '
        + 'dot product.',
      searchMs,
      chunksScored: allHits.length,
      // Recompute the top score by hand to show the maths is not hiding anything.
      handCheckedTopScore: round(cosineSimilarity(questionVector, focusChunk.embedding)),
      scoreboard: allHits.map((hit, i) => ({
        rank: i + 1,
        score: round(hit.score, 4),
        source: hit.chunk.source,
        heading: hit.chunk.heading,
        sharedTokens: [...new Set(tokenize(question))]
          .filter(t => new Set(tokenize(hit.chunk.text)).has(t))
      }))
    },

    stage5_relevanceFilter: {
      note: 'Cosine ranking always returns something. These two floors decide '
        + 'whether any of it is actually worth sending to the model.',
      topScore: round(topScore, 4),
      absoluteFloor: 0.07,
      relativeFloor: '0.45 x topScore',
      effectiveCutoff: round(cutoff, 4),
      kept: relevant.map((h, i) => ({
        marker: `S${i + 1}`,
        score: round(h.score, 4),
        source: h.chunk.source,
        heading: h.chunk.heading
      })),
      dropped: hits.filter(h => h.score < cutoff).map(h => ({
        score: round(h.score, 4),
        source: h.chunk.source,
        heading: h.chunk.heading
      }))
    },

    stage6_prompt: {
      note: 'This is the literal payload the model receives. The [S1] markers '
        + 'are the entire citation mechanism.',
      contextCharacters: context.length,
      totalPromptCharacters: promptChars,
      approximateTokens: Math.round(promptChars / 4),
      messages
    },

    stage7_answer: {
      providerId: provider.id,
      generationMs,
      text: answer
    }
  }
})
