import { query } from '../utils/db'

/**
 * The NACE industry tree, levels 1–4, with a company count per node.
 *
 * Returned in one call rather than a request per expanded branch: 1,047 nodes
 * is about 60 KB, which is cheaper than the round trips would be, and it lets
 * the filter tree open and close instantly.
 *
 * Counts come from the level-5 codes companies actually carry, rolled up to
 * every ancestor. They are what makes the tree usable — you can see that
 * "Bygge- og anleggsvirksomhet" has 100,000 companies before ticking it.
 *
 * Cached in memory: the tree changes when Brreg publishes a new NACE revision,
 * which is roughly never, and the counts move slowly.
 */
let cache: { at: number; data: unknown } | null = null
const CACHE_MS = 10 * 60 * 1000

export default defineEventHandler(async () => {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data

  const noder = await query(`
    WITH RECURSIVE
    -- What each level-5 code is used by.
    bruk AS (
      SELECT naeringskode1_kode AS kode, count(*)::int AS antall
      FROM enheter WHERE slettet_dato IS NULL AND naeringskode1_kode IS NOT NULL
      GROUP BY 1
    ),
    -- Walk every used code up to the root, so each ancestor sees its share.
    opp AS (
      SELECT n.kode, n.parent_kode, b.antall
      FROM bruk b JOIN naeringskoder n ON n.kode = b.kode
      UNION ALL
      SELECT p.kode, p.parent_kode, o.antall
      FROM opp o JOIN naeringskoder p ON p.kode = o.parent_kode
    ),
    sum_per_kode AS (
      SELECT kode, sum(antall)::int AS antall FROM opp GROUP BY kode
    )
    SELECT n.kode, n.navn, n.niva, n.parent_kode,
           coalesce(s.antall, 0) AS antall
    FROM naeringskoder n
    LEFT JOIN sum_per_kode s USING (kode)
    WHERE n.niva <= 4
    ORDER BY n.niva, n.kode`)

  const data = { noder }
  cache = { at: Date.now(), data }
  return data
})
