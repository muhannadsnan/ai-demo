import type { ChatMessage } from '../ai/types'
import type { SearchHit } from './store'

/**
 * The AUGMENT half of RAG, in one place.
 *
 * This lives here rather than inside the API route so that `/api/ask` (which
 * answers) and `/api/trace` (which shows its working) build the prompt with
 * exactly the same code. A teaching trace that re-implements the thing it is
 * explaining will drift from reality within a week and quietly start lying.
 */

export const RAG_SYSTEM_PROMPT = `You answer questions about internal company systems
using ONLY the passages provided in <context>.

Rules:
- Cite the source marker, e.g. [S1], immediately after each claim you make.
- If the context does not contain the answer, say exactly: "That is not covered
  in the indexed documents." Do not guess, and do not use outside knowledge.
- Be concise. Two or three short paragraphs at most.`

/**
 * RELEVANCE FILTERING
 *
 * Retrieval always returns your top K, even when nothing in the corpus is
 * remotely relevant — cosine similarity has no concept of "no good answer".
 * If you skip this step, an off-topic question quietly gets answered from the
 * three least-irrelevant passages, and that is how a RAG system starts making
 * things up while still showing citations.
 *
 * Two filters, because one is not enough:
 *
 *   ABSOLUTE floor — below this, nothing is really about the question.
 *   RELATIVE floor — when one passage is clearly the best, the tail behind it
 *                    is padding. Dropping it shrinks the prompt and stops weak
 *                    passages from pulling the answer off course.
 *
 * These numbers are EMPIRICAL and provider-dependent. Measured against this
 * corpus with the offline embedder: off-topic questions top out around 0.06,
 * genuine matches start around 0.09. That is uncomfortably narrow — a real
 * embedding model separates the two far more cleanly, which is a large part of
 * what you are paying for. Re-measure whenever you change model or corpus.
 */
export const MIN_ABSOLUTE_SCORE = 0.07
export const RELATIVE_SCORE_FLOOR = 0.45

export interface Selection {
  relevant: SearchHit[]
  topScore: number
  cutoff: number
}

/** Apply both floors, and report the numbers so callers can display them. */
export function selectRelevant(hits: SearchHit[]): Selection {
  const topScore = hits[0]?.score ?? 0
  const cutoff = Math.max(MIN_ABSOLUTE_SCORE, topScore * RELATIVE_SCORE_FLOOR)
  return { relevant: hits.filter(h => h.score >= cutoff), topScore, cutoff }
}

/**
 * Number the surviving passages and glue them into one block.
 *
 * The [S1]/[S2] markers ARE the citation mechanism. There is no magic: the
 * passages are numbered here, and the system prompt tells the model to cite
 * the number. That is the entire feature.
 */
export function buildContext(relevant: SearchHit[]): string {
  return relevant
    .map((hit, i) => `[S${i + 1}] (${hit.chunk.source} > ${hit.chunk.heading})\n${hit.chunk.text}`)
    .join('\n\n')
}

/** The exact message array that goes to the model. */
export function buildRagMessages(question: string, relevant: SearchHit[]): ChatMessage[] {
  return [
    { role: 'system', content: RAG_SYSTEM_PROMPT },
    { role: 'system', content: `<context>\n${buildContext(relevant)}\n</context>` },
    { role: 'user', content: question }
  ]
}
