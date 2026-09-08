import { query } from '../../../utils/db'

/** Current roles, plus roles that have ended. */
export default defineEventHandler(async (event) => {
  const orgnr = getRouterParam(event, 'orgnr')!
  if (!/^\d{9}$/.test(orgnr)) {
    throw createError({ statusCode: 400, statusMessage: 'Organisasjonsnummer må være 9 siffer' })
  }

  const naavaerende = await query(`
    SELECT rollegruppe_kode, rollegruppe_beskrivelse, rolletype_kode, rolletype_beskrivelse,
           rekkefolge, person_fornavn, person_mellomnavn, person_etternavn, person_fodselsdato,
           innehaver_orgnr, innehaver_navn, forst_sett
    FROM roller WHERE organisasjonsnummer = $1
    ORDER BY rollegruppe_kode, rekkefolge NULLS LAST`, [orgnr])

  const tidligere = await query(`
    SELECT rollegruppe_kode, rollegruppe_beskrivelse, rolletype_kode, rolletype_beskrivelse,
           person_fornavn, person_etternavn, person_fodselsdato,
           innehaver_orgnr, innehaver_navn, forst_sett, sist_sett
    FROM roller_historikk WHERE organisasjonsnummer = $1
    ORDER BY sist_sett DESC LIMIT 100`, [orgnr])

  return { naavaerende, tidligere }
})
