/**
 * Import the reference tables: fylker, kommuner, naeringskoder, postnummer.
 *
 *   node ingest/import-reference.mjs
 *
 * These are small — a few thousand rows in total — so they are simply replaced
 * on every run. No staging table, no content hash: at this size the machinery
 * would cost more than it saves.
 *
 * Two of the four come straight from SSB's JSON API. The fourth, Bring's
 * postcode file, is TAB-SEPARATED TEXT IN ISO-8859-1 — not UTF-8. Reading it as
 * UTF-8 does not throw; it silently mangles every Norwegian character, so
 * BÆRUM becomes B?RUM and the join to kommuner still works while the display
 * name is quietly wrong. This is exactly the class of bug the import notes warn
 * about, and the fix is one argument.
 */

import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { readFile } from 'node:fs/promises'

const COMPOSE_FILE = process.env.COMPOSE_FILE || 'docker-compose.local.yml'
const DB_USER      = process.env.POSTGRES_USER || 'app'
const DB_NAME      = process.env.POSTGRES_DB   || 'nordata'
const POSTNR_FILE  = process.argv[2] || '../data/raw/postnummer.txt'

const SSB = date => ({
  fylker:        `https://data.ssb.no/api/klass/v1/classifications/104/codesAt?date=${date}`,
  kommuner:      `https://data.ssb.no/api/klass/v1/classifications/131/codesAt?date=${date}`,
  naeringskoder: `https://data.ssb.no/api/klass/v1/classifications/6/codesAt?date=${date}`
})

function run(extra, { source = null } = {}) {
  const args = ['compose', '-f', COMPOSE_FILE, 'exec', '-T', 'db',
                'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-U', DB_USER, '-d', DB_NAME, ...extra]
  return new Promise((resolve, reject) => {
    const p = spawn('docker', args, { stdio: [source ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('close', c => c === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `psql exited ${c}`)))
    if (source) { source.on('error', reject); source.pipe(p.stdin) }
  })
}
const sql   = s => run(['-c', s])
const query = s => run(['-t', '-A', '-F', '|', '-c', s])

/** CSV-quote a value for COPY. */
const q = v => v === null || v === undefined || v === ''
  ? ''
  : '"' + String(v).replace(/"/g, '""') + '"'

async function copyRows(table, columns, rows) {
  const lines = rows.map(r => r.map(q).join(',') + '\n')
  await run(['-c', `\\copy ${table} (${columns.join(',')}) FROM STDIN WITH (FORMAT csv, QUOTE '"')`],
            { source: Readable.from(lines) })
}

const today = new Date().toISOString().slice(0, 10)
const urls  = SSB(today)

async function ssb(name) {
  const res = await fetch(urls[name], { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return (await res.json()).codes ?? []
}

console.log('fetching SSB classifications…')
const [fylker, kommuner, nace] = await Promise.all([ssb('fylker'), ssb('kommuner'), ssb('naeringskoder')])
console.log(`  fylker ${fylker.length}, kommuner ${kommuner.length}, naeringskoder ${nace.length}`)

// ---- Bring postcodes: ISO-8859-1, tab separated, CRLF line endings, no header
console.log('reading the Bring postcode file…')
const raw = await readFile(POSTNR_FILE)
// The one argument that matters. 'latin1' here, not 'utf8'.
const text = new TextDecoder('iso-8859-1').decode(raw)
const postnummer = text
  .split(/\r?\n/)
  .filter(Boolean)
  .map(line => line.split('\t'))
  .filter(cols => cols.length >= 5)
  .map(([nr, sted, knr, knavn, kat]) => [nr, sted, knr, knavn, kat])
console.log(`  ${postnummer.length} postcodes`)

// ---- replace all four, in one transaction ----------------------------------
// Order matters: kommuner references fylker, so counties go first and the
// truncate cascades in the opposite direction.
console.log('replacing reference tables…')
await sql('BEGIN; TRUNCATE fylker, kommuner, naeringskoder, postnummer; COMMIT;')

await copyRows('fylker', ['fylkesnummer', 'navn', 'gyldig_fra', 'gyldig_til'],
  fylker.map(f => [f.code, f.name, f.validFrom || null, f.validTo || null]))

await copyRows('kommuner', ['kommunenummer', 'navn', 'gyldig_fra', 'gyldig_til'],
  kommuner.map(k => [k.code, k.name, k.validFrom || null, k.validTo || null]))

await copyRows('naeringskoder', ['kode', 'navn', 'niva', 'parent_kode'],
  nace.map(n => [n.code, n.name, n.level || null, n.parentCode || null]))

await copyRows('postnummer', ['postnummer', 'poststed', 'kommunenummer', 'kommunenavn', 'kategori'],
  postnummer)

const counts = await query(`
  SELECT (SELECT count(*) FROM fylker), (SELECT count(*) FROM kommuner),
         (SELECT count(*) FROM naeringskoder), (SELECT count(*) FROM postnummer);`)
const [f, k, n, p] = counts.split('|').map(Number)
console.log(`
  fylker         ${f}
  kommuner       ${k}
  naeringskoder  ${n}
  postnummer     ${p}
`)
