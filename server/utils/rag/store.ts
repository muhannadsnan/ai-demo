import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chunkMarkdown, type Chunk } from './chunk'
import { cosineSimilarity, l2Normalize } from './vector'
import { getAiProvider, requireAiProvider } from '../ai/provider'

/**
 * A vector index, in memory, in about a hundred lines.
 *
 * This is deliberately the simplest thing that works: an array of chunks, each
 * with its embedding, scanned linearly on every query. For a few hundred or a
 * few thousand chunks that is genuinely fine — cosine over 2,000 x 384 floats
 * is well under a millisecond.
 *
 * You only need pgvector / Qdrant / MySQL 9 VECTOR when (a) the corpus stops
 * fitting in RAM, (b) you cannot afford to re-embed on every deploy, or (c) you
 * need approximate nearest-neighbour indexing because linear scan got slow.
 * See docs/04 for how this maps onto MySQL. Do not start there.
 *
 * PRODUCTION CAVEAT: rebuilding the index at boot means every deploy re-pays
 * the embedding cost and every instance holds its own copy. Real systems embed
 * once at ingest time and persist the vectors.
 */

export interface IndexedChunk extends Chunk {
  embedding: number[]
}

export interface SearchHit {
  chunk: Chunk
  /** Cosine similarity, roughly 0..1. Higher is closer. */
  score: number
}

export interface IndexStats {
  documents: number
  chunks: number
  dimensions: number
  providerId: string
  embeddingModel: string
  buildMs: number
}

interface BuiltIndex {
  chunks: IndexedChunk[]
  stats: IndexStats
}

const KNOWLEDGE_DIR = join(process.cwd(), 'knowledge')

let indexPromise: Promise<BuiltIndex> | null = null
let builtForProvider = ''

async function build(): Promise<BuiltIndex> {
  const startedAt = Date.now()
  const provider = requireAiProvider()

  const files = (await readdir(KNOWLEDGE_DIR)).filter(f => f.endsWith('.md')).sort()
  if (files.length === 0) {
    throw new Error(`No .md files found in ${KNOWLEDGE_DIR}`)
  }

  // 1. READ + CHUNK -----------------------------------------------------------
  const chunks: Chunk[] = []
  for (const file of files) {
    const markdown = await readFile(join(KNOWLEDGE_DIR, file), 'utf8')
    chunks.push(...chunkMarkdown(file, markdown))
  }

  // 2. EMBED ------------------------------------------------------------------
  // Batched, because one request for 50 chunks costs the same as 50 requests
  // for 1 chunk but takes a fiftieth of the wall time. 64 is a safe batch size
  // for OpenAI; very large batches can exceed the request size limit.
  const embeddings: number[][] = []
  const BATCH = 64
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH).map(c => c.text)
    embeddings.push(...await provider.embed(batch))
  }

  // 3. STORE ------------------------------------------------------------------
  // Normalising on write means query time is a pure dot product.
  const indexed: IndexedChunk[] = chunks.map((chunk, i) => ({
    ...chunk,
    embedding: l2Normalize(embeddings[i]!)
  }))

  return {
    chunks: indexed,
    stats: {
      documents: files.length,
      chunks: indexed.length,
      dimensions: indexed[0]?.embedding.length ?? 0,
      providerId: provider.id,
      embeddingModel: provider.embeddingModel,
      buildMs: Date.now() - startedAt
    }
  }
}

/**
 * Build once, reuse forever. Assigning the *promise* (not the result) before
 * awaiting is what makes this safe under concurrency: two simultaneous first
 * requests share one build instead of both paying for embeddings.
 */
export function getIndex(): Promise<BuiltIndex> {
  const providerId = requireAiProvider().id
  if (!indexPromise || builtForProvider !== providerId) {
    builtForProvider = providerId
    indexPromise = build().catch(err => {
      indexPromise = null   // let the next request retry instead of caching failure
      throw err
    })
  }
  return indexPromise
}

/**
 * Semantic search: embed the query with the *same model* used for the chunks,
 * then rank every chunk by cosine similarity.
 *
 * Using a different model for query and documents is the single most common
 * RAG bug. The vectors live in different spaces; the scores become noise.
 */
export async function search(query: string, topK = 5): Promise<{
  hits: SearchHit[]
  stats: IndexStats
  searchMs: number
}> {
  const startedAt = Date.now()
  const { chunks, stats } = await getIndex()
  const provider = requireAiProvider()

  const [queryEmbedding] = await provider.embed([query])
  const queryVector = l2Normalize(queryEmbedding!)

  const hits = chunks
    .map(chunk => ({ chunk, score: cosineSimilarity(queryVector, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)

  return { hits, stats, searchMs: Date.now() - startedAt }
}

/** Force a rebuild — handy after editing a file in knowledge/. */
export function invalidateIndex() {
  indexPromise = null
  builtForProvider = ''
}
