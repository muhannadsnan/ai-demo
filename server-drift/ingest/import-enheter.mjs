/**
 * Import Brreg Enhetsregisteret into `enheter`.
 *
 *   node ingest/import-enheter.mjs [path/to/enheter.csv.gz]
 *
 * THE SHAPE — the same one the existing partner file imports use:
 *
 *     fetch  ->  STAGING  ->  reconcile  ->  PROMOTE
 *
 * 1. COPY the raw CSV into a staging table where every column is text. No
 *    parsing, no validation, no type errors — just get 1.47M rows into the
 *    database as fast as the disk allows.
 *
 * 2. Cast and upsert from staging into the real table in ONE statement, so the
 *    work happens inside Postgres instead of shuttling rows through Node.
 *    Rows whose content hash is unchanged are left alone.
 *
 * Why staging at all? So a bad row cannot leave the real table half-updated.
 * Everything lands somewhere disposable first, is checked, and is promoted in a
 * single transaction.
 */

import { createReadStream } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { spawn } from 'node:child_process'
import { basename } from 'node:path'
import { COLUMNS, cast } from './column-map.mjs'
import { hentHvisNyere } from './last-ned.mjs'
import { startLogg, ferdigLogg, feiletLogg } from './logg.mjs'

const NEDLASTING   = 'https://data.brreg.no/enhetsregisteret/api/enheter/lastned/csv'
/**
 * A path given on the command line is used as-is; otherwise the file is
 * downloaded if Brreg's copy is newer than ours. See ingest/last-ned.mjs for
 * why this is conditional rather than scheduled around.
 */
const FILE         = process.argv[2] || '../data/raw/enheter.csv.gz'
const OPPGITT      = Boolean(process.argv[2])
const COMPOSE_FILE = process.env.COMPOSE_FILE || 'docker-compose.local.yml'
const DB_USER      = process.env.POSTGRES_USER || 'app'
const DB_NAME      = process.env.POSTGRES_DB   || 'nordata'

const t0    = Date.now()
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`

// Refresh the source file before touching the database. A path given on the
// command line is trusted as-is, so a one-off import from a specific file still
// works.
if (!OPPGITT) {
  try {
    await hentHvisNyere(NEDLASTING, FILE)
  } catch (err) {
    console.error(`nedlasting feilet: ${err.message}`)
    // Importing a stale file is not a safe fallback here: the reconciliation
    // would read every company registered since as missing.
    process.exit(1)
  }
}

const logg = await startLogg('enheter')
process.on('uncaughtException', async e => { await feiletLogg(logg, e); process.exit(1) })

function dockerPsql(extraArgs, { stdinStream = null, inheritOut = false } = {}) {
  const args = ['compose', '-f', COMPOSE_FILE, 'exec', '-T', 'db',
                'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-U', DB_USER, '-d', DB_NAME, ...extraArgs]
  return new Promise((resolve, reject) => {
    const p = spawn('docker', args, {
      stdio: [stdinStream ? 'pipe' : 'ignore', inheritOut ? 'inherit' : 'pipe', 'pipe']
    })
    let out = '', err = ''
    if (!inheritOut) p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('close', code => code === 0
      ? resolve(out.trim())
      : reject(new Error(err.trim() || `psql exited with ${code}`)))
    if (stdinStream) {
      stdinStream.on('error', reject)
      stdinStream.pipe(p.stdin)
    }
  })
}

/** Run one or more statements, discarding output. */
const sql = statement => dockerPsql(['-c', statement])

/**
 * Run a query and get the raw values back.
 *
 * -t drops the column headers and row-count footer, -A drops the alignment
 * padding. Without both, psql returns a pretty ASCII table and every attempt to
 * read a number out of it is guesswork — which is exactly how the first version
 * of this script produced "NaN rows staged".
 */
const query = statement => dockerPsql(['-t', '-A', '-F', '|', '-c', statement])

/** Stream a gzipped CSV straight into COPY, without ever holding it in memory. */
const copyIn = path => dockerPsql(
  ['-c', `\\copy staging_enheter FROM STDIN WITH (FORMAT csv, HEADER true)`],
  { stdinStream: createReadStream(path).pipe(createGunzip()) }
)

// ---------------------------------------------------------------- 1. staging
// UNLOGGED skips the write-ahead log. The table is disposable — if this crashes
// we re-run the whole import — so paying for crash safety on 800 MB of
// throwaway data is pure cost. It roughly halves the load time.
console.log('creating staging table…')
await sql(`
  DROP TABLE IF EXISTS staging_enheter;
  CREATE UNLOGGED TABLE staging_enheter (
    ${COLUMNS.map(([csv]) => `"${csv}" text`).join(',\n    ')}
  );`)

// ------------------------------------------------------------------- 2. COPY
console.log(`streaming ${basename(FILE)} into staging…`)
await copyIn(FILE)
const staged = Number(await query('SELECT count(*) FROM staging_enheter;'))
console.log(`  ${staged.toLocaleString()} rows staged  (${since()})`)

// ------------------------------------------------------- 3. promote (upsert)
//
// THE CONTENT-HASH SKIP, in one line of SQL:
//
//   ... ON CONFLICT (organisasjonsnummer) DO UPDATE SET ...
//       WHERE enheter.content_hash IS DISTINCT FROM EXCLUDED.content_hash
//
// The hash is a fingerprint of the whole incoming row. If the stored hash
// matches the incoming one, nothing about that company changed since last
// night, and the WHERE clause makes Postgres skip the write entirely — no dead
// tuple, no index churn, no `updated_at` bump. On a daily Brreg refresh the
// overwhelming majority of 1.47M rows are untouched, so this is the difference
// between rewriting the whole table every night and rewriting the few thousand
// rows that actually moved.
const insertCols = COLUMNS.map(([, db]) => db)
const selectExprs = COLUMNS.map(([csv, , type]) => cast(csv, type))

// Everything except the primary key gets refreshed on conflict.
const updates = insertCols
  .filter(c => c !== 'organisasjonsnummer')
  .map(c => `${c} = EXCLUDED.${c}`)
  .concat(['content_hash = EXCLUDED.content_hash', 'updated_at = now()'])
  .join(',\n    ')

console.log('promoting into enheter…')
const result = await query(`
  WITH upserted AS (
    INSERT INTO enheter (${insertCols.join(', ')}, content_hash)
    SELECT
      ${selectExprs.join(',\n      ')},
      encode(sha256(s::text::bytea), 'hex')
    FROM staging_enheter s
    ON CONFLICT (organisasjonsnummer) DO UPDATE SET
      ${updates}
    WHERE enheter.content_hash IS DISTINCT FROM EXCLUDED.content_hash
    RETURNING xmax = 0 AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted)      AS new_rows,
         count(*) FILTER (WHERE NOT inserted)  AS changed_rows
  FROM upserted;`)

const [newRows, changedRows] = result.split('|').map(v => Number(v.trim()))
const total = Number(await query('SELECT count(*) FROM enheter;'))

// ------------------------------------------------- 4. detect deregistrations
//
// Brreg does not flag deletions — a deleted company just stops appearing in the
// file. Since this file is a complete snapshot, anything in `enheter` that is
// absent from staging is gone. Mark it rather than DELETE it: `roller`
// references `enheter` ON DELETE CASCADE, so removing a row would silently
// destroy every board seat and directorship attached to it.
//
// The reverse case matters too. A company that reappears (re-registered, or
// missing from one bad download) gets un-marked, so a single glitched file
// cannot permanently retire a live company.
const GRACE_DAYS = 7
const deletions = await query(`
  WITH savnet AS (
    -- First time absent: record it, do not act on it. The bulk download is not
    -- a complete picture of the register — companies have been found that are
    -- live in Brreg's API and simply missing from the file.
    UPDATE enheter e SET savnet_siden = current_date, updated_at = now()
    WHERE e.savnet_siden IS NULL AND e.slettet_dato IS NULL
      AND NOT EXISTS (SELECT 1 FROM staging_enheter s
                      WHERE s."organisasjonsnummer" = e.organisasjonsnummer)
    RETURNING 1
  ), bekreftet AS (
    -- Still absent after the grace period: now it is a deletion.
    UPDATE enheter e SET slettet_dato = current_date, updated_at = now()
    WHERE e.slettet_dato IS NULL
      AND e.savnet_siden IS NOT NULL
      AND e.savnet_siden <= current_date - ${GRACE_DAYS}
      AND NOT EXISTS (SELECT 1 FROM staging_enheter s
                      WHERE s."organisasjonsnummer" = e.organisasjonsnummer)
    RETURNING 1
  ), tilbake AS (
    -- Present again: clear both marks. One bad download cannot retire a company.
    UPDATE enheter e SET savnet_siden = NULL, slettet_dato = NULL, updated_at = now()
    WHERE (e.savnet_siden IS NOT NULL OR e.slettet_dato IS NOT NULL)
      AND EXISTS (SELECT 1 FROM staging_enheter s
                  WHERE s."organisasjonsnummer" = e.organisasjonsnummer)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM bekreftet), (SELECT count(*) FROM tilbake), (SELECT count(*) FROM savnet);`)
const [markedDeleted, reappeared, nowMissing] = deletions.split('|').map(v => Number(v.trim()))

await sql('DROP TABLE IF EXISTS staging_enheter;')

await ferdigLogg(logg, { lest: staged, nye: newRows, endret: changedRows, uendret: staged - newRows - changedRows, slettet: markedDeleted })

console.log(`
  staged      ${staged.toLocaleString()}
  inserted    ${newRows.toLocaleString()}
  updated     ${changedRows.toLocaleString()}
  unchanged   ${(staged - newRows - changedRows).toLocaleString()}   <- skipped by the content hash
  savnet      ${nowMissing.toLocaleString()}   <- absent from the file, not yet a deletion
  deregistered ${markedDeleted.toLocaleString()}   <- still absent after ${GRACE_DAYS} days
  reappeared  ${reappeared.toLocaleString()}
  ----------------------------------------
  enheter now ${total.toLocaleString()} rows        (${since()})
`)
