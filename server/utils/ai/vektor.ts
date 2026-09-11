/**
 * Vector maths for the offline mock provider.
 *
 * Real semantic search runs in PostgreSQL now — pgvector does the distance and
 * HNSW does the lookup. This is what is left: enough arithmetic for the mock
 * embedder to produce stable, plausible vectors with no API key and no model,
 * so the app runs for someone who has just cloned it.
 */

/**
 * Cosine similarity = how close two vectors point in the same direction,
 * ignoring their length. Range -1..1; for text embeddings you will see 0..1.
 *
 *      cos(a,b) = (a · b) / (|a| * |b|)
 *
 * If both vectors are already unit length (|v| = 1), this collapses to just
 * the dot product — which is why embedding APIs return normalised vectors and
 * why production systems store them normalised. We normalise on write too.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`)
  }
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    magA += a[i]! * a[i]!
    magB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

/** Scale a vector to length 1 so cosine similarity becomes a plain dot product. */
export function l2Normalize(vec: number[]): number[] {
  let sumSquares = 0
  for (const v of vec) sumSquares += v * v
  const magnitude = Math.sqrt(sumSquares)
  if (magnitude === 0) return vec
  return vec.map(v => v / magnitude)
}

/**
 * Deterministic 32-bit string hash (FNV-1a). Used by the offline embedder to
 * map a word onto a fixed vector slot without needing a vocabulary file.
 */
export function hashString(str: string): number {
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
