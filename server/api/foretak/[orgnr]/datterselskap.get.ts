import { query } from '../../../utils/db'

/**
 * Subsidiaries — companies this one holds a majority of.
 *
 * The obvious source, `enheter.overordnet_enhet`, is the wrong one: it links a
 * branch (underenhet) to its main unit and is set for 1,757 rows naming only
 * 322 distinct parents, so almost every group in Norway looked like it had no
 * subsidiaries. Equinor returned 0 that way.
 *
 * Ownership is the real relation. The shareholder register gives an exact
 * percentage per share class, so the holdings are summed per company and
 * anything over 50 % is a subsidiary. Equinor returns 32.
 *
 * `overordnet_enhet` is still honoured as a second source, because where it is
 * set it is authoritative and the company may not appear in the shareholder
 * file at all (foreign branches, non-AS forms).
 *
 * Its own endpoint so the profile page can load it lazily: most companies have
 * none, and the ones that do can have hundreds.
 */
export default defineEventHandler(async (event) => {
  const orgnr = getRouterParam(event, 'orgnr')!
  if (!/^\d{9}$/.test(orgnr)) {
    throw createError({ statusCode: 400, statusMessage: 'Organisasjonsnummer må være 9 siffer' })
  }

  const barn = await query(`
    WITH eid AS (
      SELECT organisasjonsnummer, round(sum(andel_prosent), 2) AS andel
      FROM aksjonar
      WHERE eier_orgnr = $1 AND regnskapsaar = (SELECT max(regnskapsaar) FROM aksjonar)
      GROUP BY 1 HAVING sum(andel_prosent) > 50
      UNION
      SELECT organisasjonsnummer, NULL
      FROM enheter WHERE overordnet_enhet = $1 AND slettet_dato IS NULL
    )
    SELECT e.organisasjonsnummer, e.navn, e.organisasjonsform_kode,
           e.antall_ansatte, e.har_registrert_antall_ansatte,
           e.forretningsadresse_poststed, e.konkurs, e.under_avvikling,
           n.navn AS naering, max(eid.andel) AS andel
    FROM eid
    JOIN enheter e USING (organisasjonsnummer)
    LEFT JOIN naeringskoder n ON n.kode = e.naeringskode1_kode
    WHERE e.slettet_dato IS NULL
    GROUP BY e.organisasjonsnummer, e.navn, e.organisasjonsform_kode,
             e.antall_ansatte, e.har_registrert_antall_ansatte,
             e.forretningsadresse_poststed, e.konkurs, e.under_avvikling, n.navn
    ORDER BY e.antall_ansatte DESC NULLS LAST, e.navn
    LIMIT 500`, [orgnr])

  return { antall: barn.length, datterselskap: barn }
})
