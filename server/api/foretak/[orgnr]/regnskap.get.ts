import { query } from '../../../utils/db'

/**
 * Accounting history, newest first.
 *
 * All amounts are stored rounded to the nearest thousand and are presented as
 * "tall i tusen"; `kilde` says whether a row came from the live API or the bulk
 * historical collection, so the interface can be honest about precision.
 */
export default defineEventHandler(async (event) => {
  const orgnr = getRouterParam(event, 'orgnr')!
  if (!/^\d{9}$/.test(orgnr)) {
    throw createError({ statusCode: 400, statusMessage: 'Organisasjonsnummer må være 9 siffer' })
  }

  const aar = await query(`
    SELECT periode_fra, periode_til, regnskapstype, valuta, kilde,
           sum_driftsinntekter, sum_driftskostnad, driftsresultat,
           sum_finansinntekter, sum_finanskostnad,
           ordinaert_resultat_for_skatt, aarsresultat,
           sum_eiendeler, sum_anleggsmidler, sum_omloepsmidler,
           sum_egenkapital, sum_gjeld, sum_kortsiktig_gjeld, sum_langsiktig_gjeld
    FROM regnskap
    WHERE organisasjonsnummer = $1
    ORDER BY periode_til DESC`, [orgnr])

  return { antall: aar.length, aar }
})
