import { query } from '../../utils/db'
import { byggFilter } from '../../utils/foretak-filter'

/**
 * Company search.
 *
 *   /api/foretak/search?q=nordvik&fylke=Oslo&nace=41,42&omsetning_min=10000000
 *
 * Every filter is optional and every value is bound as a parameter — the SQL
 * text is fixed, only the WHERE clauses are assembled. That is what makes
 * injection impossible here rather than merely unlikely.
 */

/**
 * Sort options, and the index each one rides on.
 *
 * Sorting is not free. Without a matching index, ORDER BY over 1.17 million
 * rows is a top-N heapsort — Postgres reads every candidate and keeps the best
 * ten — which measured 281-318 ms. Migration 030 adds an index per option whose
 * order already matches, turning the sort into a walk that stops after ten
 * rows: 0.08-0.2 ms.
 *
 * `navn` is the tie-breaker everywhere. Without a total order, two rows that
 * compare equal can come back in a different order on the next page, and the
 * same company shows up twice while another never appears.
 *
 * `regnskap` marks the two that need the accounts view joined in.
 */
const SORTERING: Record<string, { sql: string; tittel: string; regnskap?: boolean }> = {
  ansatte:    { sql: 'e.antall_ansatte DESC NULLS LAST, e.navn', tittel: 'Flest ansatte' },
  navn:       { sql: 'e.navn ASC', tittel: 'Navn (A–Å)' },
  nyest:      { sql: 'e.registreringsdato_enhetsregisteret DESC NULLS LAST, e.navn', tittel: 'Nyest registrert' },
  eldst:      { sql: 'e.stiftelsesdato ASC NULLS LAST, e.navn', tittel: 'Eldst (stiftelsesdato)' },
  omsetning:  { sql: 'r.sum_driftsinntekter DESC NULLS LAST, e.navn', tittel: 'Størst omsetning', regnskap: true },
  resultat:   { sql: 'r.aarsresultat DESC NULLS LAST, e.navn', tittel: 'Best årsresultat', regnskap: true }
}


export default defineEventHandler(async (event) => {
  const q = getQuery(event)

  const { where, params, trengerRegnskap: harBelopsfilter, semantisk, semantiskLedd } =
    await byggFilter(q as Record<string, any>)
  const bind = (v: unknown) => `$${params.push(v)}`

  const sorterEtter = String(q.sorter ?? 'ansatte')
  const valgtSort = SORTERING[sorterEtter] ?? SORTERING.ansatte!

  // An accounts sort needs the accounts view joined even when no range filter
  // asked for it, and only over rows whose figures are trustworthy.
  const trengerRegnskap = harBelopsfilter || !!valgtSort.regnskap
  if (!harBelopsfilter && valgtSort.regnskap) where.push('r.rimelig')

  const join = [
    trengerRegnskap ? 'JOIN regnskap_siste r USING (organisasjonsnummer)' : '',
    semantisk ? 'JOIN enheter_embedding em USING (organisasjonsnummer)' : ''
  ].filter(Boolean).join(' ')

  // Semantic search brings its own order — the closest match first is the
  // entire point — so it overrides whatever is picked in the dropdown.
  const sortering = semantisk ? `${semantiskLedd} ASC` : valgtSort.sql

  const perPage = Math.min(Math.max(Number(q.per) || 10, 1), 100)
  const page    = Math.max(Number(q.side) || 1, 1)

  // The count is deliberately capped.
  //
  // `count(*) OVER ()` alongside the results looked tidy and cost 1.9 seconds:
  // the window function has to produce every matching row before it can count
  // them, so an unfiltered search scanned 1,173,022 rows to return 25.
  //
  // Nobody pages to result 900,000. Counting up to a ceiling and reporting
  // "10 000+" beyond it answers the only question the number is asked for —
  // roughly how many, and how many pages — and stops after 10,001 rows.
  //
  // A semantic search skips the count entirely. HNSW is an ORDERING index —
  // it answers "what is nearest", not "what is within a distance" — so a
  // `WHERE distance < x` count cannot use it and degrades to computing the
  // distance for every row until it has counted enough. Measured: 2,640 ms of
  // a 2,800 ms request, to produce a number that means nothing anyway. The
  // semantic result set is "the N nearest", not a membership with a size.
  const TAK = 10000
  const [rows, antall] = await Promise.all([
    query(`
      SELECT e.organisasjonsnummer, e.navn,
             e.organisasjonsform_kode, e.organisasjonsform_beskrivelse,
             e.naeringskode1_kode, e.naeringskode1_beskrivelse,
             e.forretningsadresse_poststed, e.forretningsadresse_kommune,
             e.forretningsadresse_postnummer,
             e.antall_ansatte, e.har_registrert_antall_ansatte,
             e.konkurs, e.under_avvikling, e.under_tvangsavvikling,
             e.stiftelsesdato, e.registreringsdato_enhetsregisteret
             ${trengerRegnskap ? `, r.sum_driftsinntekter, r.aarsresultat, r.aar,
                r.driftsresultat, r.sum_egenkapital, r.sum_eiendeler` : ''}
             ${semantisk ? `, round((1 - (${semantiskLedd}))::numeric, 3) AS likhet, left(coalesce(e.aktivitet, e.vedtektsfestet_formaal), 160) AS utdrag` : ''}
      FROM enheter e ${join}
      WHERE ${where.join(' AND ')}
      ORDER BY ${sortering}
      -- One row past the page. A semantic search has no countable total, so
      -- this is how it knows whether a next page exists: ask for one more than
      -- fits, and the extra row is the answer.
      LIMIT ${bind(perPage + 1)} OFFSET ${bind((page - 1) * perPage)}`, params),

    semantisk
      ? Promise.resolve([{ n: 0 }])
      : query(`SELECT count(*)::int AS n FROM (
                 SELECT 1 FROM enheter e ${join} WHERE ${where.join(' AND ')} LIMIT ${TAK + 1}
               ) x`, params.slice(0, params.length - 2))
  ])

  // Trim the probe row back off before anything sees it.
  const merEnnSiden = rows.length > perPage
  if (merEnnSiden) rows.length = perPage

  const raatt = antall[0]?.n ?? 0
  const total = semantisk ? rows.length : Math.min(raatt, TAK)
  const flere = raatt > TAK

  return {
    treff: total,
    flere: semantisk ? merEnnSiden : flere,                                   // true when the real count exceeds the cap
    side: page,
    per: perPage,
    // Semantic ranking has no total to divide, so "how many pages" becomes
    // "is there another one" — the paginator gets the current page plus one
    // while more rows keep arriving.
    sider: semantisk
      ? (merEnnSiden ? page + 1 : page)
      : Math.max(1, Math.ceil(total / perPage)),
    medRegnskap: trengerRegnskap,
    semantisk,
    sorter: semantisk ? 'relevans' : sorterEtter,
    sorteringer: Object.entries(SORTERING).map(([k, v]) => ({ verdi: k, tittel: v.tittel })),
    foretak: rows
  }
})
