import { query } from '../../utils/db'

/**
 * Company search.
 *
 *   /api/foretak/search?q=nordvik&kommune=4601&nace=49&ansatte=50&side=1
 *
 * Every filter is optional and every value is bound as a parameter — the SQL
 * text is fixed, only the WHERE clauses are assembled. That is what makes
 * injection impossible here rather than merely unlikely.
 */
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
  if (q.kommune) where.push(`e.forretningsadresse_kommunenummer = ${bind(String(q.kommune))}`)
  if (q.fylke)   where.push(`left(e.forretningsadresse_kommunenummer, 2) = ${bind(String(q.fylke))}`)
  // NACE is hierarchical: "49" should match 49.100, 49.410 and so on.
  if (q.nace)    where.push(`e.naeringskode1_kode LIKE ${bind(String(q.nace) + '%')}`)
  if (q.orgform) where.push(`e.organisasjonsform_kode = ${bind(String(q.orgform))}`)
  if (q.ansatte) where.push(`e.antall_ansatte >= ${bind(Number(q.ansatte))}`)
  if (q.aktive === 'true') where.push('NOT e.konkurs AND NOT e.under_avvikling AND NOT e.under_tvangsavvikling')

  const perPage = Math.min(Math.max(Number(q.per) || 25, 1), 100)
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
      FROM enheter e
      WHERE ${where.join(' AND ')}
      ORDER BY e.antall_ansatte DESC NULLS LAST, e.navn
      LIMIT ${bind(perPage)} OFFSET ${bind((page - 1) * perPage)}`, params),

    query(`SELECT count(*)::int AS n FROM (
             SELECT 1 FROM enheter e WHERE ${where.join(' AND ')} LIMIT ${TAK + 1}
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
    foretak: rows
  }
})
