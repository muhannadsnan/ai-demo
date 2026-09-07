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
// Watermarks taken before the transaction, so the counts below are exact.
// Counting `WHERE forst_sett = current_date` would be wrong: migration 012 added
// that column with DEFAULT current_date, stamping every pre-existing row with
// the backfill date and making the first run report 3.4M "new" roles.
const beforeRoller = Number(await query('SELECT coalesce(max(id),0) FROM roller;'))
const beforeHist   = Number(await query('SELECT coalesce(max(id),0) FROM roller_historikk;'))

console.log('flattening and reconciling roller...')

// Roles are reconciled rather than replaced. The previous version truncated the
// table, which is correct for a snapshot and destroys history: "Ola sat on this
// board until March 2024" was gone the next morning.
//
// Instead: build the incoming set, archive current roles that are no longer
// present, insert the ones that are genuinely new, and leave unchanged roles
// untouched so their `forst_sett` date survives. That is a slowly-changing
// dimension, type 2.
await sql(`
BEGIN;

CREATE TEMP TABLE incoming_roller ON COMMIT DROP AS
SELECT
    s.doc->>'organisasjonsnummer'                       AS organisasjonsnummer,
    g->'type'->>'kode'                                  AS rollegruppe_kode,
    g->'type'->>'beskrivelse'                           AS rollegruppe_beskrivelse,
    nullif(g->>'sistEndret','')::date                   AS rollegruppe_sist_endret,
    r->'type'->>'kode'                                  AS rolletype_kode,
    r->'type'->>'beskrivelse'                           AS rolletype_beskrivelse,
    nullif(r->>'rekkefolge','')::int                    AS rekkefolge,
    coalesce((r->>'avregistrert')::boolean, false)      AS avregistrert,
    r->>'valgtAv'                                       AS valgt_av,
    r->'person'->'navn'->>'fornavn'                     AS person_fornavn,
    r->'person'->'navn'->>'mellomnavn'                  AS person_mellomnavn,
    r->'person'->'navn'->>'etternavn'                   AS person_etternavn,
    nullif(r->'person'->>'fodselsdato','')::date        AS person_fodselsdato,
    (r->'person'->>'erDoed')::boolean                   AS person_er_doed,
    r->'enhet'->>'organisasjonsnummer'                  AS innehaver_orgnr,
    (SELECT string_agg(value,' ') FROM jsonb_array_elements_text(r->'enhet'->'navn')) AS innehaver_navn,
    r->'enhet'->'organisasjonsform'->>'kode'            AS innehaver_organisasjonsform,
    (r->'enhet'->>'erSlettet')::boolean                 AS innehaver_er_slettet
FROM staging_roller s
CROSS JOIN LATERAL jsonb_array_elements(s.doc->'rollegrupper') g
CROSS JOIN LATERAL jsonb_array_elements(g->'roller') r
WHERE EXISTS (SELECT 1 FROM enheter e WHERE e.organisasjonsnummer = s.doc->>'organisasjonsnummer');

-- The same fingerprint the roller table generates, so the two can be compared.
ALTER TABLE incoming_roller ADD COLUMN rolle_nokkel text;
UPDATE incoming_roller SET rolle_nokkel =
    organisasjonsnummer || '|' || rollegruppe_kode || '|' || rolletype_kode || '|' ||
    coalesce(innehaver_orgnr,'') || '|' || coalesce(person_etternavn,'') || '|' ||
    coalesce(person_fornavn,'') || '|' ||
    coalesce((person_fodselsdato - DATE '1970-01-01')::text,'') || '|' ||
    coalesce(rekkefolge::text,'');
CREATE INDEX ON incoming_roller (rolle_nokkel);

-- 1. Archive roles that have ended.
INSERT INTO roller_historikk (
    organisasjonsnummer, rollegruppe_kode, rollegruppe_beskrivelse,
    rolletype_kode, rolletype_beskrivelse, rekkefolge, valgt_av,
    person_fornavn, person_mellomnavn, person_etternavn, person_fodselsdato,
    innehaver_orgnr, innehaver_navn, innehaver_organisasjonsform,
    forst_sett, sist_sett)
SELECT r.organisasjonsnummer, r.rollegruppe_kode, r.rollegruppe_beskrivelse,
       r.rolletype_kode, r.rolletype_beskrivelse, r.rekkefolge, r.valgt_av,
       r.person_fornavn, r.person_mellomnavn, r.person_etternavn, r.person_fodselsdato,
       r.innehaver_orgnr, r.innehaver_navn, r.innehaver_organisasjonsform,
       r.forst_sett, current_date
FROM roller r
WHERE NOT EXISTS (SELECT 1 FROM incoming_roller i WHERE i.rolle_nokkel = r.rolle_nokkel);

DELETE FROM roller r
WHERE NOT EXISTS (SELECT 1 FROM incoming_roller i WHERE i.rolle_nokkel = r.rolle_nokkel);

-- 2. Insert roles that are new. Unchanged roles are left alone, so their
--    forst_sett keeps saying when the person actually took the seat.
INSERT INTO roller (
    organisasjonsnummer, rollegruppe_kode, rollegruppe_beskrivelse, rollegruppe_sist_endret,
    rolletype_kode, rolletype_beskrivelse, rekkefolge, avregistrert, valgt_av,
    person_fornavn, person_mellomnavn, person_etternavn, person_fodselsdato, person_er_doed,
    innehaver_orgnr, innehaver_navn, innehaver_organisasjonsform, innehaver_er_slettet,
    forst_sett)
SELECT i.organisasjonsnummer, i.rollegruppe_kode, i.rollegruppe_beskrivelse, i.rollegruppe_sist_endret,
       i.rolletype_kode, i.rolletype_beskrivelse, i.rekkefolge, i.avregistrert, i.valgt_av,
       i.person_fornavn, i.person_mellomnavn, i.person_etternavn, i.person_fodselsdato, i.person_er_doed,
       i.innehaver_orgnr, i.innehaver_navn, i.innehaver_organisasjonsform, i.innehaver_er_slettet,
       current_date
FROM incoming_roller i
WHERE NOT EXISTS (SELECT 1 FROM roller r WHERE r.rolle_nokkel = i.rolle_nokkel);

COMMIT;`)

// ----------------------------------------------------------------- reporting
const dropped = Number(await query(`
  SELECT count(*) FROM staging_roller s
  CROSS JOIN LATERAL jsonb_array_elements(s.doc->'rollegrupper') g
  CROSS JOIN LATERAL jsonb_array_elements(g->'roller') r
  WHERE NOT EXISTS (SELECT 1 FROM enheter e WHERE e.organisasjonsnummer = s.doc->>'organisasjonsnummer');`))
const loaded    = Number(await query('SELECT count(*) FROM roller;'))
const archived  = Number(await query(`SELECT count(*) FROM roller_historikk WHERE id > ${beforeHist};`))
const brandNew  = Number(await query(`SELECT count(*) FROM roller WHERE id > ${beforeRoller};`))
const people = Number(await query('SELECT count(*) FROM roller WHERE person_etternavn IS NOT NULL;'))
const firms  = Number(await query('SELECT count(*) FROM roller WHERE innehaver_orgnr IS NOT NULL;'))

await sql('DROP TABLE IF EXISTS staging_roller;')

console.log(`
  companies staged   ${staged.toLocaleString()}
  roles now current  ${loaded.toLocaleString()}
    newly seen today ${brandNew.toLocaleString()}
    archived today   ${archived.toLocaleString()}   <- roles that ended
    held by people   ${people.toLocaleString()}
    held by firms    ${firms.toLocaleString()}
  dropped (no parent company in enheter)  ${dropped.toLocaleString()}
  ----------------------------------------
  done in ${since()}
`)
