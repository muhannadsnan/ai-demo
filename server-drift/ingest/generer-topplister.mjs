#!/usr/bin/env node
/**
 * Generate the toplists into the `topplister` table.
 *
 * Each list is one INSERT ... SELECT that wraps its query in jsonb_agg, so the
 * rows are aggregated into JSON inside Postgres and never travel through Node.
 * A list that fails records its error in `feilmelding` and leaves the previous
 * data in place — one broken query must not blank the page.
 *
 * Usage:
 *   node ingest/generer-topplister.mjs            # all lists
 *   node ingest/generer-topplister.mjs siste-konkurser storst-vekst
 */
import { spawn } from 'node:child_process'
import { LISTER } from './topplister.mjs'
import { startLogg, ferdigLogg, feiletLogg } from './logg.mjs'

const COMPOSE_FILE = process.env.COMPOSE_FILE || 'docker-compose.local.yml'
const DB_USER = process.env.POSTGRES_USER || 'app'
const DB_NAME = process.env.POSTGRES_DB   || 'nordata'
const TIMEOUT_MS = Number(process.env.TOPPLISTE_TIMEOUT_MS || 120000)

function psql(sql) {
  const args = ['compose', '-f', COMPOSE_FILE, 'exec', '-T', 'db',
                'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-U', DB_USER, '-d', DB_NAME,
                '-c', `SET statement_timeout = ${TIMEOUT_MS}; ${sql}`]
  return new Promise((resolve, reject) => {
    const p = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('close', c => c === 0 ? resolve(out.trim())
      : reject(new Error(err.trim().split('\n').filter(l => l.startsWith('ERROR')).join(' ') || err.trim())))
  })
}

const lit = v => v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`

/** Rewrite one list, keeping the old data if the query fails. */
async function generer(l) {
  const t0 = Date.now()
  const sql = `
    INSERT INTO topplister (type, tittel, beskrivelse, kategori, kolonner, data, antall, generert_at, varighet_ms, feilmelding)
    SELECT ${lit(l.type)}, ${lit(l.tittel)}, ${lit(l.beskrivelse)}, ${lit(l.kategori)},
           ${lit(JSON.stringify(l.kolonner))}::jsonb,
           coalesce(jsonb_agg(t), '[]'::jsonb), count(*), now(), NULL, NULL
    FROM ( ${l.sql} ) t
    ON CONFLICT (type) DO UPDATE SET
      tittel = EXCLUDED.tittel, beskrivelse = EXCLUDED.beskrivelse,
      kategori = EXCLUDED.kategori, kolonner = EXCLUDED.kolonner,
      data = EXCLUDED.data, antall = EXCLUDED.antall,
      generert_at = EXCLUDED.generert_at, feilmelding = NULL
    RETURNING antall;`

  try {
    const antall = Number(await psql(sql))
    const ms = Date.now() - t0
    await psql(`UPDATE topplister SET varighet_ms = ${ms} WHERE type = ${lit(l.type)};`)
    return { type: l.type, antall, ms }
  } catch (e) {
    const ms = Date.now() - t0
    // Keep whatever data the list already had; just flag it.
    await psql(`
      INSERT INTO topplister (type, tittel, beskrivelse, kategori, kolonner, data, antall, generert_at, varighet_ms, feilmelding)
      VALUES (${lit(l.type)}, ${lit(l.tittel)}, ${lit(l.beskrivelse)}, ${lit(l.kategori)},
              ${lit(JSON.stringify(l.kolonner))}::jsonb, '[]'::jsonb, 0, now(), ${ms}, ${lit(e.message)})
      ON CONFLICT (type) DO UPDATE SET
        varighet_ms = ${ms}, feilmelding = ${lit(e.message)};`).catch(() => {})
    return { type: l.type, antall: 0, ms, feil: e.message }
  }
}

const valgt = process.argv.slice(2)
const kjor = valgt.length ? LISTER.filter(l => valgt.includes(l.type)) : LISTER
if (valgt.length && kjor.length !== valgt.length) {
  const ukjent = valgt.filter(v => !LISTER.some(l => l.type === v))
  console.error(`Ukjent liste: ${ukjent.join(', ')}`)
  process.exit(1)
}

// The lists rank on `regnskap_siste`, so it has to be current before they run.
// CONCURRENTLY keeps the site answering while it rebuilds — without it the
// refresh takes an exclusive lock and every search waits on it.
process.stdout.write('  oppdaterer regnskap_siste … ')
const tRefresh = Date.now()
await psql('REFRESH MATERIALIZED VIEW CONCURRENTLY regnskap_siste;')
console.log(`${((Date.now() - tRefresh) / 1000).toFixed(1)}s`)

const logg = await startLogg('topplister').catch(() => null)
const resultat = []
for (const l of kjor) {
  const r = await generer(l)
  resultat.push(r)
  const tid = `${(r.ms / 1000).toFixed(1)}s`.padStart(7)
  if (r.feil) console.log(`  ${'FEIL'.padEnd(8)} ${tid}  ${l.type}\n           ${r.feil}`)
  else console.log(`  ${String(r.antall).padEnd(8)} ${tid}  ${l.type}`)
}

const feilet = resultat.filter(r => r.feil)
const rader = resultat.reduce((s, r) => s + r.antall, 0)
console.log(`\n${kjor.length} lister, ${rader} rader, ${feilet.length} feilet`)

if (logg) {
  if (feilet.length) await feiletLogg(logg, `${feilet.length} lister feilet: ${feilet.map(f => f.type).join(', ')}`).catch(() => {})
  else await ferdigLogg(logg, { lest: rader, endret: kjor.length }).catch(() => {})
}
process.exit(feilet.length ? 1 : 0)
