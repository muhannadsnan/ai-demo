/**
 * Fetch annual accounts from Brreg, one company at a time.
 *
 *   node ingest/fetch-regnskap.mjs 923609016            one company
 *   node ingest/fetch-regnskap.mjs --seed               the agreed seed set
 *   node ingest/fetch-regnskap.mjs --seed --limit 100   a smaller bite
 *   node ingest/fetch-regnskap.mjs --stale 90           refresh rows older than 90 days
 *
 * WHY THIS ONE IS DIFFERENT
 *
 * Regnskapsregisteret has no bulk file. It is one HTTP request per organisation
 * number, so mirroring all 1.17M companies would take days of continuous
 * requests against someone else's server. Instead:
 *
 *   - seed the companies that make a demo look alive (50+ employees with recent
 *     accounts: 6,456 of them, about 1.8 hours at a 1s throttle), and
 *   - fetch the rest on demand, when a company's page is actually viewed.
 *
 * Every attempt is logged, including failures. A 404 means "this company has
 * never filed accounts", which is the permanent truth for most of the register —
 * without recording it, those companies get re-requested on every page view
 * forever.
 */

import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'

const COMPOSE_FILE = process.env.COMPOSE_FILE || 'docker-compose.local.yml'
const DB_USER      = process.env.POSTGRES_USER || 'app'
const DB_NAME      = process.env.POSTGRES_DB   || 'nordata'
const BASE         = 'https://data.brreg.no/regnskapsregisteret/regnskap'

const args     = process.argv.slice(2)
const flag     = n => args.includes(n)
const valueOf  = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }

// Be a good citizen: this hits a public service thousands of times.
const THROTTLE_MS = Number(valueOf('--throttle', 1000))
const LIMIT       = Number(valueOf('--limit', 0))
const STALE_DAYS  = Number(valueOf('--stale', 0))

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
const lit   = v => v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`
const num   = v => v === null || v === undefined || v === '' ? 'NULL' : Number(v)
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Pull a nested value out safely: get(o, 'a.b.c'). */
const get = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o)

async function fetchOne(orgnr) {
  let res
  try {
    res = await fetch(`${BASE}/${orgnr}`, { headers: { Accept: 'application/json' } })
  } catch (err) {
    await sql(`INSERT INTO regnskap_hentelogg (organisasjonsnummer, status, feilmelding)
               VALUES (${lit(orgnr)}, 'feil', ${lit(String(err).slice(0, 200))})
               ON CONFLICT (organisasjonsnummer) DO UPDATE SET
                 forsokt_at = now(), status = 'feil', feilmelding = EXCLUDED.feilmelding;`)
    return { status: 'feil' }
  }

  // 404 is the normal answer for a company that has never filed accounts —
  // most of the register. Recorded as a fact, not treated as an error.
  if (res.status === 404) {
    await sql(`INSERT INTO regnskap_hentelogg (organisasjonsnummer, status, http_status)
               VALUES (${lit(orgnr)}, 'ingen_data', 404)
               ON CONFLICT (organisasjonsnummer) DO UPDATE SET
                 forsokt_at = now(), status = 'ingen_data', http_status = 404, antall_perioder = 0;`)
    return { status: 'ingen_data' }
  }
  if (!res.ok) {
    await sql(`INSERT INTO regnskap_hentelogg (organisasjonsnummer, status, http_status)
               VALUES (${lit(orgnr)}, 'feil', ${res.status})
               ON CONFLICT (organisasjonsnummer) DO UPDATE SET
                 forsokt_at = now(), status = 'feil', http_status = ${res.status};`)
    return { status: 'feil', http: res.status }
  }

  const periods = await res.json()
  if (!Array.isArray(periods) || periods.length === 0) {
    await sql(`INSERT INTO regnskap_hentelogg (organisasjonsnummer, status, http_status)
               VALUES (${lit(orgnr)}, 'ingen_data', 200)
               ON CONFLICT (organisasjonsnummer) DO UPDATE SET
                 forsokt_at = now(), status = 'ingen_data', http_status = 200, antall_perioder = 0;`)
    return { status: 'ingen_data' }
  }

  // A company can file several periods, and a parent files both SELSKAP and
  // KONSERN. All of them are stored; the primary key keeps them distinct.
  const values = periods.map(r => `(
    ${lit(orgnr)},
    ${lit(r.regnskapstype)},
    ${lit(get(r, 'regnskapsperiode.tilDato'))}::date,
    ${lit(get(r, 'regnskapsperiode.fraDato'))}::date,
    ${lit(r.valuta)},
    ${lit(r.oppstillingsplan)},
    ${get(r, 'virksomhet.morselskap') === undefined ? 'NULL' : Boolean(get(r, 'virksomhet.morselskap'))},
    ${r.avviklingsregnskap === undefined ? 'NULL' : Boolean(r.avviklingsregnskap)},
    ${get(r, 'revisjon.ikkeRevidertAarsregnskap') === undefined ? 'NULL' : Boolean(get(r, 'revisjon.ikkeRevidertAarsregnskap'))},
    ${get(r, 'revisjon.fravalgRevisjon') === undefined ? 'NULL' : Boolean(get(r, 'revisjon.fravalgRevisjon'))},
    ${get(r, 'regnkapsprinsipper.smaaForetak') === undefined ? 'NULL' : Boolean(get(r, 'regnkapsprinsipper.smaaForetak'))},
    ${lit(get(r, 'regnkapsprinsipper.regnskapsregler'))},
    ${num(get(r, 'resultatregnskapResultat.driftsresultat.driftsinntekter.sumDriftsinntekter'))},
    ${num(get(r, 'resultatregnskapResultat.driftsresultat.driftskostnad.sumDriftskostnad'))},
    ${num(get(r, 'resultatregnskapResultat.driftsresultat.driftsresultat'))},
    ${num(get(r, 'resultatregnskapResultat.finansresultat.finansinntekt.sumFinansinntekter'))},
    ${num(get(r, 'resultatregnskapResultat.finansresultat.finanskostnad.sumFinanskostnad'))},
    ${num(get(r, 'resultatregnskapResultat.finansresultat.nettoFinans'))},
    ${num(get(r, 'resultatregnskapResultat.ordinaertResultatFoerSkattekostnad'))},
    ${num(get(r, 'resultatregnskapResultat.aarsresultat'))},
    ${num(get(r, 'eiendeler.sumEiendeler'))},
    ${num(get(r, 'eiendeler.anleggsmidler.sumAnleggsmidler'))},
    ${num(get(r, 'eiendeler.omloepsmidler.sumOmloepsmidler'))},
    ${num(get(r, 'egenkapitalGjeld.egenkapital.sumEgenkapital'))},
    ${num(get(r, 'egenkapitalGjeld.egenkapital.innskuttEgenkapital.sumInnskuttEgenkaptial'))},
    ${num(get(r, 'egenkapitalGjeld.egenkapital.opptjentEgenkapital.sumOpptjentEgenkapital'))},
    ${num(get(r, 'egenkapitalGjeld.gjeldOversikt.sumGjeld'))},
    ${num(get(r, 'egenkapitalGjeld.gjeldOversikt.kortsiktigGjeld.sumKortsiktigGjeld'))},
    ${num(get(r, 'egenkapitalGjeld.gjeldOversikt.langsiktigGjeld.sumLangsiktigGjeld'))},
    ${num(r.id)}, ${num(r.journalnr)},
    ${lit(JSON.stringify(r))}::jsonb, now())`).join(',\n')

  await sql(`
    INSERT INTO regnskap (
      organisasjonsnummer, regnskapstype, periode_til, periode_fra, valuta,
      oppstillingsplan, morselskap, avviklingsregnskap, ikke_revidert, fravalg_revisjon,
      smaa_foretak, regnskapsregler,
      sum_driftsinntekter, sum_driftskostnad, driftsresultat,
      sum_finansinntekter, sum_finanskostnad, netto_finans,
      ordinaert_resultat_for_skatt, aarsresultat,
      sum_eiendeler, sum_anleggsmidler, sum_omloepsmidler,
      sum_egenkapital, sum_innskutt_egenkapital, sum_opptjent_egenkapital,
      sum_gjeld, sum_kortsiktig_gjeld, sum_langsiktig_gjeld,
      brreg_id, journalnr, raw, hentet_at)
    VALUES ${values}
    ON CONFLICT (organisasjonsnummer, regnskapstype, periode_til) DO UPDATE SET
      periode_fra = EXCLUDED.periode_fra, valuta = EXCLUDED.valuta,
      sum_driftsinntekter = EXCLUDED.sum_driftsinntekter,
      sum_driftskostnad = EXCLUDED.sum_driftskostnad,
      driftsresultat = EXCLUDED.driftsresultat,
      aarsresultat = EXCLUDED.aarsresultat,
      sum_eiendeler = EXCLUDED.sum_eiendeler,
      sum_egenkapital = EXCLUDED.sum_egenkapital,
      sum_gjeld = EXCLUDED.sum_gjeld,
      raw = EXCLUDED.raw, hentet_at = now();

    INSERT INTO regnskap_hentelogg (organisasjonsnummer, status, http_status, antall_perioder)
    VALUES (${lit(orgnr)}, 'ok', 200, ${periods.length})
    ON CONFLICT (organisasjonsnummer) DO UPDATE SET
      forsokt_at = now(), status = 'ok', http_status = 200,
      antall_perioder = EXCLUDED.antall_perioder, feilmelding = NULL;`)

  return { status: 'ok', periods: periods.length }
}

// ---------------------------------------------------------------- choose work
let targets = []
if (flag('--seed')) {
  // The agreed seed: companies large enough to make charts worth drawing.
  // Ranked by employees, not revenue — revenue is the thing being fetched.
  const lim = LIMIT ? `LIMIT ${LIMIT}` : 'LIMIT 6456'
  targets = (await query(`
    SELECT e.organisasjonsnummer FROM enheter e
    LEFT JOIN regnskap_hentelogg l USING (organisasjonsnummer)
    WHERE e.slettet_dato IS NULL
      AND e.siste_innsendte_aarsregnskap >= 2024
      AND e.antall_ansatte >= 50
      AND l.organisasjonsnummer IS NULL      -- never attempted
    ORDER BY e.antall_ansatte DESC ${lim};`)).split('\n').filter(Boolean)
} else if (STALE_DAYS) {
  const lim = LIMIT ? `LIMIT ${LIMIT}` : ''
  targets = (await query(`
    SELECT organisasjonsnummer FROM regnskap_hentelogg
    WHERE status = 'ok' AND forsokt_at < now() - interval '${STALE_DAYS} days'
    ORDER BY forsokt_at ${lim};`)).split('\n').filter(Boolean)
} else {
  targets = args.filter(a => /^\d{9}$/.test(a))
}

if (targets.length === 0) {
  console.error('nothing to do — pass an orgnr, --seed, or --stale <days>')
  process.exit(1)
}

console.log(`${targets.length.toLocaleString()} companies, ${THROTTLE_MS}ms between requests`)
const started = Date.now()
const tally = { ok: 0, ingen_data: 0, feil: 0 }
let periods = 0

for (const [i, orgnr] of targets.entries()) {
  const r = await fetchOne(orgnr)
  tally[r.status] = (tally[r.status] ?? 0) + 1
  periods += r.periods ?? 0
  if ((i + 1) % 100 === 0 || i + 1 === targets.length) {
    const secs = (Date.now() - started) / 1000
    const eta  = ((targets.length - i - 1) * secs / (i + 1) / 60).toFixed(1)
    console.log(`  ${i + 1}/${targets.length}  ok=${tally.ok} ingen=${tally.ingen_data} feil=${tally.feil}  ${secs.toFixed(0)}s elapsed, ~${eta}min left`)
  }
  if (i + 1 < targets.length) await sleep(THROTTLE_MS)
}

console.log(`
  attempted        ${targets.length.toLocaleString()}
    with accounts  ${tally.ok.toLocaleString()}  (${periods.toLocaleString()} periods)
    none filed     ${tally.ingen_data.toLocaleString()}
    errors         ${tally.feil.toLocaleString()}
  elapsed          ${((Date.now() - started) / 1000).toFixed(0)}s
`)
