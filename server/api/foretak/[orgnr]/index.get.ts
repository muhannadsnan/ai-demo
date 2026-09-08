import { query, queryOne } from '../../../utils/db'

/** Everything the company header and detail page needs, in three queries. */
export default defineEventHandler(async (event) => {
  const orgnr = getRouterParam(event, 'orgnr')!
  if (!/^\d{9}$/.test(orgnr)) {
    throw createError({ statusCode: 400, statusMessage: 'Organisasjonsnummer må være 9 siffer' })
  }

  const foretak = await queryOne(`
    SELECT e.*,
           k.navn  AS kommune_navn,
           f.navn  AS fylke_navn,
           n.navn  AS naering_navn,
           p.navn  AS morselskap_navn
    FROM enheter e
    LEFT JOIN kommuner k ON k.kommunenummer = e.forretningsadresse_kommunenummer
    LEFT JOIN fylker   f ON f.fylkesnummer  = k.fylkesnummer
    LEFT JOIN naeringskoder n ON n.kode     = e.naeringskode1_kode
    LEFT JOIN enheter  p ON p.organisasjonsnummer = e.overordnet_enhet
    WHERE e.organisasjonsnummer = $1`, [orgnr])

  if (!foretak) throw createError({ statusCode: 404, statusMessage: 'Foretaket finnes ikke' })

  // Counts for the tab badges, so each tab knows whether it has anything.
  const [antall] = await query(`
    SELECT
      (SELECT count(*) FROM roller   WHERE organisasjonsnummer = $1) AS roller,
      (SELECT count(*) FROM roller_historikk WHERE organisasjonsnummer = $1) AS tidligere_roller,
      (SELECT count(*) FROM regnskap WHERE organisasjonsnummer = $1) AS regnskapsaar,
      (SELECT count(*) FROM aksjeeie WHERE organisasjonsnummer = $1) AS aksjonaerer,
      (SELECT count(*) FROM enheter  WHERE overordnet_enhet = $1)    AS datterselskap`, [orgnr])

  // Latest accounts for the summary card.
  const sisteRegnskap = await queryOne(`
    SELECT periode_til, valuta, kilde, sum_driftsinntekter, driftsresultat,
           aarsresultat, sum_eiendeler, sum_egenkapital, sum_gjeld
    FROM regnskap WHERE organisasjonsnummer = $1
    ORDER BY periode_til DESC LIMIT 1`, [orgnr])

  return { foretak, antall, sisteRegnskap }
})
