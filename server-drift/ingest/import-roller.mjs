/**
 * Import Brreg Roller (totalbestand) into `roller`.
 *
 *   node ingest/import-roller.mjs [path/to/roller.json.gz]
 *
 * Differs from the enheter import in two deliberate ways.
 *
 * FORMAT. This is a 2.8 GB pretty-printed JSON array, not CSV, so it cannot be
 * handed to COPY directly. It is streamed one object at a time (see
 * json-array-stream.mjs), each object is written as a single CSV-quoted line,
 * and COPY loads them into one `jsonb` column. Postgres then flattens the
 * nested arrays with `jsonb_array_elements` — the database does the unnesting,
 * not Node.
 *
 * STRATEGY. "Totalbestand" means a complete snapshot of current state, not a
 * delta. So the table is replaced wholesale inside one transaction rather than
 * upserted row by row. There is no content hash because there is nothing to
 * compare against — every load is the whole truth. Upserting 3.4M rows to
 * arrive at the same place would be slower and no more correct.
 */

import { createReadStream } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { basename } from 'node:path'
import { streamJsonArrayObjects } from './json-array-stream.mjs'

const FILE         = process.argv[2] || '../data/raw/roller.json.gz'
const COMPOSE_FILE = process.env.COMPOSE_FILE || 'docker-compose.local.yml'
const DB_USER      = process.env.POSTGRES_USER || 'app'
const DB_NAME      = process.env.POSTGRES_DB   || 'nordata'

const t0    = Date.now()
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`

function psqlArgs(extra) {
  return ['compose', '-f', COMPOSE_FILE, 'exec', '-T', 'db',
          'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-U', DB_USER, '-d', DB_NAME, ...extra]
}
function run(extra, { source = null } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('docker', psqlArgs(extra), { stdio: [source ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('close', c => c === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `psql exited ${c}`)))
    if (source) {
      // Let .pipe() handle backpressure. An earlier version wrote to stdin by
      // hand and awaited 'drain'; the write buffer filled, the drain event never
      // arrived, and the import sat at 0% CPU indefinitely. pipe() is the same
      // mechanism the enheter import uses, and it is the one that works.
      source.on('error', reject)
      source.pipe(p.stdin)
    }
  })
}
const sql   = s => run(['-c', s])
const query = s => run(['-t', '-A', '-F', '|', '-c', s])

// ------------------------------------------------------------------ staging
console.log('creating staging table…')
await sql(`DROP TABLE IF EXISTS staging_roller;
           CREATE UNLOGGED TABLE staging_roller (doc jsonb);`)

// --------------------------------------------------------- stream into COPY
console.log(`streaming ${basename(FILE)} → COPY…`)
let objects = 0

/**
 * One CSV field per line: wrap the object in quotes, double any internal quote.
 * Safer than COPY's text format, which would need backslash and tab escaping on
 * data that is full of both.
 */
async function* csvLines() {
  const src = createReadStream(FILE).pipe(createGunzip())
  src.setEncoding('utf8')   // decode across chunk boundaries, or the Norwegian letters get mangled
  for await (const obj of streamJsonArrayObjects(src)) {
    yield '"' + obj.replace(/"/g, '""') + '"\n'
    if (++objects % 200000 === 0) console.log(`  ${objects.toLocaleString()} companies... (${since()})`)
  }
}

await run(['-c', `\\copy staging_roller (doc) FROM STDIN WITH (FORMAT csv, QUOTE '"')`],
          { source: Readable.from(csvLines()) })

const staged = Number(await query('SELECT count(*) FROM staging_roller;'))
console.log(`  ${staged.toLocaleString()} company documents staged (${since()})`)

// ------------------------------------------------------- flatten and replace
// Two nested arrays: rollegrupper -> roller. jsonb_array_elements expands both,
// turning one document per company into one row per person-in-a-role.
console.log('flattening and replacing roller…')
await sql(`
BEGIN;

TRUNCATE roller;

INSERT INTO roller (
    organisasjonsnummer,
    rollegruppe_kode, rollegruppe_beskrivelse, rollegruppe_sist_endret,
    rolletype_kode, rolletype_beskrivelse,
    rekkefolge, avregistrert, valgt_av,
    person_fornavn, person_mellomnavn, person_etternavn, person_fodselsdato, person_er_doed,
    innehaver_orgnr, innehaver_navn, innehaver_organisasjonsform, innehaver_er_slettet
)
SELECT
    s.doc->>'organisasjonsnummer',
    g->'type'->>'kode',
    g->'type'->>'beskrivelse',
    nullif(g->>'sistEndret','')::date,
    r->'type'->>'kode',
    r->'type'->>'beskrivelse',
    nullif(r->>'rekkefolge','')::int,
    coalesce((r->>'avregistrert')::boolean, false),
    r->>'valgtAv',
    r->'person'->'navn'->>'fornavn',
    r->'person'->'navn'->>'mellomnavn',
    r->'person'->'navn'->>'etternavn',
    nullif(r->'person'->>'fodselsdato','')::date,
    (r->'person'->>'erDoed')::boolean,
    r->'enhet'->>'organisasjonsnummer',
    -- enhet.navn is an ARRAY of strings, so join it rather than casting to text
    -- (which would yield a JSON literal like ["ERNST & YOUNG AS"]).
    (SELECT string_agg(value, ' ') FROM jsonb_array_elements_text(r->'enhet'->'navn')),
    r->'enhet'->'organisasjonsform'->>'kode',
    (r->'enhet'->>'erSlettet')::boolean
FROM staging_roller s
CROSS JOIN LATERAL jsonb_array_elements(s.doc->'rollegrupper') g
CROSS JOIN LATERAL jsonb_array_elements(g->'roller') r
-- The foreign key requires the company to exist. Roles for entities not in the
-- companies file are counted and dropped rather than aborting the whole load.
WHERE EXISTS (SELECT 1 FROM enheter e WHERE e.organisasjonsnummer = s.doc->>'organisasjonsnummer');

COMMIT;`)

// ----------------------------------------------------------------- reporting
const dropped = Number(await query(`
  SELECT count(*) FROM staging_roller s
  CROSS JOIN LATERAL jsonb_array_elements(s.doc->'rollegrupper') g
  CROSS JOIN LATERAL jsonb_array_elements(g->'roller') r
  WHERE NOT EXISTS (SELECT 1 FROM enheter e WHERE e.organisasjonsnummer = s.doc->>'organisasjonsnummer');`))
const loaded = Number(await query('SELECT count(*) FROM roller;'))
const people = Number(await query('SELECT count(*) FROM roller WHERE person_etternavn IS NOT NULL;'))
const firms  = Number(await query('SELECT count(*) FROM roller WHERE innehaver_orgnr IS NOT NULL;'))

await sql('DROP TABLE IF EXISTS staging_roller;')

console.log(`
  companies staged   ${staged.toLocaleString()}
  roles loaded       ${loaded.toLocaleString()}
    held by people   ${people.toLocaleString()}
    held by firms    ${firms.toLocaleString()}
  dropped (no parent company in enheter)  ${dropped.toLocaleString()}
  ----------------------------------------
  done in ${since()}
`)
