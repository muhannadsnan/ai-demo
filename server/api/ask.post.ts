import { requireAiProvider } from '../utils/ai/provider'
import type { ChatMessage } from '../utils/ai/types'
import { search } from '../utils/rag/store'
import { enforceRateLimit, validateQuery } from '../utils/guardrails'
import { selectRelevant, buildRagMessages, buildContext } from '../utils/rag/prompt'

/**
 * RAG — Retrieval-Augmented Generation. The "hello world" of AI search.
 *
 * The whole idea in one sentence: the model was never trained on your company's
 * documents, so before asking it a question you go and find the relevant pages
 * yourself and paste them into the prompt.
 *
 *   1. RETRIEVE  embed the question, cosine-rank your chunks, take the best few
 *   2. AUGMENT   paste those chunks into the prompt as <context>
 *   3. GENERATE  ask the model to answer *only* from that context, with citations
 *
 * That is it. No fine-tuning, no training, no GPU. It is closer to writing a
 * good SQL query and templating the result than to machine learning, which is
 * exactly why a backend developer is well placed to build it.
 *
 * Why not just paste all the documents in? Because you pay per token, prompts
 * have a size limit, and models genuinely get worse at finding a fact buried in
 * a very long context. Retrieval is what keeps the prompt small and on-target.
 */

/* The system prompt and the two relevance floors now live in utils/rag/prompt.ts,
   so that /api/trace builds an identical prompt from identical code. */

export default defineEventHandler(async (event) => {
  enforceRateLimit(event, 'ask')

  const body = await readBody<{ question?: unknown; topK?: number }>(event)
  const question = validateQuery(body?.question, 'question')
  const topK = Math.min(Math.max(Number(body?.topK) || 4, 1), 10)

  const provider = requireAiProvider()
  const abortController = new AbortController()
  event.node.req.on('close', () => abortController.abort())

  const stream = createEventStream(event)

  ;(async () => {
    const startedAt = Date.now()
    try {
      // --- 1. RETRIEVE ------------------------------------------------------
      const { hits, stats, searchMs } = await search(question, topK)
      const { relevant, topScore, cutoff } = selectRelevant(hits)

      // Send the sources first. The UI can render them immediately, and the
      // user can judge the evidence while the answer is still being written.
      await stream.push(JSON.stringify({
        type: 'sources',
        searchMs,
        stats,
        sources: relevant.map((hit, i) => ({
          marker: `S${i + 1}`,
          score: Number(hit.score.toFixed(4)),
          source: hit.chunk.source,
          docTitle: hit.chunk.docTitle,
          heading: hit.chunk.heading,
          text: hit.chunk.text.replace(/^.*\n\n/, '')
        }))
      }))

      if (relevant.length === 0) {
        await stream.push(JSON.stringify({
          type: 'delta',
          text: 'That is not covered in the indexed documents. '
            + 'Nothing in the knowledge base scored above the relevance threshold.'
        }))
        await stream.push(JSON.stringify({
          type: 'done',
          meta: {
            providerId: provider.id,
            model: provider.chatModel,
            ms: Date.now() - startedAt,
            retrieved: 0,
            topScore: Number(topScore.toFixed(4)),
            cutoff: Number(cutoff.toFixed(4))
          }
        }))
        return
      }

      // --- 2. AUGMENT -------------------------------------------------------
      // Each passage gets a marker the model is told to cite. That is the whole
      // citation mechanism: no magic, just numbered passages and an instruction.
      const context = buildContext(relevant)
      const messages: ChatMessage[] = buildRagMessages(question, relevant)

      // --- 3. GENERATE ------------------------------------------------------
      // Low temperature: for a grounded answer you want the boring, faithful
      // continuation, not a creative one.
      for await (const delta of provider.streamChat(messages, {
        temperature: 0.1,
        maxTokens: 600,
        signal: abortController.signal
      })) {
        await stream.push(JSON.stringify({ type: 'delta', text: delta }))
      }

      await stream.push(JSON.stringify({
        type: 'done',
        meta: {
          providerId: provider.id,
          model: provider.chatModel,
          ms: Date.now() - startedAt,
          retrieved: relevant.length,
          considered: hits.length,
          cutoff: Number(cutoff.toFixed(4)),
          promptChars: context.length
        }
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[api/ask] failed:', message)
      await stream.push(JSON.stringify({ type: 'error', message }))
    } finally {
      await stream.close()
    }
  })()

  return stream.send()
})
