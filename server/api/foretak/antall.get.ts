import { query } from '../../utils/db'
import { byggFilter } from '../../utils/foretak-filter'

/**
 * The exact number of matches for a search.
 *
 * Separate from the results on purpose. An exact `count(*)` has to touch every
 * matching row: measured at 955 ms unfiltered, 224-366 ms with a filter, where
 * the capped count the results endpoint returns costs about 20 ms.
 *
 * Paying that on the search itself would make every keystroke slow to serve a
 * number nobody has read yet. So the results come back immediately with a
 * capped "10 000+", the page asks this endpoint in the background, and the
 * figure is replaced with the real one a moment later.
 *
 * Same `byggFilter` as the search, so the count can never describe a different
 * set than the list above it.
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  // Semantic search is excluded: it ranks by distance and has no fixed
  // membership to count — every company is some distance away.
  const { where, params, trengerRegnskap } = await byggFilter(q as Record<string, any>, false)

  const join = trengerRegnskap ? 'JOIN regnskap_siste r USING (organisasjonsnummer)' : ''
  const [rad] = await query(
    `SELECT count(*)::bigint AS n FROM enheter e ${join} WHERE ${where.join(' AND ')}`, params)

  return { antall: Number(rad?.n ?? 0) }
})
