import { query } from '../../../utils/db'

/**
 * The corporate ownership network around one company.
 *
 * Two recursive walks over `eierskap_kant` (migration 029): upwards through the
 * companies that own this one, downwards through the companies it owns.
 *
 * ONLY corporate holdings. A private individual is never a node here: the
 * `aksjonar` view has already removed their names, and a person's position in
 * an ownership graph is exactly the kind of profile this project does not
 * publish. The ownership tab reports individuals as a count instead.
 *
 * The recursion collects NODES, not edges, and the edges are fetched afterwards
 * for the pairs that are actually in the set.
 *
 * That distinction is the whole performance story. Recursing over edges lets
 * the same company be re-expanded once per path that reaches it, and ownership
 * graphs are dense with shared paths: walking three levels up from Equinor
 * produced 48,588 rows and took 803 ms, for a network of a few hundred
 * companies. Deduplicating on the company instead makes the same walk 5 ms.
 *
 * Bounded on depth and node count regardless — an ownership graph has no
 * natural edge, and follow it far enough from anywhere and you have half of
 * Norwegian business.
 */
const MAKS_DYBDE = 4
const MAKS_NODER = 120

export default defineEventHandler(async (event) => {
  const orgnr = getRouterParam(event, 'orgnr')!
  if (!/^\d{9}$/.test(orgnr)) {
    throw createError({ statusCode: 400, statusMessage: 'Organisasjonsnummer må være 9 siffer' })
  }
  const dybde = Math.min(Math.max(Number(getQuery(event).dybde) || 3, 1), MAKS_DYBDE)

  /**
   * `retning` picks which way the walk goes, and it is the ONLY difference
   * between the two queries: upwards follows eier_orgnr, downwards follows
   * organisasjonsnummer. Written once rather than twice so the two directions
   * cannot drift apart.
   */
  const walk = (fra: 'opp' | 'ned') => {
    const [neste, via] = fra === 'opp'
      ? ['k.eier_orgnr', 'k.organisasjonsnummer']
      : ['k.organisasjonsnummer', 'k.eier_orgnr']
    return `
      WITH RECURSIVE nabo AS (
        SELECT $1::char(9) AS orgnr, 0 AS niva, 100::numeric AS andel
        UNION
        SELECT ${neste}, n.niva + 1, k.andel
        FROM eierskap_kant k JOIN nabo n ON ${via} = n.orgnr
        WHERE n.niva < $2
      ),
      -- A company reachable at two depths belongs at the shallower one, and
      -- carries the largest stake by which it is connected.
      node AS (SELECT orgnr, min(niva) AS niva, max(andel) AS andel FROM nabo GROUP BY orgnr),
      -- Equinor has 4,658 corporate shareholders and the cap admits 120, so
      -- which 120 matters: the biggest stakes nearest the company, not an
      -- arbitrary slice by organisation number.
      valgt AS (SELECT * FROM node ORDER BY niva, andel DESC NULLS LAST LIMIT ${MAKS_NODER})
      SELECT v.orgnr, v.niva, v.andel, e.navn, e.organisasjonsform_kode AS form,
             e.konkurs, e.under_avvikling, nullif(e.antall_ansatte, 0) AS ansatte,
             e.forretningsadresse_poststed AS sted,
             -- Every holding between two companies that are both in the set,
             -- so the client can draw the tree without a second request.
             (SELECT coalesce(json_agg(json_build_object(
                       'eier', k.eier_orgnr, 'selskap', k.organisasjonsnummer, 'andel', k.andel)), '[]')
              FROM eierskap_kant k
              WHERE k.${fra === 'opp' ? 'eier_orgnr' : 'organisasjonsnummer'} = v.orgnr
                AND k.${fra === 'opp' ? 'organisasjonsnummer' : 'eier_orgnr'} IN (SELECT orgnr FROM valgt)
             ) AS kanter
      FROM valgt v LEFT JOIN enheter e ON e.organisasjonsnummer = v.orgnr
      WHERE v.niva > 0
      ORDER BY v.niva, e.antall_ansatte DESC NULLS LAST, e.navn`
  }

  const [opp, ned, antall] = await Promise.all([
    query(walk('opp'), [orgnr, dybde]),
    query(walk('ned'), [orgnr, dybde]),
    query(`SELECT
             (SELECT count(*)::int FROM eierskap_kant WHERE organisasjonsnummer = $1) AS eiere,
             (SELECT count(*)::int FROM eierskap_kant WHERE eier_orgnr = $1) AS eier_i`, [orgnr])
  ])

  return {
    dybde,
    maksNoder: MAKS_NODER,
    direkte: antall[0],
    opp,
    ned,
    avkortet: { opp: opp.length >= MAKS_NODER - 1, ned: ned.length >= MAKS_NODER - 1 }
  }
})
