import { query } from '../../utils/db'

/**
 * The toplist index: every list's metadata, plus the name at the top of it.
 *
 * The rows are generated nightly by server-drift/ingest/generer-topplister.mjs,
 * so this endpoint never runs an aggregate — it reads one small table. That is
 * the point of precomputing: the expensive queries run once a day at 04:30,
 * not once per visitor.
 *
 * `topp` is the value of the list's own first column in its own first row, so
 * it works for every list without the endpoint knowing what any of them mean.
 */
export default defineEventHandler(async () => {
  const lister = await query(`
    SELECT type, tittel, beskrivelse, kategori, antall, generert_at,
           varighet_ms, feilmelding IS NOT NULL AS feilet,
           data -> 0 ->> (kolonner -> 0 ->> 'felt') AS topp
    FROM topplister
    ORDER BY kategori, tittel`)

  const generert = lister.reduce(
    (eldst, l) => !eldst || l.generert_at < eldst ? l.generert_at : eldst,
    null as string | null)

  return { lister, generert }
})
