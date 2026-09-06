/**
 * Retrieval evaluation — run with `npm run eval` while the dev server is up.
 *
 * WHY THIS FILE MATTERS MORE THAN IT LOOKS
 * ----------------------------------------
 * Almost every RAG tutorial stops at "it returned something plausible". That is
 * not engineering. The moment you change the chunk size, the embedding model,
 * the stop-word list or the relevance threshold, retrieval quality moves — and
 * without a measurement you will not know whether it moved up or down.
 *
 * So: write down question/expected-document pairs, and score them. This is the
 * AI equivalent of a regression test suite, and twenty golden questions will
 * catch more real problems than any amount of eyeballing.
 *
 * Two metrics, both worth watching:
 *   top-1     the best passage is the right one           (precision at the top)
 *   recall@k  the right passage is somewhere in the top K (can RAG even see it?)
 *
 * recall@k is the one that limits your answers: a passage that never gets
 * retrieved can never be cited, no matter how good the model is.
 */

const BASE = process.env.EVAL_BASE_URL || 'http://localhost:3000'
const TOP_K = 3

/** Golden set: question -> a regex matching the document that should answer it. */
const CASES = [
  ['How many times does a failed message retry?',           /03-integration-bus/],
  ['What happens when an import rejects too many rows?',    /04-import-routines/],
  ['Which tables must not be altered directly?',            /05-database-and-migrations/],
  ['Orders are stuck after validation, what do I check?',   /06-incident-runbook/],
  ['When do the partner certificates expire?',              /integration-bus|incident-runbook/],
  ['What authentication does the order API use?',           /02-order-service/],
  ['How long are import files kept?',                       /04-import-routines/],
  ['What is the on-call rotation?',                         /01-systems-overview/],
  ['How big is the order events table?',                    /05-database-and-migrations/],
  ['What do I do when the bus queue depth alarm fires?',    /06-incident-runbook|03-integration-bus/],
  ['Which encodings do partner files use?',                 /04-import-routines/],
  ['What are the order states?',                            /02-order-service/]
]

/**
 * A second set, deliberately phrased to AVOID the documents' own vocabulary.
 *
 * This exists because the set above is biased. It was written by whoever wrote
 * the corpus, so it reuses the documents' words — which quietly rewards lexical
 * matching and flatters a keyword-based embedder. Users do not phrase questions
 * in your documentation's words, so this set is the more honest predictor of
 * production quality.
 *
 * Measured on this corpus: the offline TF-IDF embedder beats nomic-embed-text on
 * the set above (12/12 vs 10/12) and loses badly on this one (5/8 vs 7/8, and
 * recall 6/8 vs 8/8). Same corpus, opposite conclusion, purely from how the
 * questions were worded.
 */
const PARAPHRASED = [
  ['What happens if a partner lets their security credentials lapse?', /incident-runbook|integration-bus/],
  ['Who is responsible outside normal working hours?',                 /systems-overview/],
  ['How do we avoid loading the same data twice?',                     /import-routines/],
  ['The warehouse assignment stopped working, now what?',              /incident-runbook/],
  ['Can I add a column to a huge table safely?',                       /database-and-migrations/],
  ['What proves a client is allowed to call the service?',             /order-service/],
  ['Why do Norwegian letters come out wrong?',                         /import-routines/],
  ['How long before we give up delivering a message?',                 /integration-bus/]
]

/** Questions with no answer in the corpus. The top score here is your noise floor. */
const OFF_TOPIC = [
  'what is the best recipe for sourdough bread',
  'how do I tune a guitar',
  'photosynthesis in tropical plants'
]

async function search(query, topK = TOP_K) {
  const res = await fetch(`${BASE}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, topK })
  })
  if (res.status === 429) {
    throw new Error(
      'Rate limited. This suite makes ~24 requests; raise the cap with '
      + 'NUXT_RATE_LIMIT_PER_MINUTE=200 npm run dev'
    )
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — is \`npm run dev\` running?`)
  return res.json()
}

let top1 = 0
let recallAtK = 0

console.log(`\nRetrieval evaluation against ${BASE}  (top-${TOP_K})\n`)

for (const [question, expected] of CASES) {
  const { hits } = await search(question)
  const best = hits[0]
  const isTop1 = expected.test(best?.source ?? '')
  const inTopK = hits.some(h => expected.test(h.source))

  if (isTop1) top1++
  if (inTopK) recallAtK++

  const mark = isTop1 ? 'PASS ' : inTopK ? 'top-k' : 'MISS '
  console.log(
    `${mark} ${question.padEnd(52)} ${(best?.score ?? 0).toFixed(3)}  `
    + `${best?.source ?? '-'} > ${best?.heading ?? '-'}`
  )
}

let para1 = 0, paraK = 0
console.log('\nParaphrased — wording deliberately unlike the documents:\n')
for (const [question, expected] of PARAPHRASED) {
  const { hits } = await search(question)
  const best = hits[0]
  const isTop1 = expected.test(best?.source ?? '')
  const inTopK = hits.some(h => expected.test(h.source))
  if (isTop1) para1++
  if (inTopK) paraK++
  console.log(
    `${isTop1 ? 'PASS ' : inTopK ? 'top-k' : 'MISS '} ${question.padEnd(52)} `
    + `${(best?.score ?? 0).toFixed(3)}  ${best?.source ?? '-'} > ${best?.heading ?? '-'}`
  )
}

console.log('\nNoise floor (questions the corpus cannot answer):')
let worstNoise = 0
for (const question of OFF_TOPIC) {
  const { hits } = await search(question, 1)
  const score = hits[0]?.score ?? 0
  worstNoise = Math.max(worstNoise, score)
  console.log(`  ${score.toFixed(3)}  ${question}`)
}

const { stats } = await search('warm up', 1)

console.log('\n' + '-'.repeat(74))
console.log(`provider      ${stats.providerId} / ${stats.embeddingModel}`)
console.log(`corpus        ${stats.documents} documents, ${stats.chunks} chunks, ${stats.dimensions}d`)
console.log(`top-1         ${top1}/${CASES.length}        (questions using the documents' own words)`)
console.log(`recall@${TOP_K}      ${recallAtK}/${CASES.length}`)
console.log(`paraphrased   ${para1}/${PARAPHRASED.length}  top-1, ${paraK}/${PARAPHRASED.length} recall  <- the honest predictor`)
console.log(`noise floor   ${worstNoise.toFixed(3)}  <- AiProvider.relevanceFloor must sit above this`)
console.log('-'.repeat(74) + '\n')

// Non-zero exit on regression, so this can go in CI.
process.exit(recallAtK === CASES.length && top1 >= CASES.length - 2 && paraK >= PARAPHRASED.length - 2 ? 0 : 1)
