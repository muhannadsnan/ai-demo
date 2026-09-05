import { search } from '../utils/rag/store'
import { enforceRateLimit, validateQuery } from '../utils/guardrails'

/**
 * Pure semantic search — retrieval only, no language model involved.
 *
 * This endpoint exists on its own for a reason. Retrieval and generation are
 * two separate systems that get bolted together, and when a RAG answer is bad
 * it is *usually* retrieval's fault, not the model's. Being able to look at the
 * raw ranked passages, with scores, is the debugging tool you will reach for
 * constantly. Build this before you build the answering endpoint.
 *
 * It is also a perfectly good feature by itself: "search that understands what
 * I meant" is valuable without any chatbot attached.
 */
export default defineEventHandler(async (event) => {
  enforceRateLimit(event, 'search')

  const body = await readBody<{ query?: unknown; topK?: number }>(event)
  const query = validateQuery(body?.query)
  const topK = Math.min(Math.max(Number(body?.topK) || 5, 1), 20)

  const { hits, stats, searchMs } = await search(query, topK)

  return {
    query,
    stats,
    searchMs,
    hits: hits.map(hit => ({
      score: Number(hit.score.toFixed(4)),
      source: hit.chunk.source,
      docTitle: hit.chunk.docTitle,
      heading: hit.chunk.heading,
      // Strip the "Title > Heading" prefix we added for embedding purposes;
      // it helps the maths but is noise in the UI.
      text: hit.chunk.text.replace(/^.*\n\n/, '')
    }))
  }
})
