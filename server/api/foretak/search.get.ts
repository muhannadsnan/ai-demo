import { query } from '../../utils/db'
import { requireAiProvider } from '../../utils/ai/provider'

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

/** Accounts fields the range filters may touch, and the column each maps to. */
const BELOPSFELT: Record<string, string> = {
  omsetning:    'r.sum_driftsinntekter',
  driftsresultat: 'r.driftsresultat',
  resultat:     'r.aarsresultat',
  egenkapital:  'r.sum_egenkapital',
  eiendeler:    'r.sum_eiendeler',
  gjeld:        'r.sum_gjeld'
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)

  const where: string[] = ['e.slettet_dato IS NULL']
  const params: unknown[] = []
  const bind = (v: unknown) => `$${params.push(v)}`

  const text = String(q.q ?? '').trim()
  if (text) {
    // A 9-digit string is an organisation number, not a name. Recognising that
    // saves a trigram scan and gives an exact hit when someone pastes an orgnr.
    if (/^\d{9}$/.test(text)) {
      where.push(`e.organisasjonsnummer = ${bind(text)}`)
    } else {
      where.push(`e.navn ILIKE ${bind('%' + text + '%')}`)
    }
  }

  /**
   * Free-text search over what the company says it does.
   *
   * `q` matches the NAME. This matches the prose the company wrote about
   * itself — `aktivitet` and `vedtektsfestet_formaal`, indexed by migration 027.
   * It is a different question: "who is called Nordvik" versus "who does
   * underwater welding", and only the second one can find a company whose name
   * gives nothing away.
   *
   * `websearch_to_tsquery` accepts what people already type into search boxes —
   * quoted phrases, OR, and leading minus to exclude — instead of the operator
   * syntax `to_tsquery` demands, which errors out on a stray space.
   */
  const gjor = String(q.gjor ?? '').trim()
  const semantisk = q.semantisk === 'true' && gjor.length > 0

  /**
   * Two ways to ask the same question.
   *
   * Keyword (default) matches the words that were written. Semantic embeds the
   * question with the same model the descriptions were embedded with and ranks
   * by distance in that space, so "folk som fikser tenner på hunder" can find a
   * veterinary dental clinic that never wrote any of those words.
   *
   * Semantic ranking replaces the usual sort — the whole point is that the
   * closest match comes first — and a cutoff keeps it from returning the least
   * bad of a million companies when nothing is actually close.
   */
  let semantiskLedd = ''
  if (semantisk) {
    // 'search_query: ' must match the 'search_document: ' the descriptions were
    // embedded with — see server-drift/ingest/embed-foretak.mjs. nomic-embed-text
    // is trained with these task prefixes and separates matches from noise about
    // three times as well with them as without.
    const [vektor] = await requireAiProvider().embed([`search_query: ${gjor}`])
    if (!vektor) throw createError({ statusCode: 503, statusMessage: 'Kunne ikke tolke søket' })
    const v = bind(`[${vektor.join(',')}]`)
    semantiskLedd = `em.embedding <=> ${v}::halfvec(768)`
    // 0.62 measured: genuine matches sit below it, unrelated companies above.
    where.push(`${semantiskLedd} < 0.62`)
  } else if (gjor) {
    where.push(`e.fritekst @@ websearch_to_tsquery('norwegian', ${bind(gjor)})`)
  }

  /**
   * Municipality accepts either the number or the name, because nobody
   * remembers that Bergen is 4601.
   *
   * A complete four-digit number is matched with `=`, not `LIKE 'nnnn%'`.
   * Under the en_US.utf8 collation this database was created with, Postgres
   * cannot prove a LIKE prefix maps to a btree range, so it will not use the
   * index: a sparse municipality took 253 ms on a parallel sequential scan of
   * 1.17 million rows. Dense ones hid it, because the sort index finds ten
   * matches immediately when there are 57,000 of them.
   *
   * A shorter numeric prefix keeps LIKE — it is the rare input, and the county
   * field is the better way to ask that question anyway.
   */
  const kommune = String(q.kommune ?? '').trim()
  if (kommune) {
    where.push(
      /^\d{4}$/.test(kommune) ? `e.forretningsadresse_kommunenummer = ${bind(kommune)}`
      : /^\d+$/.test(kommune) ? `e.forretningsadresse_kommunenummer LIKE ${bind(kommune + '%')}`
      : `e.forretningsadresse_kommunenummer IN (
           SELECT kommunenummer FROM kommuner WHERE navn ILIKE ${bind('%' + kommune + '%')})`)
  }
  const fylke = String(q.fylke ?? '').trim()
  if (fylke) {
    where.push(/^\d+$/.test(fylke)
      ? `left(e.forretningsadresse_kommunenummer, 2) = ${bind(fylke.padStart(2, '0'))}`
      : `e.forretningsadresse_kommunenummer IN (
           SELECT k.kommunenummer FROM kommuner k JOIN fylker f USING (fylkesnummer)
           WHERE f.navn ILIKE ${bind('%' + fylke + '%')})`)
  }

  /**
   * Industry. Codes arrive at any level of the NACE tree — "A", "41", "41.2",
   * "41.201" — and companies always carry a level-5 code, so each selected node
   * is expanded to its leaves and matched exactly. A recursive walk handles
   * level 1 too, whose codes are letters and cannot be prefix-matched against
   * the numeric ones beneath them.
   */
  const nace = String(q.nace ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (nace.length) {
    where.push(`e.naeringskode1_kode IN (
      WITH RECURSIVE valgt AS (
        SELECT kode, niva FROM naeringskoder WHERE kode = ANY(${bind(nace)}::text[])
        UNION ALL
        SELECT n.kode, n.niva FROM naeringskoder n JOIN valgt v ON n.parent_kode = v.kode
      )
      SELECT DISTINCT kode FROM valgt WHERE niva = 5)`)
  }

  if (q.orgform) where.push(`e.organisasjonsform_kode = ${bind(String(q.orgform))}`)
  if (q.ansatte) where.push(`e.antall_ansatte >= ${bind(Number(q.ansatte))}`)
  if (q.ansatte_maks) where.push(`e.antall_ansatte <= ${bind(Number(q.ansatte_maks))}`)

  /**
   * Status checkboxes. Each ticked box adds an alternative rather than another
   * restriction — ticking "konkurs" and "nyetablerte" means either, not both,
   * which no company could ever satisfy. With nothing ticked the "bare aktive"
   * switch applies on its own.
   */
  const status: string[] = []
  if (q.konkurs === 'true')     status.push('e.konkurs')
  if (q.avvikling === 'true')   status.push('(e.under_avvikling OR e.under_tvangsavvikling)')
  if (q.nye === 'true')         status.push(`e.registreringsdato_enhetsregisteret >= current_date - 90`)
  if (status.length) {
    where.push(`(${status.join(' OR ')})`)
  } else if (q.aktive === 'true') {
    where.push('NOT e.konkurs AND NOT e.under_avvikling AND NOT e.under_tvangsavvikling')
  }

  /**
   * Accounts ranges join `regnskap_siste` (migration 026) — one indexed row per
   * company holding its newest annual accounts. Filtering against `regnskap`
   * itself would mean finding the latest of 4.96 million rows per company on
   * every keystroke.
   *
   * `rimelig` excludes the filings reported in the wrong unit, so a search for
   * "revenue over a billion" does not return a corner shop that filed in kroner.
   */
  const belopsledd: string[] = []
  for (const [navn, kolonne] of Object.entries(BELOPSFELT)) {
    const min = q[`${navn}_min`], maks = q[`${navn}_maks`]
    if (min !== undefined && min !== '') belopsledd.push(`${kolonne} >= ${bind(Number(min))}`)
    if (maks !== undefined && maks !== '') belopsledd.push(`${kolonne} <= ${bind(Number(maks))}`)
  }
  const sorterEtter = String(q.sorter ?? 'ansatte')
  const valgtSort = SORTERING[sorterEtter] ?? SORTERING.ansatte!

  // An accounts sort needs the accounts view joined even when no range filter
  // asked for it, and only over rows whose figures are trustworthy.
  const trengerRegnskap = belopsledd.length > 0 || !!valgtSort.regnskap
  if (belopsledd.length) where.push('r.rimelig', ...belopsledd)
  else if (valgtSort.regnskap) where.push('r.rimelig')

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
  const TAK = 10000
  const [rows, antall] = await Promise.all([
    query(`
      SELECT e.organisasjonsnummer, e.navn,
             e.organisasjonsform_kode, e.organisasjonsform_beskrivelse,
             e.naeringskode1_kode, e.naeringskode1_beskrivelse,
             e.forretningsadresse_poststed, e.forretningsadresse_kommune,
             e.antall_ansatte, e.har_registrert_antall_ansatte,
             e.konkurs, e.under_avvikling, e.under_tvangsavvikling,
             e.stiftelsesdato, e.registreringsdato_enhetsregisteret
             ${trengerRegnskap ? ', r.sum_driftsinntekter, r.aarsresultat, r.aar' : ''}
             ${semantisk ? `, round((1 - (${semantiskLedd}))::numeric, 3) AS likhet, left(coalesce(e.aktivitet, e.vedtektsfestet_formaal), 160) AS utdrag` : ''}
      FROM enheter e ${join}
      WHERE ${where.join(' AND ')}
      ORDER BY ${sortering}
      LIMIT ${bind(perPage)} OFFSET ${bind((page - 1) * perPage)}`, params),

    query(`SELECT count(*)::int AS n FROM (
             SELECT 1 FROM enheter e ${join} WHERE ${where.join(' AND ')} LIMIT ${TAK + 1}
           ) x`, params.slice(0, params.length - 2))
  ])

  const raatt = antall[0]?.n ?? 0
  const total = Math.min(raatt, TAK)
  const flere = raatt > TAK

  return {
    treff: total,
    flere,                                   // true when the real count exceeds the cap
    side: page,
    per: perPage,
    sider: Math.max(1, Math.ceil(total / perPage)),
    medRegnskap: trengerRegnskap,
    semantisk,
    sorter: semantisk ? 'relevans' : sorterEtter,
    sorteringer: Object.entries(SORTERING).map(([k, v]) => ({ verdi: k, tittel: v.tittel })),
    foretak: rows
  }
})
