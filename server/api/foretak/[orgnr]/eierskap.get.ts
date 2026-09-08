import { query } from '../../../utils/db'

/**
 * Ownership.
 *
 * Reads the `aksjonar` VIEW, never the `aksjonar_persondata` table. The view keeps every
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

  /**
   * Capped at the 200 largest holdings.
   *
   * Equinor has 131,597 registered shareholders. Returning all of them took
   * 0.5 s in the API and 3.8 s in the browser, for a list nobody scrolls past
   * the top of — ownership is a power-law distribution and everything after the
   * first page is a private individual with a rounding error of the shares,
   * whose name is not published anyway. The totals below are counted
   * separately, so the summary still describes the whole register.
   */
  const TAK = 200
  const eiere = await query(`
    SELECT a.er_person, a.eier_orgnr, a.eier_navn, a.aksjeklasse,
           a.antall_aksjer, a.antall_aksjer_selskap, a.andel_prosent,
           e.navn AS eier_foretaksnavn
    FROM aksjonar a
    LEFT JOIN enheter e ON e.organisasjonsnummer = a.eier_orgnr
    WHERE a.organisasjonsnummer = $1
    ORDER BY a.andel_prosent DESC NULLS LAST
    LIMIT ${TAK}`, [orgnr])

  // Where this company is itself a shareholder.
  const eierandeler = await query(`
    SELECT a.organisasjonsnummer, e.navn, a.andel_prosent, a.antall_aksjer
    FROM aksjonar a
    LEFT JOIN enheter e ON e.organisasjonsnummer = a.organisasjonsnummer
    WHERE a.eier_orgnr = $1
    ORDER BY a.andel_prosent DESC NULLS LAST LIMIT 200`, [orgnr])

  // Counted over the whole register, not over the capped list above.
  const [sum] = await query(`
    SELECT count(*)::int AS alle,
           count(*) FILTER (WHERE er_person)::int AS personer
    FROM aksjonar WHERE organisasjonsnummer = $1`, [orgnr])

  return {
    eiere,
    eierandeler,
    oppsummering: {
      antall_eiere: sum?.alle ?? 0,
      antall_personeiere: sum?.personer ?? 0,
      antall_foretakseiere: (sum?.alle ?? 0) - (sum?.personer ?? 0),
      personer_skjult: (sum?.personer ?? 0) > 0,
      vist: eiere.length,
      avkortet: (sum?.alle ?? 0) > eiere.length
    }
  }
})
