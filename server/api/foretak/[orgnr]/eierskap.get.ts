import { query } from '../../../utils/db'

/**
 * Ownership.
 *
 * Reads `aksjeeie_offentlig`, NEVER the `aksjeeie` table. The view keeps every
 * ownership percentage and every corporate holder, and removes individuals'
 * names, birth years and addresses — that data is subject to
 * personopplysningsloven and is stored but not published. See
 * docs/data-provenance-and-licensing.md.
 *
 * Because the personal columns are not in the view at all, a mistake in this
 * query cannot leak them.
 */
export default defineEventHandler(async (event) => {
  const orgnr = getRouterParam(event, 'orgnr')!
  if (!/^\d{9}$/.test(orgnr)) {
    throw createError({ statusCode: 400, statusMessage: 'Organisasjonsnummer må være 9 siffer' })
  }

  const eiere = await query(`
    SELECT a.er_person, a.eier_orgnr, a.eier_navn, a.aksjeklasse,
           a.antall_aksjer, a.antall_aksjer_selskap, a.andel_prosent,
           e.navn AS eier_foretaksnavn
    FROM aksjeeie_offentlig a
    LEFT JOIN enheter e ON e.organisasjonsnummer = a.eier_orgnr
    WHERE a.organisasjonsnummer = $1
    ORDER BY a.andel_prosent DESC NULLS LAST`, [orgnr])

  // Where this company is itself a shareholder.
  const eierandeler = await query(`
    SELECT a.organisasjonsnummer, e.navn, a.andel_prosent, a.antall_aksjer
    FROM aksjeeie_offentlig a
    LEFT JOIN enheter e ON e.organisasjonsnummer = a.organisasjonsnummer
    WHERE a.eier_orgnr = $1
    ORDER BY a.andel_prosent DESC NULLS LAST LIMIT 200`, [orgnr])

  const personer = eiere.filter(e => e.er_person).length
  return {
    eiere,
    eierandeler,
    oppsummering: {
      antall_eiere: eiere.length,
      antall_personeiere: personer,
      antall_foretakseiere: eiere.length - personer,
      personer_skjult: personer > 0
    }
  }
})
