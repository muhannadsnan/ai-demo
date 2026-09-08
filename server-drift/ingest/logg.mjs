/**
 * Record an import run in `import_logg`.
 *
 * Every importer opens a row when it starts and closes it when it finishes, so
 * the status page can distinguish "ran successfully at 04:12" from "started at
 * 04:12 and never finished" — which look identical if you only store the end.
 */
import { spawn } from 'node:child_process'

const COMPOSE_FILE = process.env.COMPOSE_FILE || 'docker-compose.local.yml'
const DB_USER = process.env.POSTGRES_USER || 'app'
const DB_NAME = process.env.POSTGRES_DB   || 'nordata'

function psql(args) {
  const a = ['compose', '-f', COMPOSE_FILE, 'exec', '-T', 'db',
             'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-U', DB_USER, '-d', DB_NAME, ...args]
  return new Promise((resolve, reject) => {
    const p = spawn('docker', a, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('close', c => c === 0 ? resolve(out.trim()) : reject(new Error(err.trim())))
  })
}
const lit = v => v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`

export async function startLogg(kilde) {
  const id = await psql(['-t', '-A', '-c',
    `INSERT INTO import_logg (kilde) VALUES (${lit(kilde)}) RETURNING id;`])
  return { id: Number(id), t0: Date.now() }
}

export async function ferdigLogg(logg, tall = {}) {
  if (!logg?.id) return
  const n = k => tall[k] === undefined ? 'NULL' : Number(tall[k])
  await psql(['-c', `
    UPDATE import_logg SET
      ferdig_at = now(), status = 'ok',
      rader_lest = ${n('lest')}, rader_nye = ${n('nye')}, rader_endret = ${n('endret')},
      rader_uendret = ${n('uendret')}, rader_slettet = ${n('slettet')},
      varighet_ms = ${Date.now() - logg.t0}
    WHERE id = ${logg.id};`])
}

export async function feiletLogg(logg, err) {
  if (!logg?.id) return
  await psql(['-c', `
    UPDATE import_logg SET ferdig_at = now(), status = 'feilet',
      varighet_ms = ${Date.now() - logg.t0},
      feilmelding = ${lit(String(err).slice(0, 500))}
    WHERE id = ${logg.id};`]).catch(() => {})
}
