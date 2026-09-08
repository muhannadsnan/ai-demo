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

  const rows = await query(`
    SELECT e.organisasjonsnummer, e.navn,
           e.organisasjonsform_kode, e.organisasjonsform_beskrivelse,
           e.naeringskode1_kode, e.naeringskode1_beskrivelse,
           e.forretningsadresse_poststed, e.forretningsadresse_kommune,
           e.antall_ansatte, e.har_registrert_antall_ansatte,
           e.konkurs, e.under_avvikling, e.under_tvangsavvikling,
           e.stiftelsesdato,
           count(*) OVER () AS total_treff
    FROM enheter e
    WHERE ${where.join(' AND ')}
    ORDER BY e.antall_ansatte DESC NULLS LAST, e.navn
    LIMIT ${bind(perPage)} OFFSET ${bind((page - 1) * perPage)}`, params)

  const total = rows.length ? Number(rows[0].total_treff) : 0
  return {
    treff: total,
    side: page,
    sider: Math.ceil(total / perPage),
    foretak: rows.map(({ total_treff, ...r }) => r)
  }
})
