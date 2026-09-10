#!/usr/bin/env node
/**
 * Embed what companies say they do, for semantic search.
 *
 *   node ingest/embed-foretak.mjs               # everything not yet embedded
 *   node ingest/embed-foretak.mjs --limit 5000  # a slice, for trying it out
 *
 * Reads `navn`, `aktivitet` and `vedtektsfestet_formaal`, sends them to the
 * configured embedder in batches, and stores one halfvec per company — 1536 numbers from
 * text-embedding-3-small, or 768 from nomic-embed-text. The width is taken from
 * whatever the model returns rather than written down, because it was written
 * down in three places and every one of them had to be found by hand when the
 * embedder changed.
 *
 * Resumable by design. Each row stores a hash of the exact text that was
 * embedded, so a re-run skips every company whose description has not changed —
 * the same content-hash trick the enheter import uses. Stopping this job and
 * starting it again costs one batch, not one hour.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { startLogg, ferdigLogg, feiletLogg } from './logg.mjs'

const COMPOSE_FILE = process.env.COMPOSE_FILE || 'docker-compose.local.yml'
const DB_USER  = process.env.POSTGRES_USER || 'app'
const DB_NAME  = process.env.POSTGRES_DB   || 'nordata'
/**
 * Which embedder produces the vectors. Two implementations, one interface —
 * the same shape as server/utils/ai/, because the batch job has exactly the
 * same reason to keep the vendor behind a boundary as the app does.
 *
 *   openai  (default)  no GPU, ~6 kr for the full 1.11M, runs anywhere
 *   ollama             free and local, but needs a GPU and stays on one machine
 *
 * Whichever is used, EVERY row must come from it. `modell` is stored per row
 * and HENT_SQL re-queues anything embedded by a different model, so switching
 * is a full rebuild that announces itself rather than a silent mixture.
 */
const LEVERANDOR = (process.env.EMBED_PROVIDER || 'openai').toLowerCase()
const OLLAMA   = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
const OPENAI   = process.env.NUXT_OPENAI_BASE_URL || 'https://api.openai.com/v1'
const API_KEY  = process.env.NUXT_OPENAI_API_KEY || ''
const MODELL   = process.env.EMBED_MODEL
  || (LEVERANDOR === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small')

/**
 * Task prefix — nomic only.
 *
 * nomic-embed-text is trained with the stored text and the question marked
 * differently: `search_document:` on what is indexed, `search_query:` on what
 * is asked. Measured on six descriptions and three questions, the right company
 * won by 0.011 without the prefixes and by 0.029 with them — roughly three
 * times the separation, and the difference between a usable cutoff and one that
 * admits an eiendomsutvikler into a search for dog sitters.
 *
 * text-embedding-3-small has no such convention, so a prefix there would just
 * embed the literal words "search document" into every vector. Empty for it.
 *
 * server/utils/foretak-filter.ts applies the query-side prefix under the SAME
 * condition. If one side prefixes and the other does not, questions land in a
 * different part of the space than the descriptions — the ranking goes quietly
 * wrong rather than failing.
 */
const DOK_PREFIKS = LEVERANDOR === 'ollama' ? 'search_document: ' : ''

// Ollama: 256 measured fastest on a 3060 — 285 texts/sec against 230 at batch
// 16 — and bigger batches only make a failure more expensive to retry.
// OpenAI: the limit is 2048 inputs per request, but the useful ceiling is the
// token budget, not the row count. At ~28 tokens a description, 512 rows is
// ~15k tokens — comfortably inside the per-request limit, and few enough that
// one retried batch costs a second rather than a minute.
const BOLK = Number(process.env.EMBED_BATCH || (LEVERANDOR === 'ollama' ? 256 : 512))

const arg = (navn, standard) => {
  const i = process.argv.indexOf(navn)
  return i > -1 ? process.argv[i + 1] : standard
}
const GRENSE = Number(arg('--limit', 0))

function psql(args, stdin) {
  const a = ['compose', '-f', COMPOSE_FILE, 'exec', '-T', 'db',
             'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-U', DB_USER, '-d', DB_NAME, ...args]
  return new Promise((resolve, reject) => {
    const p = spawn('docker', a, { stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('close', c => c === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `psql exited ${c}`)))
    if (stdin !== undefined) { p.stdin.end(stdin) }
  })
}

/** The text that represents a company. Kept in one place: it is hashed too. */
const HENT_SQL = `
  SELECT e.organisasjonsnummer,
         e.navn || '. ' || coalesce(e.aktivitet, e.vedtektsfestet_formaal) AS tekst
  FROM enheter e
  LEFT JOIN enheter_embedding em USING (organisasjonsnummer)
  WHERE e.slettet_dato IS NULL
    AND coalesce(e.aktivitet, e.vedtektsfestet_formaal) IS NOT NULL
    AND length(coalesce(e.aktivitet, e.vedtektsfestet_formaal)) >= 12
    AND (em.organisasjonsnummer IS NULL
         -- convert_to, NOT ::bytea. Casting text to bytea parses backslash
         -- escape sequences, so a description holding a backslash followed by
         -- an x and then anything that is not hex raises "invalid input syntax
         -- for type bytea" and kills the run — which it did, after 11,008 rows.
         -- convert_to takes the UTF-8 bytes as they are, which is also what
         -- Node's sha256 over the same string hashes.
         OR em.tekst_hash IS DISTINCT FROM encode(sha256(convert_to(
              e.navn || '. ' || coalesce(e.aktivitet, e.vedtektsfestet_formaal), 'UTF8')), 'hex')
         OR em.modell <> '${MODELL}')`

async function embedOllama(tekster) {
  const svar = await fetch(`${OLLAMA}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODELL, input: tekster })
  })
  if (!svar.ok) throw new Error(`ollama ${svar.status}: ${(await svar.text()).slice(0, 200)}`)
  const d = await svar.json()
  if (!d.embeddings || d.embeddings.length !== tekster.length) {
    throw new Error(`ollama returnerte ${d.embeddings?.length} vektorer for ${tekster.length} tekster`)
  }
  return d.embeddings
}

async function embedOpenai(tekster) {
  const svar = await fetch(`${OPENAI}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODELL, input: tekster })
  })
  if (!svar.ok) {
    const feil = new Error(`openai ${svar.status}: ${(await svar.text()).slice(0, 200)}`)
    feil.status = svar.status
    throw feil
  }
  const d = await svar.json()
  if (!Array.isArray(d.data) || d.data.length !== tekster.length) {
    throw new Error(`openai returnerte ${d.data?.length} vektorer for ${tekster.length} tekster`)
  }
  // The response does not promise input order, and a vector attached to the
  // wrong company is the one failure here that produces no error at all — it
  // just makes the search quietly wrong. Sort by the index the API returns.
  return d.data.slice().sort((a, b) => a.index - b.index).map(r => r.embedding)
}

const enBolk = LEVERANDOR === 'ollama' ? embedOllama : embedOpenai

/**
 * Retry with exponential backoff and jitter.
 *
 * The previous run died after 486,912 rows because a single fetch failed and
 * nothing caught it — five hours of work ended on one bad response. Over a
 * million rows a transient failure is not exceptional, it is expected: rate
 * limits, a dropped connection, a model that stalls. docs/05 lists this as an
 * unticked box; this ticks it.
 *
 * 4xx other than 429 is not retried. A malformed request fails the same way
 * every time, and retrying it just spends the budget more slowly.
 */
async function embed(tekster, forsok = 0) {
  try {
    return await enBolk(tekster)
  } catch (e) {
    const permanent = e.status && e.status !== 429 && e.status < 500
    if (permanent || forsok >= 5) throw e
    const ventMs = Math.round(1000 * 2 ** forsok * (0.5 + Math.random()))
    process.stdout.write(`\n  ${e.message.slice(0, 90)} — nytt forsøk om ${(ventMs / 1000).toFixed(1)}s\n`)
    await new Promise(r => setTimeout(r, ventMs))
    return embed(tekster, forsok + 1)
  }
}

const igjen = Number(await psql(['-tAc', `SELECT count(*) FROM (${HENT_SQL}) s`]))
const total = GRENSE ? Math.min(GRENSE, igjen) : igjen
console.log(`${igjen.toLocaleString('nb-NO')} foretak mangler embedding${GRENSE ? `, tar ${total.toLocaleString('nb-NO')}` : ''}`)
if (!total) process.exit(0)

const logg = await startLogg('embedding').catch(() => null)
const t0 = Date.now()
let gjort = 0

try {
  while (gjort < total) {
    const n = Math.min(BOLK, total - gjort)
    // Re-queried each round rather than paged with OFFSET: rows leave the set
    // as they are embedded, so "the next 256 missing" is always LIMIT n and an
    // OFFSET would skip the ones just written.
    const rå = await psql(['-tAc', `${HENT_SQL} ORDER BY e.organisasjonsnummer LIMIT ${n}`])
    if (!rå) break

    const rader = rå.split('\n').map(l => {
      const i = l.indexOf('|')
      return { orgnr: l.slice(0, i), tekst: l.slice(i + 1) }
    }).filter(r => r.orgnr.length === 9)
    if (!rader.length) break

    const vektorer = await embed(rader.map(r => DOK_PREFIKS + r.tekst))

    // COPY, not 256 INSERTs. Same reason the bulk import uses it.
    //
    // The data travels INSIDE the script rather than as a separate stdin
    // stream: `psql -c` never reads stdin for COPY, so the copy data has to
    // follow the COPY statement and end with a lone backslash-dot, exactly as
    // in a .sql dump. The whole thing is one psql session, which is also what
    // makes the TEMP table visible to the INSERT that follows it.
    const tsv = rader.map((r, i) => [
      r.orgnr,
      createHash('sha256').update(r.tekst).digest('hex'),
      MODELL,
      `[${vektorer[i].map(v => v.toFixed(6)).join(',')}]`
    ].join('\t')).join('\n')

    await psql([], `
      CREATE TEMP TABLE ny (organisasjonsnummer char(9), tekst_hash char(64), modell text, embedding halfvec(${vektorer[0].length}));
      COPY ny FROM STDIN;
${tsv}
\\.
      INSERT INTO enheter_embedding (organisasjonsnummer, tekst_hash, modell, embedding)
      SELECT * FROM ny
      ON CONFLICT (organisasjonsnummer) DO UPDATE SET
        tekst_hash = EXCLUDED.tekst_hash, modell = EXCLUDED.modell,
        embedding = EXCLUDED.embedding, oppdatert_at = now();
      DROP TABLE ny;
`)

    gjort += rader.length
    const sek = (Date.now() - t0) / 1000
    const fart = gjort / sek
    const igjenSek = Math.round((total - gjort) / fart)
    process.stdout.write(
      `\r  ${gjort.toLocaleString('nb-NO')} / ${total.toLocaleString('nb-NO')}` +
      `  ${fart.toFixed(0)}/sek  ~${Math.floor(igjenSek / 60)}m ${igjenSek % 60}s igjen   `)
  }
  console.log()
  const ms = Date.now() - t0
  console.log(`ferdig: ${gjort.toLocaleString('nb-NO')} embeddinger på ${(ms / 1000 / 60).toFixed(1)} min`)

  /**
   * Build the approximate-nearest-neighbour index once, at the end.
   *
   * HNSW maintains itself on INSERT, so creating it first would have made every
   * one of the batches above slower for no benefit while the table was still
   * filling. Building it after is one pass over finished data.
   *
   * Without it, a search is an exact scan of every vector — correct, and far
   * too slow to put behind a search box.
   */
  const harIndeks = await psql(['-tAc',
    `SELECT count(*) FROM pg_indexes WHERE tablename = 'enheter_embedding' AND indexname = 'enheter_embedding_hnsw'`])
  if (harIndeks === '0') {
    console.log('bygger HNSW-indeks (dette tar noen minutter) …')
    const tIdx = Date.now()
    await psql(['-c', `
      SET maintenance_work_mem = '1GB';
      SET max_parallel_maintenance_workers = 3;
      CREATE INDEX enheter_embedding_hnsw ON enheter_embedding
        USING hnsw (embedding halfvec_cosine_ops);`])
    console.log(`  ferdig på ${((Date.now() - tIdx) / 1000 / 60).toFixed(1)} min`)
  }
  if (logg) await ferdigLogg(logg, { lest: gjort, endret: gjort }).catch(() => {})
} catch (e) {
  console.error(`\nstoppet etter ${gjort}: ${e.message}`)
  if (logg) await feiletLogg(logg, e.message).catch(() => {})
  process.exit(1)
}
