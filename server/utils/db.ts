import pg from 'pg'

/**
 * Return DATE columns as plain strings.
 *
 * By default node-postgres turns a DATE into a JavaScript Date at midnight
 * LOCAL time, which then serialises to JSON as UTC — so 1987-12-10 arrives in
 * the browser as "1987-12-09T23:00:00.000Z" and renders as the 9th in any
 * timezone west of UTC. A founding date has no time and no timezone; keeping it
 * as "1987-12-10" is both correct and simpler.
 *
 * 1082 is the OID for DATE. NUMERIC (1700) is likewise returned as a string by
 * default, because it can exceed the precision of a JS number — that is left
 * alone deliberately: accounting figures are formatted for display, not
 * arithmetic, in the browser.
 */
pg.types.setTypeParser(1082, v => v)

/**
 * One PostgreSQL connection pool for the whole server.
 *
 * A pool, not a connection: every request would otherwise pay the TCP and
 * authentication handshake, and Postgres would run out of backends under any
 * real load. The pool hands out an existing connection and takes it back when
 * the query finishes — the same reason CodeIgniter reuses a database handle
 * rather than opening one per query.
 *
 * Created lazily and cached on the module, so a hot reload in dev does not
 * leak pools.
 */

let pool: pg.Pool | null = null

function getPool(): pg.Pool {
  if (pool) return pool
  const config = useRuntimeConfig()

  pool = new pg.Pool({
    connectionString: config.databaseUrl,
    // Modest: this app is read-only and the queries are fast. Too many
    // connections is a way to exhaust Postgres, not a way to go faster.
    max: 10,
    idleTimeoutMillis: 30_000,
    // Fail fast rather than hanging a request for 30 seconds when the database
    // is down — the page can then say so.
    connectionTimeoutMillis: 5_000
  })

  pool.on('error', err => console.error('[db] idle client error:', err.message))
  return pool
}

/**
 * Run a parameterised query.
 *
 * Values ALWAYS go through `params`, never string interpolation — that is what
 * makes SQL injection structurally impossible rather than merely filtered.
 * Same discipline as CodeIgniter's query bindings.
 */
export async function query<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const started = Date.now()
  try {
    const result = await getPool().query(text, params)
    const ms = Date.now() - started
    // Slow queries are the ones worth knowing about, and only in dev.
    if (import.meta.dev && ms > 200) {
      console.warn(`[db] ${ms}ms  ${text.replace(/\s+/g, ' ').trim().slice(0, 90)}`)
    }
    return result.rows as T[]
  } catch (err) {
    console.error('[db] query failed:', (err as Error).message)
    throw createError({ statusCode: 503, statusMessage: 'Database unavailable' })
  }
}

/** Convenience for queries that return at most one row. */
export async function queryOne<T = any>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params)
  return rows[0] ?? null
}
