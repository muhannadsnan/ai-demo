/**
 * Load first names by gender from SSB table 10501.
 *
 *   node ingest/import-fornavn.mjs
 *
 * SSB codes every name with a prefix: 1 for girls' names, 2 for boys'. A name
 * appearing under both prefixes is stored as ambiguous rather than assigned to
 * whichever list happened to be read last.
 */

import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { startLogg, ferdigLogg, feiletLogg } from './logg.mjs'

const COMPOSE_FILE = process.env.COMPOSE_FILE || 'docker-compose.local.yml'
const DB_USER = process.env.POSTGRES_USER || 'app'
const DB_NAME = process.env.POSTGRES_DB   || 'nordata'
const KILDE   = 'https://data.ssb.no/api/v0/no/table/10501'

function run(extra, { source = null } = {}) {
  const a = ['compose', '-f', COMPOSE_FILE, 'exec', '-T', 'db',
             'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-U', DB_USER, '-d', DB_NAME, ...extra]
  return new Promise((resolve, reject) => {
    const p = spawn('docker', a, { stdio: [source ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (err += d))
    p.on('close', c => c === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `psql ${c}`)))
    if (source) { source.on('error', reject); source.pipe(p.stdin) }
  })
}
const sql   = s => run(['-c', s])
const query = s => run(['-t', '-A', '-F', '|', '-c', s])

const logg = await startLogg('fornavn')
process.on('uncaughtException', async e => { await feiletLogg(logg, e); process.exit(1) })

console.log('henter navn fra SSB…')
const meta = await fetch(KILDE, { headers: { Accept: 'application/json' } }).then(r => r.json())
const v = meta.variables.find(x => /navn/i.test(x.text))
if (!v) throw new Error('fant ikke navnedimensjonen i SSB-tabellen')

const kjonnFor = new Map()
for (let i = 0; i < v.values.length; i++) {
  const kode = v.values[i], navn = v.valueTexts[i].trim().toUpperCase()
  const k = kode.startsWith('1') ? 'K' : kode.startsWith('2') ? 'M' : null
  if (!k || !navn) continue
  // Present under both prefixes: ambiguous, and recorded as such.
  kjonnFor.set(navn, kjonnFor.has(navn) && kjonnFor.get(navn) !== k ? '?' : k)
}

const rader = [...kjonnFor].map(([navn, k]) => `"${navn.replace(/"/g, '""')}",${k}\n`)
await sql('TRUNCATE fornavn_kjonn;')
await run(['-c', `\\copy fornavn_kjonn (fornavn, kjonn) FROM STDIN WITH (FORMAT csv, QUOTE '"')`],
          { source: Readable.from(rader) })

const [k, m, u] = (await query(`SELECT count(*) FILTER (WHERE kjonn='K'), count(*) FILTER (WHERE kjonn='M'),
                                       count(*) FILTER (WHERE kjonn='?') FROM fornavn_kjonn;`)).split('|').map(Number)
await ferdigLogg(logg, { lest: rader.length, nye: rader.length, endret: 0, uendret: 0, slettet: 0 })
console.log(`
  jentenavn   ${k}
  guttenavn   ${m}
  tvetydige   ${u}   <- finnes i begge listene, brukes ikke
  totalt      ${k + m + u}
`)
