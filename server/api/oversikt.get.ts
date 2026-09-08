import { query } from '../utils/db'

/**
 * Numbers for the front page.
 *
 * Deliberately cheap. `/api/status` answers "is the platform healthy", which
 * costs a scan of 4.96 million accounting rows for its year range; a landing
 * page only needs magnitudes, and magnitudes come from the planner's own row
 * estimates in `pg_class.reltuples`, which are free.
 *
 * They are estimates, kept current by autovacuum, and can be a percent or two
 * off after a big import. For "1.2 million companies" that is precise enough,
 * and it is the difference between a front page that renders instantly and one
 * that counts five million rows to say so.
 */
let cache: { at: number; data: unknown } | null = null
const CACHE_MS = 5 * 60 * 1000

export default defineEventHandler(async () => {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data

  const [tall, lister, sisteImport] = await Promise.all([
    query(`
      SELECT relname AS tabell, greatest(reltuples, 0)::bigint AS anslag
      FROM pg_class
      WHERE relname IN ('enheter','roller','aksjonar_persondata','regnskap','enheter_embedding')
        AND relkind = 'r'`),
    query(`
      SELECT type, tittel, kategori, antall,
             data -> 0 ->> (kolonner -> 0 ->> 'felt') AS topp
      FROM topplister
      WHERE type IN ('siste-konkurser','siste-nyetablerte','storst-omsetning','mektigste-kvinner')`),
    query(`SELECT kilde, ferdig_at, status FROM import_status ORDER BY ferdig_at DESC LIMIT 1`)
  ])

  const av = (t: string) => Number(tall.find(r => r.tabell === t)?.anslag ?? 0)

  const data = {
    tall: {
      foretak: av('enheter'),
      roller: av('roller'),
      aksjeposter: av('aksjonar_persondata'),
      regnskapsrader: av('regnskap'),
      embeddinger: av('enheter_embedding')
    },
    lister,
    sisteImport: sisteImport[0] ?? null
  }
  cache = { at: Date.now(), data }
  return data
})
