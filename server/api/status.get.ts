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

  const [tabeller, importer, dekning, daekning2, valutaer, indekser, embedding] = await Promise.all([
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

    // extract(year from min(periode_til)), not min(extract(year from ...)).
    // Wrapping the column in a function hides it from regnskap_periode_idx, so
    // the min/max became a scan of 4.99 million rows. Taking the min first lets
    // the index answer it: 5,198 ms to 1 ms. The counts below still scan —
    // count(DISTINCT) over five million values has to — which is why this
    // endpoint is cached for 60 seconds.
    query(`SELECT extract(year from min(periode_til))::int AS fra,
                  extract(year from max(periode_til))::int AS til,
                  count(DISTINCT organisasjonsnummer)      AS foretak,
                  count(*) FILTER (WHERE kilde = 'brreg-api')  AS fra_api,
                  count(*) FILTER (WHERE kilde = 'historikk')  AS fra_historikk
           FROM regnskap`),

    /**
     * Coverage, quality and position — the three questions a status page
     * should answer beyond "did the job run".
     *
     * Coverage: how much of the register each dataset actually reaches.
     * Quality: what we know is wrong or excluded, stated rather than hidden.
     * Position: where the change feed cursor stands, which is what makes a gap
     * in scheduling safe.
     */
    query(`SELECT
             (SELECT count(*)::int FROM enheter WHERE slettet_dato IS NULL) AS foretak,
             (SELECT count(*)::int FROM enheter WHERE slettet_dato IS NULL
               AND siste_innsendte_aarsregnskap IS NOT NULL) AS med_regnskap,
             (SELECT count(*)::int FROM enheter WHERE slettet_dato IS NULL
               AND length(coalesce(aktivitet, vedtektsfestet_formaal)) >= 12) AS med_beskrivelse,
             (SELECT count(*)::int FROM enheter WHERE slettet_dato IS NOT NULL) AS slettet,
             (SELECT count(*)::int FROM enheter WHERE savnet_siden IS NOT NULL) AS savnet,
             (SELECT count(*)::int FROM roller_historikk) AS arkiverte_roller,
             (SELECT min(sist_sett)::date::text FROM roller_historikk) AS arkiv_fra,
             -- When archiving began, so an empty table reads as "nothing has
             -- ended yet" rather than "this is broken".
             (SELECT applied_at::date::text FROM schema_migrations
               WHERE filename LIKE '%roller_history%' ORDER BY filename LIMIT 1) AS arkiv_siden,
             (SELECT siste_id::text FROM import_cursor WHERE kilde = 'enheter') AS markor,
             (SELECT oppdatert_at FROM import_cursor WHERE kilde = 'enheter') AS markor_at,
             (SELECT count(*)::int FROM regnskap_siste WHERE NOT rimelig) AS urimelige,
             (SELECT count(*)::int FROM regnskap_hentelogg WHERE status = 'feil') AS hentefeil,
             (SELECT count(*)::int FROM regnskap_hentelogg WHERE status = 'ingen_data') AS ingen_regnskap`),

    // Currency mix. The bulk history records NOK for everything; the API
    // disagrees for about one percent, and those companies read as ten times
    // their true size until they are refetched. Worth showing, not hiding.
    query(`SELECT kilde, coalesce(valuta, '—') AS valuta, count(*)::int AS rader
           FROM regnskap GROUP BY 1, 2 ORDER BY 1, 3 DESC`),

    // Every index, grouped by table on the page. An index is a design
    // decision, and this is the cheapest way to show which ones exist.
    query(`SELECT tablename AS tabell, indexname AS navn,
                  pg_relation_size(indexname::regclass) AS bytes,
                  indexdef AS definisjon
           FROM pg_indexes WHERE schemaname = 'public'
           ORDER BY tablename, indexname`),

    // Embedding coverage. The first pass over 1.1 million descriptions takes
    // about 100 minutes, and while it runs the semantic search silently covers
    // only part of the data — which looks like bad results rather than an
    // unfinished job. Showing the progress makes the difference visible.
    query(`SELECT
             (SELECT count(*)::int FROM enheter_embedding) AS gjort,
             (SELECT count(*)::int FROM enheter
               WHERE slettet_dato IS NULL
                 AND length(coalesce(aktivitet, vedtektsfestet_formaal)) >= 12) AS totalt,
             (SELECT max(oppdatert_at) FROM enheter_embedding) AS sist,
             (SELECT count(*) FROM pg_indexes
               WHERE indexname = 'enheter_embedding_hnsw') AS har_indeks`)
  ])

  const db = await query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS storrelse`)
  const migrasjoner = await query(`SELECT filename, applied_at FROM schema_migrations ORDER BY filename DESC LIMIT 1`)

  const svar = {
    tabeller: tabeller.map(t => ({ ...t, rader: Number(t.rader) })),
    importer,
    regnskapsdekning: dekning[0],
    dekningstall: daekning2[0],
    valutaer,
    indekser: indekser.map(i => ({ ...i, bytes: Number(i.bytes) })),
    embedding: (() => {
      const e = embedding[0] ?? {}
      const gjort = Number(e.gjort ?? 0), totalt = Number(e.totalt ?? 0)
      return {
        gjort, totalt,
        andel: totalt ? Math.round((gjort / totalt) * 1000) / 10 : 0,
        sist: e.sist ?? null,
        har_indeks: Number(e.har_indeks ?? 0) > 0,
        ferdig: totalt > 0 && gjort >= totalt
      }
    })(),
    database: { storrelse: db[0]?.storrelse, siste_migrasjon: migrasjoner[0] ?? null },
    hentet_at: new Date().toISOString()
  }

  cache = { data: svar, tid: Date.now() }
  return { ...svar, fra_cache: false, cache_alder_sek: 0 }
})
