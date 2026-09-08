/**
 * Import historical annual accounts from a MariaDB dump of `org_regnskap`.
 *
 *   node ingest/import-regnskap-historikk.mjs ~/Downloads/org_regnskap.sql
 *
 * WHY THIS EXISTS
 *
 * Brreg's API serves only the most recent accounting period. There is no year
 * parameter — `?år=`, `?aar=` and `?regnskapstype=` were all tried and all
 * return the same current period. So revenue trends cannot be built from the
 * API, and history has to come from an earlier bulk collection.
 *
 * WHY IT IS TRUSTED
 *
 * The figures were verified against the live API before any of this was
 * written. Fourteen fields across the resultatregnskap and balanse matched
 * exactly once multiplied by 1000, for four companies including one reporting
 * in USD. The dump stores tusen kroner, the standard Norwegian presentation.
 *
 * Only the columns Brreg itself publishes are imported. The source has 125
 * columns; the extra ones are not in Brreg's API and are left alone.
 *
 * Two honest limitations, recorded on every row via `kilde = 'historikk'`:
 *   - figures are rounded to the nearest thousand
 *   - currency is not recorded, so `valuta` is NULL rather than assumed NOK
 */

import { createReadStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { createInterface } from 'node:readline'
import { homedir } from 'node:os'

const FILE = (process.argv[2] || `${homedir()}/Downloads/org_regnskap.sql`).replace(/^~/, homedir())
const COMPOSE_FILE = process.env.COMPOSE_FILE || 'docker-compose.local.yml'
const DB_USER = process.env.POSTGRES_USER || 'app'
const DB_NAME = process.env.POSTGRES_DB   || 'nordata'

const t0 = Date.now()
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`

// Column positions in the dump, verified field by field against Brreg's API.
const C = {
  orgnr: 0, aar: 1, mnd: 2,
  totale_inntekter: 3, driftsresultat: 10, finansinntekt: 11, finanskostnad: 14,
  ordinart_resultat_for_skatt: 16, arsresultat: 23,
  annleggsmidler: 28, ei_omlopsmidler: 35,
  gj_egenkapital: 43, gj_inskutt_egenkapital: 44, gj_gjeld: 45,
  langsiktig_gjeld: 46, gj_kortsiktig_gjeld: 50
}

function run(extra, { source = null } = {}) {
  const a = ['compose', '-f', COMPOSE_FILE, 'exec', '-T', 'db',
             'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-U', DB_USER, '-d', DB_NAME, ...extra]
  return new Promise((resolve, reject) => {
    const p = spawn('docker', a, { stdio: [source ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('close', c => c === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `psql exited ${c}`)))
    if (source) { source.on('error', reject); source.pipe(p.stdin) }
  })
}
const sql   = s => run(['-c', s])
const query = s => run(['-t', '-A', '-F', '|', '-c', s])

/**
 * Split one extended INSERT's VALUES list into tuples.
 * Values are numbers and short single-quoted strings, so the only states that
 * matter are "inside a string" and "escaped".
 */
function* tuples(line) {
  let depth = 0, inStr = false, esc = false, start = -1
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { if (inStr) esc = true; continue }
    if (c === "'") { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '(') { if (depth === 0) start = i; depth++ }
    else if (c === ')') { depth--; if (depth === 0 && start !== -1) { yield line.slice(start + 1, i); start = -1 } }
  }
}
const fields = t => t.split(',').map(v => v.trim().replace(/^'|'$/g, ''))
const k1000  = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) * 1000 : '' }

console.log('creating staging table…')
await sql(`DROP TABLE IF EXISTS staging_regnskap_hist;
           CREATE UNLOGGED TABLE staging_regnskap_hist (
             orgnr text, aar text, mnd text,
             sum_driftsinntekter text, driftsresultat text,
             sum_finansinntekter text, sum_finanskostnad text,
             ordinaert_resultat_for_skatt text, aarsresultat text,
             sum_anleggsmidler text, sum_omloepsmidler text,
             sum_egenkapital text, sum_innskutt_egenkapital text,
             sum_gjeld text, sum_langsiktig_gjeld text, sum_kortsiktig_gjeld text);`)

console.log(`parsing ${FILE} and streaming into staging…`)
let rows = 0
async function* csv() {
  const rl = createInterface({ input: createReadStream(FILE, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.startsWith('INSERT INTO')) continue
    for (const t of tuples(line)) {
      const f = fields(t)
      if (f.length < 51 || !/^\d{9}$/.test(f[C.orgnr]) || !/^\d{4}$/.test(f[C.aar])) continue
      yield [
        f[C.orgnr], f[C.aar], f[C.mnd],
        k1000(f[C.totale_inntekter]), k1000(f[C.driftsresultat]),
        k1000(f[C.finansinntekt]), k1000(f[C.finanskostnad]),
        k1000(f[C.ordinart_resultat_for_skatt]), k1000(f[C.arsresultat]),
        k1000(f[C.annleggsmidler]), k1000(f[C.ei_omlopsmidler]),
        k1000(f[C.gj_egenkapital]), k1000(f[C.gj_inskutt_egenkapital]),
        k1000(f[C.gj_gjeld]), k1000(f[C.langsiktig_gjeld]), k1000(f[C.gj_kortsiktig_gjeld])
      ].join(',') + '\n'
      if (++rows % 1000000 === 0) console.log(`  ${rows.toLocaleString()} rows parsed… (${since()})`)
    }
  }
}
await run(['-c', `\\copy staging_regnskap_hist FROM STDIN WITH (FORMAT csv)`], { source: Readable.from(csv()) })
const staged = Number(await query('SELECT count(*) FROM staging_regnskap_hist;'))
console.log(`  ${staged.toLocaleString()} rows staged (${since()})`)

console.log('promoting…')
// Only companies that exist in enheter, because of the foreign key. Existing
// brreg-api rows win: they are exact, these are rounded, so ON CONFLICT keeps
// whatever is already there for that period.
await sql(`
INSERT INTO regnskap (
    organisasjonsnummer, regnskapstype, periode_til, periode_fra, valuta, kilde,
    sum_driftsinntekter, sum_driftskostnad, driftsresultat,
    sum_finansinntekter, sum_finanskostnad,
    ordinaert_resultat_for_skatt, aarsresultat,
    sum_eiendeler, sum_anleggsmidler, sum_omloepsmidler,
    sum_egenkapital, sum_innskutt_egenkapital,
    sum_gjeld, sum_kortsiktig_gjeld, sum_langsiktig_gjeld, hentet_at)
SELECT
    s.orgnr, 'SELSKAP',
    -- 0.56% of rows have a non-December fiscal year end (June and September are
    -- the common ones). Forcing 31 December on those stores the wrong period,
    -- and can collide in the primary key when a company later switches to a
    -- calendar year. The month column exists; use it. '0' means unspecified,
    -- which is treated as December.
    (date_trunc('month', make_date(s.aar::int, coalesce(nullif(s.mnd,'0')::int, 12), 1))
       + interval '1 month - 1 day')::date,
    (make_date(s.aar::int, coalesce(nullif(s.mnd,'0')::int, 12), 1) - interval '11 months')::date,
    NULL, 'historikk',
    nullif(s.sum_driftsinntekter,'')::numeric,
    -- driftskostnad is not a column in the source, but it is exactly
    -- driftsinntekter minus driftsresultat. Verified against the API.
    nullif(s.sum_driftsinntekter,'')::numeric - nullif(s.driftsresultat,'')::numeric,
    nullif(s.driftsresultat,'')::numeric,
    nullif(s.sum_finansinntekter,'')::numeric,
    nullif(s.sum_finanskostnad,'')::numeric,
    nullif(s.ordinaert_resultat_for_skatt,'')::numeric,
    nullif(s.aarsresultat,'')::numeric,
    -- total assets = anleggsmidler + omløpsmidler
    nullif(s.sum_anleggsmidler,'')::numeric + nullif(s.sum_omloepsmidler,'')::numeric,
    nullif(s.sum_anleggsmidler,'')::numeric,
    nullif(s.sum_omloepsmidler,'')::numeric,
    nullif(s.sum_egenkapital,'')::numeric,
    nullif(s.sum_innskutt_egenkapital,'')::numeric,
    nullif(s.sum_gjeld,'')::numeric,
    nullif(s.sum_kortsiktig_gjeld,'')::numeric,
    nullif(s.sum_langsiktig_gjeld,'')::numeric,
    now()
FROM staging_regnskap_hist s
WHERE EXISTS (SELECT 1 FROM enheter e WHERE e.organisasjonsnummer = s.orgnr)
ON CONFLICT (organisasjonsnummer, regnskapstype, periode_til) DO NOTHING;`)

const [total, hist, api, companies, minA, maxA] = (await query(`
  SELECT count(*), count(*) FILTER (WHERE kilde='historikk'), count(*) FILTER (WHERE kilde='brreg-api'),
         count(DISTINCT organisasjonsnummer),
         min(extract(year from periode_til)), max(extract(year from periode_til))
  FROM regnskap;`)).split('|').map(Number)

await sql('DROP TABLE IF EXISTS staging_regnskap_hist;')

console.log(`
  parsed from dump   ${staged.toLocaleString()}
  regnskap total     ${total.toLocaleString()}   across ${companies.toLocaleString()} companies
    historikk        ${hist.toLocaleString()}   (rounded to nearest 1000, no currency)
    brreg-api        ${api.toLocaleString()}   (exact)
  years covered      ${minA}..${maxA}
  done in ${since()}
`)
