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
const MAKS      = Number(valueOf('--maks', 5000))
const THROTTLE  = Number(valueOf('--throttle', 200))
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

if (!cursor || args.includes('--start-naa')) {
  // No cursor yet. Seed it to the newest event rather than replaying 16.4M
  // historical ones — the full-file import has already established the state,
  // so only what happens from here matters.
  const siste = await fetch(`${FEED}?size=1&oppdateringsid=999999999`).then(r => r.json()).catch(() => null)
  const nyeste = siste?._embedded?.oppdaterteEnheter?.[0]?.oppdateringsid
  cursor = Number(nyeste ?? 0)
  if (!cursor) {
    // The API returns nothing past the end; walk back from a large page instead.
    const p = await fetch(`${FEED}?size=1`).then(r => r.json())
    cursor = Number(p?.page?.totalElements ?? 0)
  }
  await sql(`INSERT INTO import_cursor (kilde, siste_id) VALUES ('enheter', ${cursor})
             ON CONFLICT (kilde) DO UPDATE SET siste_id = ${cursor}, oppdatert_at = now();`)
  console.log(`markør satt til ${cursor.toLocaleString('nb-NO')} — ingen historikk spilles av`)
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
async function* linjer() {
  for (const orgnr of aaHente) {
    try {
      const res = await fetch(`${ENHET}/${orgnr}`, { headers: { Accept: 'application/json' } })
      if (res.ok) {
        const doc = await res.text()
        yield '"' + doc.replace(/"/g, '""') + '"\n'
        hentet++
      } else if (res.status === 404 || res.status === 410) {
        // Gone from the register but not announced as a deletion.
        await sql(`UPDATE enheter SET slettet_dato = current_date WHERE organisasjonsnummer='${orgnr}' AND slettet_dato IS NULL;`)
      } else feil++
    } catch { feil++ }
    if (hentet % 200 === 0 && hentet) console.log(`  hentet ${hentet}/${aaHente.length}…`)
    await sleep(THROTTLE)
  }
}
await run(['-c', `\\copy staging_oppdatering (doc) FROM STDIN WITH (FORMAT csv, QUOTE '"')`],
          { source: Readable.from(linjer()) })

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
