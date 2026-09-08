/**
 * Turning a question into a query, safely.
 *
 * The model does NOT write SQL. It emits a JSON filter spec against a fixed
 * vocabulary, and this file compiles that into a parameterised query.
 *
 * Three reasons, in the order they actually bite:
 *
 * 1. CORRECTNESS. A syntactically valid query can be silently wrong — a bad
 *    join against `roller` duplicates rows and doubles a revenue figure, and
 *    nobody can see it in the output. A spec has a small, testable surface.
 * 2. PERMISSIONS. The day this has users, the tenant predicate is added here,
 *    once. Free-form SQL has nowhere to put it.
 * 3. SAFETY. Every value is a bound parameter and every field name is checked
 *    against this table. Injection is impossible by construction rather than
 *    filtered. And a model cannot invent `DROP TABLE` because it is not writing
 *    statements at all.
 *
 * A second model checking the first model's SQL would not do this job: a
 * security boundary has to be deterministic.
 */

export interface Filter { felt: string; op: string; verdi: unknown }
export interface Spec {
  filtre?: Filter[]
  sorter?: string
  retning?: 'asc' | 'desc'
  grense?: number
}

type FeltDef = { kolonne: string; type: 'tekst' | 'tall' | 'bool' | 'dato'; ops: string[]; hjelp: string }

/** The entire vocabulary the model is allowed to use. Nothing else compiles. */
export const FELT: Record<string, FeltDef> = {
  navn:        { kolonne: 'e.navn',                             type: 'tekst', ops: ['inneholder'],                 hjelp: 'foretaksnavn' },
  fylke:       { kolonne: 'f.navn',                             type: 'tekst', ops: ['er', 'inneholder'],           hjelp: 'fylkesnavn, f.eks. Vestland' },
  kommune:     { kolonne: 'k.navn',                             type: 'tekst', ops: ['er', 'inneholder'],           hjelp: 'kommunenavn, f.eks. Bergen' },
  poststed:    { kolonne: 'e.forretningsadresse_poststed',      type: 'tekst', ops: ['er', 'inneholder'],           hjelp: 'poststed' },
  naering:     { kolonne: 'n.navn',                             type: 'tekst', ops: ['inneholder'],                 hjelp: 'næringsbeskrivelse, f.eks. bygg' },
  naeringskode:{ kolonne: 'e.naeringskode1_kode',               type: 'tekst', ops: ['starter_med', 'er'],          hjelp: 'NACE-kode, f.eks. 43' },
  organisasjonsform: { kolonne: 'e.organisasjonsform_kode',     type: 'tekst', ops: ['er'],                         hjelp: 'AS, ASA, ENK, DA …' },
  ansatte:     { kolonne: 'e.antall_ansatte',                   type: 'tall',  ops: ['er','minst','hoyst','mellom'],hjelp: 'antall ansatte' },
  stiftet_aar: { kolonne: 'extract(year from e.stiftelsesdato)',type: 'tall',  ops: ['er','minst','hoyst','mellom'],hjelp: 'stiftelsesår' },
  konkurs:     { kolonne: 'e.konkurs',                          type: 'bool',  ops: ['er'],                         hjelp: 'true/false' },
  under_avvikling: { kolonne: 'e.under_avvikling',              type: 'bool',  ops: ['er'],                         hjelp: 'true/false' },
  aksjekapital:{ kolonne: 'e.kapital_belop',                    type: 'tall',  ops: ['minst','hoyst','mellom'],     hjelp: 'aksjekapital i kroner' },
  driftsinntekter: { kolonne: 'r.sum_driftsinntekter',          type: 'tall',  ops: ['minst','hoyst','mellom'],     hjelp: 'siste års driftsinntekter i kroner' },
  aarsresultat:{ kolonne: 'r.aarsresultat',                     type: 'tall',  ops: ['minst','hoyst','mellom'],     hjelp: 'siste års resultat i kroner' }
}

export const SORTERBAR: Record<string, string> = {
  navn: 'e.navn',
  ansatte: 'e.antall_ansatte',
  driftsinntekter: 'r.sum_driftsinntekter',
  aarsresultat: 'r.aarsresultat',
  aksjekapital: 'e.kapital_belop',
  stiftet: 'e.stiftelsesdato'
}

export class SpecFeil extends Error {}

/** Compile a spec into SQL text plus bound parameters. Throws on anything unknown. */
export function kompiler(spec: Spec) {
  const where: string[] = ['e.slettet_dato IS NULL']
  const params: unknown[] = []
  const bind = (v: unknown) => `$${params.push(v)}`

  for (const f of spec.filtre ?? []) {
    const def = FELT[f.felt]
    if (!def) throw new SpecFeil(`ukjent felt: ${f.felt}`)
    if (!def.ops.includes(f.op)) throw new SpecFeil(`operatoren "${f.op}" gjelder ikke for ${f.felt}`)

    const c = def.kolonne
    switch (f.op) {
      case 'er':
        if (def.type === 'tekst') {
          // Several municipalities and counties carry a Sami or Kven name after
          // a dash — "Oslo - Oslove", "Trøndelag - Trööndelage". An exact match
          // on "Oslo" then finds nothing, which reads as "there are no
          // bankruptcies in Oslo" rather than as a matching bug. Match the whole
          // name or the part before the dash.
          const v = String(f.verdi)
          where.push(`(${c} ILIKE ${bind(v)} OR ${c} ILIKE ${bind(v + ' - %')})`)
        } else {
          where.push(`${c} = ${bind(cast(def, f.verdi))}`)
        }
        break
      case 'inneholder':   where.push(`${c} ILIKE ${bind('%' + String(f.verdi) + '%')}`); break
      case 'starter_med':  where.push(`${c} LIKE ${bind(String(f.verdi) + '%')}`); break
      case 'minst':        where.push(`${c} >= ${bind(cast(def, f.verdi))}`); break
      case 'hoyst':        where.push(`${c} <= ${bind(cast(def, f.verdi))}`); break
      case 'mellom': {
        const [a, b] = Array.isArray(f.verdi) ? f.verdi : [null, null]
        if (a == null || b == null) throw new SpecFeil('"mellom" krever to verdier')
        where.push(`${c} BETWEEN ${bind(cast(def, a))} AND ${bind(cast(def, b))}`)
        break
      }
      default: throw new SpecFeil(`ukjent operator: ${f.op}`)
    }
  }

  const sorter  = SORTERBAR[spec.sorter ?? ''] ?? 'e.antall_ansatte'
  const retning = spec.retning === 'asc' ? 'ASC' : 'DESC'
  const grense  = Math.min(Math.max(Number(spec.grense) || 25, 1), 200)

  // The accounts join takes the newest period per company, so "highest revenue"
  // does not multiply a company by its 27 years of history.
  const sql = `
    SELECT e.organisasjonsnummer, e.navn, e.organisasjonsform_kode,
           e.antall_ansatte, e.har_registrert_antall_ansatte,
           e.forretningsadresse_poststed, k.navn AS kommune, f.navn AS fylke,
           e.naeringskode1_kode, n.navn AS naering,
           e.konkurs, e.under_avvikling, e.kapital_belop,
           r.sum_driftsinntekter, r.aarsresultat, r.periode_til AS regnskapsaar,
           count(*) OVER () AS totalt
    FROM enheter e
    LEFT JOIN kommuner k ON k.kommunenummer = e.forretningsadresse_kommunenummer
    LEFT JOIN fylker   f ON f.fylkesnummer  = k.fylkesnummer
    LEFT JOIN naeringskoder n ON n.kode     = e.naeringskode1_kode
    LEFT JOIN LATERAL (
      SELECT sum_driftsinntekter, aarsresultat, periode_til
      FROM regnskap WHERE organisasjonsnummer = e.organisasjonsnummer
      ORDER BY periode_til DESC LIMIT 1
    ) r ON true
    WHERE ${where.join(' AND ')}
    ORDER BY ${sorter} ${retning} NULLS LAST
    LIMIT ${grense}`

  return { sql, params, brukt: { filtre: spec.filtre ?? [], sorter: spec.sorter ?? 'ansatte', retning, grense } }
}

function cast(def: FeltDef, v: unknown) {
  if (def.type === 'tall') {
    const n = Number(v)
    if (!Number.isFinite(n)) throw new SpecFeil(`"${v}" er ikke et tall`)
    return n
  }
  if (def.type === 'bool') return v === true || v === 'true'
  return String(v)
}

/**
 * A JSON Schema for the spec, generated from the same FELT table the compiler
 * validates against — so the shape the model is constrained to produce and the
 * shape the compiler accepts cannot drift apart.
 *
 * With this, "største" as an operator is not merely discouraged: the token
 * cannot be sampled, because it is not in the enum.
 */
export function specSkjema() {
  return {
    type: 'object',
    properties: {
      filtre: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            felt: { type: 'string', enum: Object.keys(FELT) },
            op:   { type: 'string', enum: [...new Set(Object.values(FELT).flatMap(d => d.ops))] },
            // `verdi: {}` — anything goes — is an invitation. Left open, the
            // model filled it with MongoDB operators: {"$gt": 100}. A value here
            // is a scalar, or a pair for "mellom"; say so.
            verdi: {
              anyOf: [
                { type: 'string' },
                { type: 'number' },
                { type: 'boolean' },
                { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }
              ]
            }
          },
          required: ['felt', 'op', 'verdi']
        }
      },
      sorter:  { type: 'string', enum: Object.keys(SORTERBAR) },
      retning: { type: 'string', enum: ['asc', 'desc'] },
      grense:  { type: 'integer' }
    },
    required: ['filtre']
  }
}

/** The field list, rendered for the prompt. Generated, so it cannot drift. */
export function vokabular() {
  return Object.entries(FELT)
    .map(([navn, d]) => `- ${navn} (${d.type}) operatorer: ${d.ops.join(', ')} — ${d.hjelp}`)
    .join('\n')
}
