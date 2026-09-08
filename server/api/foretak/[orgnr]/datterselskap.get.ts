import { query } from '../../../utils/db'

/**
 * Subsidiaries — companies naming this one as their parent.
 *
 * Its own endpoint so the profile page can load it lazily: most companies have
 * none, and the ones that do can have hundreds. Fetching it with the header
 * would make every profile pay for a query almost nobody needs.
 */
export default defineEventHandler(async (event) => {
  const orgnr = getRouterParam(event, 'orgnr')!
  if (!/^\d{9}$/.test(orgnr)) {
    throw createError({ statusCode: 400, statusMessage: 'Organisasjonsnummer må være 9 siffer' })
  }
  const barn = await query(`
    SELECT e.organisasjonsnummer, e.navn, e.organisasjonsform_kode,
           e.antall_ansatte, e.har_registrert_antall_ansatte,
           e.forretningsadresse_poststed, e.konkurs, e.under_avvikling,
           n.navn AS naering
    FROM enheter e
    LEFT JOIN naeringskoder n ON n.kode = e.naeringskode1_kode
    WHERE e.overordnet_enhet = $1 AND e.slettet_dato IS NULL
    ORDER BY e.antall_ansatte DESC NULLS LAST, e.navn
    LIMIT 500`, [orgnr])
  return { antall: barn.length, datterselskap: barn }
})
