import { query } from '../utils/db'

/**
 * Counties and municipalities, with a company count each.
 *
 * All 18 counties and 360 municipalities in one small response, so the sidebar
 * can filter the list as you type instead of making you know that Bergen is
 * 4601 — and so it can show you that Utsira has 68 companies before you pick
 * it and wonder why the page is nearly empty.
 *
 * Cached: municipality boundaries change when the government redraws them,
 * which is not often, and the counts move slowly.
 */
let cache: { at: number; data: unknown } | null = null
const CACHE_MS = 10 * 60 * 1000

export default defineEventHandler(async () => {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data

  const [fylker, kommuner] = await Promise.all([
    query(`
      SELECT f.fylkesnummer AS nr, f.navn,
             count(e.organisasjonsnummer)::int AS antall
      FROM fylker f
      LEFT JOIN kommuner k USING (fylkesnummer)
      LEFT JOIN enheter e ON e.forretningsadresse_kommunenummer = k.kommunenummer
                         AND e.slettet_dato IS NULL
      GROUP BY f.fylkesnummer, f.navn ORDER BY f.navn`),
    query(`
      SELECT k.kommunenummer AS nr, k.navn, k.fylkesnummer AS fylke,
             count(e.organisasjonsnummer)::int AS antall
      FROM kommuner k
      LEFT JOIN enheter e ON e.forretningsadresse_kommunenummer = k.kommunenummer
                         AND e.slettet_dato IS NULL
      GROUP BY k.kommunenummer, k.navn, k.fylkesnummer ORDER BY k.navn`)
  ])

  const data = { fylker, kommuner }
  cache = { at: Date.now(), data }
  return data
})
