import { getIndex } from '../utils/rag/store'

/** Index statistics — how many documents, chunks and dimensions are loaded. */
export default defineEventHandler(async () => {
  const { chunks, stats } = await getIndex()

  const byDocument = new Map<string, { source: string; docTitle: string; chunks: number }>()
  for (const chunk of chunks) {
    const entry = byDocument.get(chunk.source)
      ?? { source: chunk.source, docTitle: chunk.docTitle, chunks: 0 }
    entry.chunks++
    byDocument.set(chunk.source, entry)
  }

  return { stats, documents: [...byDocument.values()] }
})
