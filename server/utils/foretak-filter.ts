import { requireAiProvider } from './ai/provider'

/**
 * Build the WHERE clauses for a company search from the query string.
 *
 * Extracted so that the results endpoint and the exact-count endpoint cannot
 * drift apart. A count that applies different filters than the list it counts
 * is worse than no count at all, and two copies of forty lines of clause
 * building drift the first time one of them is edited.
 *
 * Every value goes through `bind` into a parameter. The SQL text is fixed and
 * only the clauses are assembled, which is what makes injection structurally
 * impossible rather than merely filtered.
 */

/** Accounts fields the range filters may touch, and the column each maps to. */
export const BELOPSFELT: Record<string, string> = {
  omsetning:      'r.sum_driftsinntekter',
  driftsresultat: 'r.driftsresultat',
  resultat:       'r.aarsresultat',
  egenkapital:    'r.sum_egenkapital',
  eiendeler:      'r.sum_eiendeler',
  gjeld:          'r.sum_gjeld'
}

export interface Filter {
  where: string[]
  params: unknown[]
  trengerRegnskap: boolean
  semantisk: boolean
  semantiskLedd: string
}

export async function byggFilter(q: Record<string, any>, medSemantikk = true): Promise<Filter> {
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
  const semantisk = medSemantikk && q.semantisk === 'true' && gjor.length > 0

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
    const leverandor = requireAiProvider()

    // Task prefixes are a nomic-embed-text feature: it is trained with
    // 'search_query: ' on the question and 'search_document: ' on what is
    // indexed, and separates matches from noise about three times as well with
    // them. text-embedding-3-small has no such convention, so a prefix there
    // would embed the literal words "search query" into every question.
    // The condition MUST match the one in server-drift/ingest/embed-foretak.mjs
    // — if one side prefixes and the other does not, questions land in a
    // different part of the space than the descriptions and the ranking is
    // quietly wrong rather than broken.
    const prefiks = leverandor.id === 'ollama' ? 'search_query: ' : ''
    const [vektor] = await leverandor.embed([`${prefiks}${gjor}`])
    if (!vektor) throw createError({ statusCode: 503, statusMessage: 'Kunne ikke tolke søket' })

    const v = bind(`[${vektor.join(',')}]`)
    // Dimension taken from the vector itself rather than written as a literal.
    // It was hardcoded to 768 for nomic, so switching the embedder made every
    // semantic search fail with a bare 503 from pgvector — the cast said 768
    // while the model returned 1536. Derived, it cannot drift again.
    semantiskLedd = `em.embedding <=> ${v}::halfvec(${vektor.length})`
    where.push(`${semantiskLedd} < ${leverandor.distanseTak}`)
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

  if (belopsledd.length) where.push('r.rimelig', ...belopsledd)

  return { where, params, trengerRegnskap: belopsledd.length > 0, semantisk, semantiskLedd }
}
