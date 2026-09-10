/**
 * Fetch annual accounts from Brreg.
 *
 *   node ingest/fetch-regnskap.mjs 923609016      one company
 *   node ingest/fetch-regnskap.mjs --nye          companies that filed something we lack
 *   node ingest/fetch-regnskap.mjs --alle         every company with accounts
 *   node ingest/fetch-regnskap.mjs --stale 180    anything last fetched over 180 days ago
 *   node ingest/fetch-regnskap.mjs --seed         the original demo seed set
 *
 * WHY THIS ONE IS DIFFERENT
 *
 * Regnskapsregisteret has no bulk file: it is one HTTP request per organisation
 * number. That used to make a full pass look impossible — one request at a time
 * with a one-second pause is 16.8 hours for the register — so the design was to
 * seed a few thousand companies and fetch the rest when someone viewed a page.
 *
 * Measured against the live API, the constraint was self-inflicted. Most of the
 * time per request is spent WAITING for Brreg, not working, so several requests
 * can be in the air at once:
 *
 *     concurrency  1 ->   7.4/s  ->  16.8 hours
 *     concurrency  5 ->    37/s  ->   3.4 hours
 *     concurrency 10 ->    72/s  ->   1.7 hours
 *     concurrency 20 ->   137/s  ->   0.9 hours
 *
 * The default is 8. Twenty finishes soonest and is rude to a public register
 * funded by taxpayers; eight does the whole thing in an evening and stays a
 * well-behaved guest. That is a deliberate choice to leave speed on the table.
 *
 * WHY A FULL PASS IS WORTH IT AT ALL
 *
 * Not freshness — correctness. The bulk history records the currency as NOK for
 * every row, and 9 of the first 975 companies refetched from the API were USD.
 * About one percent of the register is therefore being read as kroner when it
 * is dollars, which puts those companies at the top of every "largest" ranking
 * at roughly ten times their true size. Only the API can tell us which.
 *
 * WHY --nye BEATS A TIMER
 *
 * Annual accounts are filed once a year, so refetching on a 7-day cycle is
 * 64,000 requests a day to discover that nothing changed.
 * `enheter.siste_innsendte_aarsregnskap` already says which year a company last
 * filed, is populated for 449,606 of them, and is kept current by the daily
 * oppdateringer import. Asking it "who filed a year we do not hold" is free and
 * exact. --stale stays as a long-interval backstop, because a company restating
 * a year we already have does not change that number.
 *
 * Every attempt is logged, including failures. A 404 means "this company has
 * never filed accounts", which is the permanent truth for most of the register —
 * without recording it, those companies get re-requested forever.
 */

import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { startLogg, ferdigLogg, feiletLogg } from './logg.mjs'

const COMPOSE_FILE = process.env.COMPOSE_FILE || 'docker-compose.local.yml'
const DB_USER      = process.env.POSTGRES_USER || 'app'
const DB_NAME      = process.env.POSTGRES_DB   || 'nordata'
const BASE         = 'https://data.brreg.no/regnskapsregisteret/regnskap'

const args     = process.argv.slice(2)
const flag     = n => args.includes(n)
const valueOf  = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }

// Be a good citizen: this hits a public service hundreds of thousands of times.
// The throttle is per worker, so the request rate is roughly
// SAMTIDIGE / (THROTTLE_MS/1000) plus whatever Brreg's own latency adds.
const SAMTIDIGE   = Math.max(1, Math.min(Number(valueOf('--samtidige', 8)), 24))
const THROTTLE_MS = Number(valueOf('--throttle', 50))
const LIMIT       = Number(valueOf('--limit', 0))
const STALE_DAYS  = Number(valueOf('--stale', 0))
// Companies per database round trip. Each one spawns `docker compose exec`,
// which costs more than the HTTP request it is recording, so writing per
// company would have capped throughput far below the fetch rate.
const BOLK        = Number(valueOf('--bolk', 40))

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
// Amounts are stored rounded to the nearest thousand, matching the bulk
// historical source so that a 2024 figure and a 2025 figure are comparable and
// aggregates do not mix two precisions. The exact response is kept in `raw`.
const num   = v => v === null || v === undefined || v === '' ? 'NULL' : Math.round(Number(v) / 1000) * 1000
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Pull a nested value out safely: get(o, 'a.b.c'). */
const get = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o)

/**
 * Fetch one company and return what should be written — without writing it.
 *
 * Every database call here used to spawn `docker compose exec psql`, which
 * costs more than the HTTP request it records. Doing that per company put a
 * ceiling on throughput well below what the API can serve, so the caller now
 * collects these and writes a batch in one round trip.
 *
 * A transient failure is retried with exponential backoff and jitter: over
 * 448,600 requests a dropped connection is not exceptional, it is expected. A
 * 404 is not retried — it is the permanent truth for most of the register.
 */
async function hentEn(orgnr, forsok = 0) {
  const loggFeil = m => ({ status: 'feil', logg: `(${lit(orgnr)}, 'feil', NULL, 0, ${lit(String(m).slice(0, 200))})` })

  let res
  try {
    res = await fetch(`${BASE}/${orgnr}`, { headers: { Accept: 'application/json' } })
  } catch (err) {
    if (forsok < 4) {
      await sleep(Math.round(1000 * 2 ** forsok * (0.5 + Math.random())))
      return hentEn(orgnr, forsok + 1)
    }
    return loggFeil(err)
  }

  // 404 is the normal answer for a company that has never filed accounts —
  // most of the register. Recorded as a fact, not treated as an error.
  if (res.status === 404) {
    return { status: 'ingen_data', logg: `(${lit(orgnr)}, 'ingen_data', 404, 0, NULL)` }
  }
  if (!res.ok) {
    /**
     * 429 and 500 are not the same kind of failure here.
     *
     * 429 is about pace — waiting genuinely helps, so it gets the full four
     * attempts with backoff.
     *
     * 500 is usually about the company. Brreg returns a hard 500 for KLP and
     * DNB Bank every single time: financial institutions file under a different
     * accounting standard and their serializer cannot render it. Retrying that
     * four times spends twelve seconds to fail identically, and across a full
     * pass that is hours of waiting for answers that will never come. One retry
     * covers a genuine blip; beyond that it is recorded as a fact, and the
     * fetch log means --alle sorts it to the back on later runs.
     */
    const maksForsok = res.status === 429 ? 4 : 1
    if ((res.status === 429 || res.status >= 500) && forsok < maksForsok) {
      await sleep(Math.round(1000 * 2 ** forsok * (0.5 + Math.random())))
      return hentEn(orgnr, forsok + 1)
    }
    return { status: 'feil', http: res.status, logg: `(${lit(orgnr)}, 'feil', ${res.status}, 0, NULL)` }
  }

  let periods
  try { periods = await res.json() } catch (err) { return loggFeil(err) }
  if (!Array.isArray(periods) || periods.length === 0) {
    return { status: 'ingen_data', logg: `(${lit(orgnr)}, 'ingen_data', 200, 0, NULL)` }
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

  return {
    status: 'ok',
    periods: periods.length,
    verdier: values,
    logg: `(${lit(orgnr)}, 'ok', 200, ${periods.length}, NULL)`
  }
}

/**
 * Write one batch: every company's accounts, and every company's fetch log,
 * in a single psql session piped over stdin.
 *
 * Over stdin rather than `-c` because the batch carries the full API response
 * per period in `raw`, and a command line has a length limit that a few dozen
 * companies will exceed.
 */
async function skrivBolk(resultater) {
  if (!resultater.length) return
  const rader = resultater.map(r => r.verdier).filter(Boolean).join(',\n')
  const logger = resultater.map(r => r.logg).filter(Boolean).join(',\n')

  const deler = []
  if (rader) deler.push(`
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
    VALUES ${rader}
    ON CONFLICT (organisasjonsnummer, regnskapstype, periode_til) DO UPDATE SET
      -- kilde MUST move with the figures. The bulk history already covers the
      -- current period for most companies, so the common case here is updating
      -- a historikk row in place with exact API values and a real currency.
      -- Without this line the row keeps saying historikk -- which the schema
      -- defines as "rounded to the nearest 1000, currency NULL" -- while
      -- holding API data, and 9 of the first 975 refetched were USD. Anything
      -- trusting kilde to describe precision or currency then reads them wrong.
      kilde = 'brreg-api',
      periode_fra = EXCLUDED.periode_fra, valuta = EXCLUDED.valuta,
      sum_driftsinntekter = EXCLUDED.sum_driftsinntekter,
      sum_driftskostnad = EXCLUDED.sum_driftskostnad,
      driftsresultat = EXCLUDED.driftsresultat,
      aarsresultat = EXCLUDED.aarsresultat,
      sum_eiendeler = EXCLUDED.sum_eiendeler,
      sum_egenkapital = EXCLUDED.sum_egenkapital,
      sum_gjeld = EXCLUDED.sum_gjeld,
      raw = EXCLUDED.raw, hentet_at = now();`)

  if (logger) deler.push(`
    INSERT INTO regnskap_hentelogg
      (organisasjonsnummer, status, http_status, antall_perioder, feilmelding)
    VALUES ${logger}
    ON CONFLICT (organisasjonsnummer) DO UPDATE SET
      forsokt_at = now(), status = EXCLUDED.status, http_status = EXCLUDED.http_status,
      antall_perioder = EXCLUDED.antall_perioder, feilmelding = EXCLUDED.feilmelding;`)

  await run([], { source: Readable.from([deler.join('\n')]) })
}

// ---------------------------------------------------------------- choose work
let targets = []
let modus = ''

if (flag('--nye')) {
  // The register already knows who filed. `siste_innsendte_aarsregnskap` is
  // the year of a company's most recent filing and the daily oppdateringer
  // import keeps it current, so this asks "who filed a year we do not hold"
  // without touching the accounts API at all.
  modus = 'nye innsendinger'
  const lim = LIMIT ? `LIMIT ${LIMIT}` : ''
  targets = (await query(`
    SELECT e.organisasjonsnummer
    FROM enheter e
    WHERE e.slettet_dato IS NULL
      AND e.siste_innsendte_aarsregnskap IS NOT NULL
      AND e.siste_innsendte_aarsregnskap::int > coalesce((
        SELECT max(extract(year from r.periode_til))::int
        FROM regnskap r WHERE r.organisasjonsnummer = e.organisasjonsnummer), 0)
    ORDER BY e.antall_ansatte DESC NULLS LAST ${lim};`)).split('\n').filter(Boolean)

} else if (flag('--alle')) {
  // Every company the register says has ever filed. Ordered so that an
  // interrupted run always resumes on what has been waiting longest, and the
  // biggest companies — the ones anyone actually looks at — are corrected
  // first.
  modus = 'full oppfriskning'
  const lim = LIMIT ? `LIMIT ${LIMIT}` : ''
  targets = (await query(`
    SELECT e.organisasjonsnummer
    FROM enheter e
    LEFT JOIN regnskap_hentelogg l USING (organisasjonsnummer)
    WHERE e.slettet_dato IS NULL
      AND e.siste_innsendte_aarsregnskap IS NOT NULL
    ORDER BY l.forsokt_at ASC NULLS FIRST, e.antall_ansatte DESC NULLS LAST ${lim};`))
    .split('\n').filter(Boolean)

} else if (flag('--seed')) {
  // The original demo seed: companies large enough to make charts worth
  // drawing. Ranked by employees, not revenue — revenue is what is being
  // fetched.
  modus = 'seed'
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
  // Backstop for what the filing signal cannot see: a company restating a year
  // we already hold does not change siste_innsendte_aarsregnskap.
  modus = `eldre enn ${STALE_DAYS} dager`
  const lim = LIMIT ? `LIMIT ${LIMIT}` : ''
  targets = (await query(`
    SELECT organisasjonsnummer FROM regnskap_hentelogg
    WHERE status = 'ok' AND forsokt_at < now() - interval '${STALE_DAYS} days'
    ORDER BY forsokt_at ${lim};`)).split('\n').filter(Boolean)

} else {
  modus = 'oppgitte organisasjonsnumre'
  targets = args.filter(a => /^\d{9}$/.test(a))
}

if (targets.length === 0) {
  console.log(`ingenting å gjøre (${modus})`)
  process.exit(0)
}

const logg = await startLogg('regnskap').catch(() => null)
console.log(`${targets.length.toLocaleString('nb-NO')} foretak — ${modus}, ${SAMTIDIGE} samtidige, ${THROTTLE_MS}ms pause per arbeider`)

const started = Date.now()
const tally = { ok: 0, ingen_data: 0, feil: 0 }
let periods = 0
let neste = 0
let ferdige = 0
let buffer = []

/**
 * Flush guarded by a promise chain rather than a lock.
 *
 * Several workers finish inside the same tick, and two overlapping writes of
 * the same batch would insert it twice. Chaining them keeps the writes ordered
 * and serial while the fetching stays parallel.
 */
let skrivKo = Promise.resolve()
function koSkriv(bolk) {
  skrivKo = skrivKo.then(() => skrivBolk(bolk)).catch(err => {
    console.error(`\n  skriving feilet: ${err.message.slice(0, 160)}`)
  })
  return skrivKo
}

async function arbeider() {
  while (neste < targets.length) {
    const orgnr = targets[neste++]
    const r = await hentEn(orgnr)
    tally[r.status] = (tally[r.status] ?? 0) + 1
    periods += r.periods ?? 0
    buffer.push(r)
    ferdige++

    if (buffer.length >= BOLK) { const b = buffer; buffer = []; await koSkriv(b) }

    if (ferdige % 200 === 0 || ferdige === targets.length) {
      const sek = (Date.now() - started) / 1000
      const fart = ferdige / sek
      const igjen = Math.round((targets.length - ferdige) / fart)
      process.stdout.write(
        `\r  ${ferdige.toLocaleString('nb-NO')}/${targets.length.toLocaleString('nb-NO')}` +
        `  ok=${tally.ok} ingen=${tally.ingen_data} feil=${tally.feil}` +
        `  ${fart.toFixed(0)}/sek  ~${Math.floor(igjen / 60)}m ${igjen % 60}s igjen   `)
    }
    if (THROTTLE_MS) await sleep(THROTTLE_MS)
  }
}

try {
  await Promise.all(Array.from({ length: SAMTIDIGE }, arbeider))
  if (buffer.length) await koSkriv(buffer)
  await skrivKo
  console.log()

  const sek = (Date.now() - started) / 1000
  console.log(`
  forsøkt          ${targets.length.toLocaleString('nb-NO')}
    med regnskap   ${tally.ok.toLocaleString('nb-NO')}  (${periods.toLocaleString('nb-NO')} perioder)
    ingen innsendt ${tally.ingen_data.toLocaleString('nb-NO')}
    feil           ${tally.feil.toLocaleString('nb-NO')}
  brukt            ${(sek / 60).toFixed(1)} min
`)
  if (logg) await ferdigLogg(logg, { lest: targets.length, endret: tally.ok, uendret: tally.ingen_data }).catch(() => {})
  process.exit(tally.feil > targets.length / 10 ? 1 : 0)
} catch (err) {
  console.error(`\nstoppet: ${err.message}`)
  if (logg) await feiletLogg(logg, err.message).catch(() => {})
  process.exit(1)
}
