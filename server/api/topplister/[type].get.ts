import { queryOne } from '../../utils/db'

/** One toplist, with its column definitions and its rows. */
export default defineEventHandler(async (event) => {
  const type = getRouterParam(event, 'type')!
  if (!/^[a-z0-9-]{1,64}$/.test(type)) {
    throw createError({ statusCode: 400, statusMessage: 'Ugyldig listetype' })
  }

  const liste = await queryOne(`
    SELECT type, tittel, beskrivelse, kategori, kolonner, data, antall,
           generert_at, varighet_ms, feilmelding
    FROM topplister WHERE type = $1`, [type])

  if (!liste) throw createError({ statusCode: 404, statusMessage: 'Ukjent liste' })
  return liste
})
