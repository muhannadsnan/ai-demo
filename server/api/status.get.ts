import { query } from '../utils/db'

/**
 * What the platform holds and when it was last refreshed.
 *
 * Open for now; this becomes an admin page once there are users. Nothing here
 * is sensitive — row counts and timestamps, no data.
 */
/**
 * Counting 12 million rows across seven tables takes about two seconds, and the
 * numbers move a few times a day at most. Recomputing them on every page view
 * is pure waste, so the whole payload is cached briefly in memory.
 *
 * 60 seconds is chosen so that running an import and refreshing the page shows
 * the new numbers within a minute — long enough to remove the load, short
 * enough that the page still feels live. `?fersk=1` forces a recount.
 */
const CACHE_MS = 60_000
let cache: { data: unknown; tid: number } | null = null

export default defineEventHandler(async (event) => {
  const tvungen = getQuery(event).fersk === '1'
  if (!tvungen && cache && Date.now() - cache.tid < CACHE_MS) {
    return { ...(cache.data as object), fra_cache: true, cache_alder_sek: Math.round((Date.now() - cache.tid) / 1000) }
  }

  const [tabeller, importer, dekning] = await Promise.all([
    query(`
      SELECT 'enheter' AS tabell, count(*) AS rader FROM enheter
      UNION ALL SELECT 'roller', count(*) FROM roller
      UNION ALL SELECT 'roller_historikk', count(*) FROM roller_historikk
      UNION ALL SELECT 'regnskap', count(*) FROM regnskap
      UNION ALL SELECT 'aksjonar', count(*) FROM aksjonar
      UNION ALL SELECT 'naeringskoder', count(*) FROM naeringskoder
      UNION ALL SELECT 'postnummer', count(*) FROM postnummer
      UNION ALL SELECT 'kommuner', count(*) FROM kommuner
      UNION ALL SELECT 'fylker', count(*) FROM fylker`),

    query(`SELECT kilde, startet_at, ferdig_at, status, rader_lest, rader_nye,
                  rader_endret, rader_uendret, rader_slettet, varighet_ms, feilmelding,
                  -- ::int, not ::bigint. node-postgres returns int8 as a STRING to avoid
                  -- losing precision beyond 2^53, so a bigint here would arrive as "7200"
                  -- and every numeric comparison in the page would be a string comparison.
                  extract(epoch from alder)::int AS alder_sek
           FROM import_status ORDER BY kilde`),

    query(`SELECT min(extract(year from periode_til))::int AS fra,
                  max(extract(year from periode_til))::int AS til,
                  count(DISTINCT organisasjonsnummer)      AS foretak,
                  count(*) FILTER (WHERE kilde = 'brreg-api')  AS fra_api,
                  count(*) FILTER (WHERE kilde = 'historikk')  AS fra_historikk
           FROM regnskap`)
  ])

  const db = await query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS storrelse`)
  const migrasjoner = await query(`SELECT filename, applied_at FROM schema_migrations ORDER BY filename DESC LIMIT 1`)

  const svar = {
    tabeller: tabeller.map(t => ({ ...t, rader: Number(t.rader) })),
    importer,
    regnskapsdekning: dekning[0],
    database: { storrelse: db[0]?.storrelse, siste_migrasjon: migrasjoner[0] ?? null },
    hentet_at: new Date().toISOString()
  }

  cache = { data: svar, tid: Date.now() }
  return { ...svar, fra_cache: false, cache_alder_sek: 0 }
})
