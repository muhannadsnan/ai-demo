import { query } from '../../utils/db'

/**
 * The toplist index: every list's metadata, plus the name at the top of it.
 *
 * The rows are generated nightly by server-drift/ingest/generer-topplister.mjs,
 * so this endpoint never runs an aggregate — it reads one small table. That is
 * the point of precomputing: the expensive queries run once a day at 04:30,
 * not once per visitor.
 *
 * `topp` is the value of the list's own first column in its first three rows,
 * so it works for every list without the endpoint knowing what any of them
 * mean — the card can tease the ranking without loading the whole list.
 */
export default defineEventHandler(async () => {
  const lister = await query(`
    SELECT type, tittel, beskrivelse, kategori, antall, generert_at,
           varighet_ms, feilmelding IS NOT NULL AS feilet,
           (SELECT coalesce(array_agg(r ->> (kolonner -> 0 ->> 'felt')), '{}')
              FROM jsonb_array_elements(data) WITH ORDINALITY AS t(r, i)
             WHERE i <= 3) AS topp
    FROM topplister
    ORDER BY kategori, tittel`)

  const generert = lister.reduce(
    (eldst, l) => !eldst || l.generert_at < eldst ? l.generert_at : eldst,
    null as string | null)

  return { lister, generert }
})
