/**
 * Chunking: cutting documents into retrievable pieces.
 *
 * This is the step people skip, and it is the step that decides whether your
 * RAG demo is impressive or useless. Two failure modes:
 *
 *   Chunks too big   -> you retrieve three pages to answer one sentence. The
 *                       relevant line is diluted, the similarity score drops,
 *                       and you pay for a huge prompt.
 *   Chunks too small -> the answer is split across two chunks and you retrieve
 *                       neither, because neither one alone looks relevant.
 *
 * Rules of thumb that hold up well: respect the document's own structure first
 * (headings, paragraphs), then cap by size, then overlap slightly so a sentence
 * spanning a boundary still appears whole somewhere.
 */

export interface Chunk {
  id: string
  /** File it came from, e.g. "systems-overview.md" — shown as the citation. */
  source: string
  /** The document's H1. */
  docTitle: string
  /** Nearest preceding heading, so a citation can say *where* in the doc. */
  heading: string
  text: string
}

const MAX_CHARS = 900      // ~200-250 tokens: one focused idea
const OVERLAP_CHARS = 150  // one or two sentences of run-on into the next chunk

/**
 * Split a long section on paragraph boundaries, falling back to a hard cut
 * only when a single paragraph is itself oversized.
 */
function splitBySize(text: string): string[] {
  if (text.length <= MAX_CHARS) return [text]

  const parts: string[] = []
  const paragraphs = text.split(/\n\s*\n/)
  let current = ''

  for (const paragraph of paragraphs) {
    if (current && (current.length + paragraph.length + 2) > MAX_CHARS) {
      parts.push(current.trim())
      // Carry the tail of the previous chunk forward as overlap.
      current = current.slice(-OVERLAP_CHARS) + '\n\n'
    }
    current += paragraph + '\n\n'

    // A single paragraph longer than the cap: cut it on whitespace.
    while (current.length > MAX_CHARS * 1.5) {
      const cut = current.lastIndexOf(' ', MAX_CHARS)
      const at = cut > MAX_CHARS / 2 ? cut : MAX_CHARS
      parts.push(current.slice(0, at).trim())
      current = current.slice(at - OVERLAP_CHARS)
    }
  }

  if (current.trim()) parts.push(current.trim())
  return parts.filter(p => p.length > 0)
}

/**
 * Turn one markdown document into chunks, keeping heading context attached.
 *
 * Note that each chunk's text is prefixed with "DocTitle > Heading". That is a
 * cheap and very effective trick: the heading words end up inside the embedded
 * text, so a chunk under "## Error handling" is findable by the word "error"
 * even if the body never repeats it.
 */
export function chunkMarkdown(source: string, markdown: string): Chunk[] {
  const lines = markdown.split('\n')
  const docTitle = lines.find(l => l.startsWith('# '))?.replace(/^#\s+/, '').trim()
    || source.replace(/\.md$/, '')

  const sections: Array<{ heading: string; body: string[] }> = []
  let current = { heading: docTitle, body: [] as string[] }

  for (const line of lines) {
    if (/^#{2,3}\s+/.test(line)) {
      if (current.body.join('\n').trim()) sections.push(current)
      current = { heading: line.replace(/^#{2,3}\s+/, '').trim(), body: [] }
    } else if (!line.startsWith('# ')) {
      current.body.push(line)
    }
  }
  if (current.body.join('\n').trim()) sections.push(current)

  const chunks: Chunk[] = []
  for (const section of sections) {
    const body = section.body.join('\n').trim()
    if (!body) continue

    for (const piece of splitBySize(body)) {
      chunks.push({
        id: `${source}#${chunks.length}`,
        source,
        docTitle,
        heading: section.heading,
        text: `${docTitle} > ${section.heading}\n\n${piece}`
      })
    }
  }

  return chunks
}
