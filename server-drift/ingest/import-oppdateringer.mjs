/**
 * Incremental company import, driven by Brreg's change feed.
 *
 *   node ingest/import-oppdateringer.mjs              # process what is new
 *   node ingest/import-oppdateringer.mjs --maks 500   # cap the work in one run
 *   node ingest/import-oppdateringer.mjs --start-naa  # seed the cursor to "now"
 *
 * WHY THIS EXISTS
 *
 * The full-file import downloads 154 MB and stages 1.17M rows to change a few
 * hundred. That is fine weekly and wasteful nightly. This asks Brreg what
 * actually changed and fetches only those companies.
 *
 * HOW THE CURSOR MAKES GAPS SAFE
 *
 * Every event in the feed carries an increasing `oppdateringsid`. We store the
 * last one handled and ask for everything after it. Miss a week and the next
 * run returns a week's worth — the gap costs time, never data. A "what changed
 * yesterday" query would lose those days permanently.
 *
 * Deletions come through the same feed as `Sletting` / `Fjernet`, and are
 * marked rather than deleted, for the same reason as in the full import:
 * `roller` cascades, so removing a company silently destroys its role history.
 */

import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { startLogg, ferdigLogg, feiletLogg } from './logg.mjs'

const COMPOSE_FILE = process.env.COMPOSE_FILE || 'docker-compose.local.yml'
const DB_USER = process.env.POSTGRES_USER || 'app'
const DB_NAME = process.env.POSTGRES_DB   || 'nordata'
const FEED    = 'https://data.brreg.no/enhetsregisteret/api/oppdateringer/enheter'
const ENHET   = 'https://data.brreg.no/enhetsregisteret/api/enheter'

const args    = process.argv.slice(2)
const valueOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
// --maks 0 means no cap. The cap exists to keep a nightly run short; when
// catching up after the machine has been off for months it is exactly the wrong
// limit, and `run-import.sh alt` passes 0 to remove it.
const MAKS_ARG  = Number(valueOf('--maks', 5000))
const MAKS      = MAKS_ARG > 0 ? MAKS_ARG : Infinity
/**
 * Requests in flight at once, and the pause between batches. The rate works out
 * near 50/sec with the defaults, against 6/sec when this fetched one at a time.
 * The throttle is now per BATCH rather than per request, which is why it is
 * smaller than it looks.
 */
const SAMTIDIGE = Math.max(1, Math.min(Number(valueOf('--samtidige', 8)), 24))
const THROTTLE  = Number(valueOf('--throttle', 50))
/**
 * --fra-dato YYYY-MM-DD resets the cursor to the first event of that day. Use
 * the publication date of the full file that established the current state.
 */
const FRA_DATO  = valueOf('--fra-dato', null)
const SIDE      = 10000

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
const sleep = ms => new Promise(r => setTimeout(r, ms))

const logg = await startLogg('oppdateringer')
process.on('uncaughtException', async e => { await feiletLogg(logg, e); process.exit(1) })

// ---- where did we get to? ---------------------------------------------------
let cursor = Number(await query(`SELECT siste_id FROM import_cursor WHERE kilde='enheter';`) || 0)

if (!cursor || args.includes('--start-naa') || FRA_DATO) {
  /**
   * Seed the cursor from a DATE, not from a count.
   *
   * The previous version fell back to `page.totalElements` when the feed
   * returned nothing past the end — and totalElements is how many events exist,
   * not the id of the newest one. The two are not the same number and never
   * were: the count sat around 16.4 million while ids had already reached 25.2
   * million, because ids have gaps.
   *
   * It failed silently, which is why it survived. 16,407,682 is a perfectly
   * plausible-looking oppdateringsid, so the job started up, read real events,
   * updated real companies and reported success — while quietly replaying the
   * change feed from January 2023 with 7.8 million events still ahead of it.
   *
   * Asking the feed for the first event on a given date gives an id that means
   * what it says. The date to use is the day the full file was published: the
   * file establishes the state, and the cursor picks up every change since.
   */
  const dato = FRA_DATO || new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10)
  const svar = await fetch(`${FEED}?dato=${dato}T00:00:00.000Z&size=1`).then(r => r.json())
  const forste = Number(svar?._embedded?.oppdaterteEnheter?.[0]?.oppdateringsid ?? 0)
  if (!forste) {
    console.error(`fant ingen hendelser fra ${dato} — markøren er ikke satt`)
    await feiletLogg(logg, `ingen hendelser fra ${dato}`)
    process.exit(1)
  }
  // Minus one, because the loop reads everything AFTER the cursor and the first
  // event of that day is a change we want.
  cursor = forste - 1
  await sql(`INSERT INTO import_cursor (kilde, siste_id) VALUES ('enheter', ${cursor})
             ON CONFLICT (kilde) DO UPDATE SET siste_id = ${cursor}, oppdatert_at = now();`)
  console.log(`markør satt til ${cursor.toLocaleString('nb-NO')} (første hendelse ${dato}) — ingen historikk spilles av`)
  await ferdigLogg(logg, { lest: 0, nye: 0, endret: 0, uendret: 0, slettet: 0 })
  process.exit(0)
}

console.log(`leser endringer etter oppdateringsid ${cursor.toLocaleString('nb-NO')}`)

// ---- collect what changed ---------------------------------------------------
const endret = new Map()   // orgnr -> siste endringstype
let hoyesteId = cursor, hendelser = 0

// The cursor must only advance past events we have actually accounted for.
// Stopping mid-page and moving the cursor to the end of that page would skip
// everything in between — so `hoyesteId` is set per event, not per page, and
// the loop breaks the moment MAKS distinct companies have been collected.
// Whatever is left is simply the start of the next run.
let ferdig = false
while (!ferdig) {
  const side = await fetch(`${FEED}?oppdateringsid=${hoyesteId + 1}&size=${SIDE}`).then(r => r.json())
  const rader = side?._embedded?.oppdaterteEnheter ?? []
  if (!rader.length) break

  for (const r of rader) {
    // A company already in the batch is free to include again; a new one is not,
    // once the cap is reached.
    if (endret.size >= MAKS && !endret.has(r.organisasjonsnummer)) { ferdig = true; break }
    endret.set(r.organisasjonsnummer, r.endringstype)
    hoyesteId = Number(r.oppdateringsid)
    hendelser++
  }
  if (!ferdig && rader.length < SIDE) break
}
console.log(`  ${hendelser.toLocaleString('nb-NO')} hendelser, ${endret.size.toLocaleString('nb-NO')} unike foretak`)

if (!endret.size) {
  console.log('  ingenting nytt')
  await ferdigLogg(logg, { lest: 0, nye: 0, endret: 0, uendret: 0, slettet: 0 })
  process.exit(0)
}

// ---- deletions come through the same feed -----------------------------------
const slettede = [...endret].filter(([, t]) => t === 'Sletting' || t === 'Fjernet').map(([o]) => o)
let slettet = 0
if (slettede.length) {
  const liste = slettede.map(o => `'${o}'`).join(',')
  slettet = Number(await query(`
    WITH m AS (UPDATE enheter SET slettet_dato = current_date, updated_at = now()
               WHERE organisasjonsnummer IN (${liste}) AND slettet_dato IS NULL RETURNING 1)
    SELECT count(*) FROM m;`))
}

// ---- fetch the changed companies and upsert ---------------------------------
const aaHente = [...endret].filter(([, t]) => t !== 'Sletting' && t !== 'Fjernet').map(([o]) => o)
await sql(`DROP TABLE IF EXISTS staging_oppdatering;
           CREATE UNLOGGED TABLE staging_oppdatering (doc jsonb);`)

let hentet = 0, feil = 0
const forsvunnet = []

/** One company. Returns the CSV line for COPY, or null if there is nothing to write. */
async function hentEn(orgnr) {
  try {
    const res = await fetch(`${ENHET}/${orgnr}`, { headers: { Accept: 'application/json' } })
    if (res.ok) {
      const doc = await res.text()
      hentet++
      return '"' + doc.replace(/"/g, '""') + '"\n'
    }
    if (res.status === 404 || res.status === 410) {
      // Gone from the register but not announced as a deletion. Collected and
      // retired in one statement at the end rather than one round trip each.
      forsvunnet.push(orgnr)
      return null
    }
    feil++
    return null
  } catch {
    feil++
    return null
  }
}

/**
 * Feed the COPY stream, fetching SAMTIDIGE companies at a time.
 *
 * This was one request at a time, and a three-day gap took 42 minutes for
 * 15,719 companies — during which the job used 47 seconds of CPU. Almost all of
 * that wall clock was spent waiting for Brreg to answer, which is the same thing
 * fetch-regnskap was doing before it got a worker pool.
 *
 * A batch barrier rather than a true pool: each round waits for its slowest
 * member before starting the next. Slightly less efficient in theory, and the
 * difference does not show here because the requests are uniform — while the
 * code stays a generator feeding a stream, which is what keeps the whole
 * response set from being held in memory at once.
 */
async function* linjer() {
  for (let i = 0; i < aaHente.length; i += SAMTIDIGE) {
    const bolk = aaHente.slice(i, i + SAMTIDIGE)
    const svar = await Promise.all(bolk.map(hentEn))
    for (const linje of svar) if (linje) yield linje

    const gjort = Math.min(i + SAMTIDIGE, aaHente.length)
    if (gjort % 500 < SAMTIDIGE || gjort === aaHente.length) {
      console.log(`  hentet ${hentet}/${aaHente.length}…`)
    }
    if (THROTTLE) await sleep(THROTTLE)
  }
}
await run(['-c', `\\copy staging_oppdatering (doc) FROM STDIN WITH (FORMAT csv, QUOTE '"')`],
          { source: Readable.from(linjer()) })

// Companies the API no longer serves. One statement instead of one round trip
// each: `docker compose exec psql` costs more than the request that found them.
if (forsvunnet.length) {
  const liste = forsvunnet.map(o => `'${o}'`).join(',')
  const n = Number(await query(`
    WITH m AS (UPDATE enheter SET slettet_dato = current_date, updated_at = now()
               WHERE organisasjonsnummer IN (${liste}) AND slettet_dato IS NULL RETURNING 1)
    SELECT count(*) FROM m;`))
  slettet += n
}

// The JSON field names mostly match the CSV headers, but not entirely:
// `registrertIMvaregisteret` has a lowercase r, and `adresse` is an ARRAY of
// lines rather than a string. Both are handled explicitly below.
const resultat = await query(`
  WITH oppdatert AS (
    INSERT INTO enheter (
      organisasjonsnummer, navn, organisasjonsform_kode, organisasjonsform_beskrivelse,
      naeringskode1_kode, naeringskode1_beskrivelse,
      har_registrert_antall_ansatte, antall_ansatte,
      forretningsadresse_adresse, forretningsadresse_postnummer, forretningsadresse_poststed,
      forretningsadresse_kommune, forretningsadresse_kommunenummer, forretningsadresse_landkode,
      hjemmeside, epostadresse, telefon, mobil,
      registreringsdato_enhetsregisteret, stiftelsesdato,
      registrert_i_mva_registeret, registrert_i_foretaksregisteret,
      konkurs, under_avvikling, under_tvangsavvikling,
      overordnet_enhet, er_i_konsern, aktivitet, vedtektsfestet_formaal,
      content_hash, slettet_dato, updated_at)
    SELECT
      d->>'organisasjonsnummer', d->>'navn',
      d->'organisasjonsform'->>'kode', d->'organisasjonsform'->>'beskrivelse',
      nullif(d->'naeringskode1'->>'kode','00.000'), d->'naeringskode1'->>'beskrivelse',
      coalesce((d->>'harRegistrertAntallAnsatte')::boolean, false),
      nullif(d->>'antallAnsatte','')::int,
      (SELECT string_agg(value,', ') FROM jsonb_array_elements_text(d->'forretningsadresse'->'adresse')),
      d->'forretningsadresse'->>'postnummer', d->'forretningsadresse'->>'poststed',
      d->'forretningsadresse'->>'kommune', d->'forretningsadresse'->>'kommunenummer',
      d->'forretningsadresse'->>'landkode',
      d->>'hjemmeside', d->>'epostadresse', d->>'telefon', d->>'mobil',
      nullif(d->>'registreringsdatoEnhetsregisteret','')::date,
      nullif(d->>'stiftelsesdato','')::date,
      coalesce((d->>'registrertIMvaregisteret')::boolean, false),
      coalesce((d->>'registrertIForetaksregisteret')::boolean, false),
      coalesce((d->>'konkurs')::boolean, false),
      coalesce((d->>'underAvvikling')::boolean, false),
      coalesce((d->>'underTvangsavviklingEllerTvangsopplosning')::boolean, false),
      d->'overordnetEnhet'->>'organisasjonsnummer',
      coalesce((d->>'erIKonsern')::boolean, false),
      d->>'aktivitet', d->>'vedtektsfestetFormaal',
      -- Null the hash so the next full-file import rewrites this row rather
      -- than skipping it as unchanged: this data came from a different source.
      NULL, NULL, now()
    FROM (SELECT doc AS d FROM staging_oppdatering) s
    ON CONFLICT (organisasjonsnummer) DO UPDATE SET
      navn = EXCLUDED.navn,
      organisasjonsform_kode = EXCLUDED.organisasjonsform_kode,
      organisasjonsform_beskrivelse = EXCLUDED.organisasjonsform_beskrivelse,
      naeringskode1_kode = EXCLUDED.naeringskode1_kode,
      naeringskode1_beskrivelse = EXCLUDED.naeringskode1_beskrivelse,
      har_registrert_antall_ansatte = EXCLUDED.har_registrert_antall_ansatte,
      antall_ansatte = EXCLUDED.antall_ansatte,
      forretningsadresse_adresse = EXCLUDED.forretningsadresse_adresse,
      forretningsadresse_postnummer = EXCLUDED.forretningsadresse_postnummer,
      forretningsadresse_poststed = EXCLUDED.forretningsadresse_poststed,
      forretningsadresse_kommune = EXCLUDED.forretningsadresse_kommune,
      forretningsadresse_kommunenummer = EXCLUDED.forretningsadresse_kommunenummer,
      hjemmeside = EXCLUDED.hjemmeside, epostadresse = EXCLUDED.epostadresse,
      telefon = EXCLUDED.telefon, mobil = EXCLUDED.mobil,
      konkurs = EXCLUDED.konkurs, under_avvikling = EXCLUDED.under_avvikling,
      under_tvangsavvikling = EXCLUDED.under_tvangsavvikling,
      overordnet_enhet = EXCLUDED.overordnet_enhet, er_i_konsern = EXCLUDED.er_i_konsern,
      aktivitet = EXCLUDED.aktivitet, vedtektsfestet_formaal = EXCLUDED.vedtektsfestet_formaal,
      content_hash = NULL, slettet_dato = NULL, savnet_siden = NULL, updated_at = now()
    RETURNING xmax = 0 AS ny)
  SELECT count(*) FILTER (WHERE ny), count(*) FILTER (WHERE NOT ny) FROM oppdatert;`)

const [nye, oppdaterte] = resultat.split('|').map(Number)

await sql(`INSERT INTO import_cursor (kilde, siste_id, siste_dato) VALUES ('enheter', ${hoyesteId}, now())
           ON CONFLICT (kilde) DO UPDATE SET siste_id = ${hoyesteId}, siste_dato = now(), oppdatert_at = now();
           DROP TABLE IF EXISTS staging_oppdatering;`)

await ferdigLogg(logg, { lest: hendelser, nye, endret: oppdaterte, uendret: 0, slettet })

console.log(`
  hendelser lest   ${hendelser.toLocaleString('nb-NO')}
  foretak endret   ${endret.size.toLocaleString('nb-NO')}
    hentet         ${hentet.toLocaleString('nb-NO')}
    nye            ${nye.toLocaleString('nb-NO')}
    oppdaterte     ${oppdaterte.toLocaleString('nb-NO')}
    slettet        ${slettet.toLocaleString('nb-NO')}
    feilet         ${feil.toLocaleString('nb-NO')}
  ny markør        ${hoyesteId.toLocaleString('nb-NO')}
`)
