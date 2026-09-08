/**
 * Import Skatteetaten's Aksjonærregisteret.
 *
 *   node ingest/import-aksjeeie.mjs [path/to/aksjeeiebok_2025.csv] [--year 2025]
 *
 * The file is an annual snapshot, so the year's rows are replaced wholesale.
 *
 * FILE QUIRKS, all of which bite silently:
 *
 *   - UTF-8 WITH BOM. The BOM sits on the first header cell, so a naive reader
 *     ends up with a column called "﻿Orgnr" that never matches "Orgnr".
 *   - SEMICOLON separated, not comma.
 *   - NO QUOTING AT ALL. Seven shareholder names contain a `"` character, and a
 *     standard CSV reader treats the first one as an opening quote and swallows
 *     the rest of the file into one field. Python's csv module aborts with
 *     "field larger than field limit"; a more forgiving parser would silently
 *     produce garbage. COPY is therefore told to use a quote character that
 *     cannot occur in the data.
 *   - The holder identifier column is DUAL PURPOSE: a 4-digit birth year for a
 *     person, a 9-digit organisation number for a company, empty for most
 *     foreign holders. That single field is what separates personal data from
 *     public data, so it is parsed carefully rather than guessed.
 */

import { createReadStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename } from 'node:path'

const args  = process.argv.slice(2)
const FILE  = args.find(a => !a.startsWith('--')) || '../data/raw/aksjeeiebok_2025.csv'
const YEAR  = Number((args.indexOf('--year') >= 0 ? args[args.indexOf('--year') + 1] : null)
                     || (basename(FILE).match(/(\d{4})/)?.[1]) || new Date().getFullYear() - 1)

const COMPOSE_FILE = process.env.COMPOSE_FILE || 'docker-compose.local.yml'
const DB_USER = process.env.POSTGRES_USER || 'app'
const DB_NAME = process.env.POSTGRES_DB   || 'nordata'

const t0 = Date.now()
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`

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

// ------------------------------------------------------------------ staging
console.log('creating staging table…')
await sql(`
  DROP TABLE IF EXISTS staging_aksjeeie;
  CREATE UNLOGGED TABLE staging_aksjeeie (
    orgnr text, selskap text, aksjeklasse text, eier_navn text,
    fodselsaar_orgnr text, postnr_sted text, landkode text,
    antall_aksjer text, antall_aksjer_selskap text
  );`)

// \x01 as the quote character: it cannot appear in this data, so COPY treats
// every field as literal and the seven names containing `"` survive intact.
console.log(`streaming ${basename(FILE)} into staging…`)
await run(['-c', `\\copy staging_aksjeeie FROM STDIN WITH (FORMAT csv, DELIMITER ';', QUOTE E'\\x01', HEADER true)`],
          { source: createReadStream(FILE) })
const staged = Number(await query('SELECT count(*) FROM staging_aksjeeie;'))
console.log(`  ${staged.toLocaleString()} rows staged (${since()})`)

// ------------------------------------------------------------------ promote
console.log('classifying holders and loading…')
await sql(`
BEGIN;

DELETE FROM aksjeeie WHERE regnskapsaar = ${YEAR};

INSERT INTO aksjeeie (
    regnskapsaar, organisasjonsnummer, selskap_navn, aksjeklasse,
    er_person, eier_orgnr, eier_navn, eier_fodselsaar,
    eier_sted_raw, eier_postnr, eier_poststed, eier_landkode,
    antall_aksjer, antall_aksjer_selskap)
SELECT
    ${YEAR},
    lpad(trim(s.orgnr), 9, '0'),
    nullif(trim(s.selskap), ''),
    nullif(trim(s.aksjeklasse), ''),

    -- The dual-purpose identifier decides everything downstream.
    CASE WHEN trim(s.fodselsaar_orgnr) ~ '^\\d{4}$' THEN true
         WHEN trim(s.fodselsaar_orgnr) ~ '^\\d{9}$' THEN false END,

    CASE WHEN trim(s.fodselsaar_orgnr) ~ '^\\d{9}$' THEN trim(s.fodselsaar_orgnr) END,
    nullif(trim(s.eier_navn), ''),
    CASE WHEN trim(s.fodselsaar_orgnr) ~ '^\\d{4}$' THEN trim(s.fodselsaar_orgnr)::smallint END,

    nullif(trim(s.postnr_sted), ''),
    -- Norwegian addresses arrive as "4020 STAVANGER"; foreign ones do not match
    -- and are left unparsed rather than mangled into the wrong columns.
    (regexp_match(trim(s.postnr_sted), '^(\\d{4})\\s+(.+)$'))[1],
    (regexp_match(trim(s.postnr_sted), '^(\\d{4})\\s+(.+)$'))[2],
    nullif(trim(s.landkode), ''),

    nullif(trim(s.antall_aksjer), '')::bigint,
    nullif(trim(s.antall_aksjer_selskap), '')::bigint
FROM staging_aksjeeie s
WHERE trim(s.orgnr) <> ''
ON CONFLICT DO NOTHING;

COMMIT;`)

const [rows, persons, firms, unknown, companies] = (await query(`
  SELECT count(*), count(*) FILTER (WHERE er_person), count(*) FILTER (WHERE er_person IS FALSE),
         count(*) FILTER (WHERE er_person IS NULL), count(DISTINCT organisasjonsnummer)
  FROM aksjeeie WHERE regnskapsaar = ${YEAR};`)).split('|').map(Number)

await sql('DROP TABLE IF EXISTS staging_aksjeeie;')

console.log(`
  year               ${YEAR}
  staged             ${staged.toLocaleString()}
  loaded             ${rows.toLocaleString()}   across ${companies.toLocaleString()} companies
    individuals      ${persons.toLocaleString()}   <- personal data, excluded by the aksjeeie_offentlig view
    companies        ${firms.toLocaleString()}
    unidentified     ${unknown.toLocaleString()}   <- mostly foreign holders with no identifier
  done in ${since()}
`)
