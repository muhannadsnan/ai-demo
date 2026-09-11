import { requireAiProvider } from '../../utils/ai/provider'
import { query } from '../../utils/db'
import { kompiler, vokabular, specSkjema, SpecFeil, type Spec } from '../../utils/ai/sporring-spec'
import { enforceRateLimit, validateQuery } from '../../utils/guardrails'

/**
 * Ask a question in Norwegian, get companies back.
 *
 *   "AS-selskaper i Bergen med over 50 ansatte"
 *   "de største byggefirmaene i Rogaland etter omsetning"
 *
 * The model's only job is to turn the sentence into a filter spec. It never
 * sees the database, never writes SQL, and cannot name a field that is not in
 * the vocabulary — an unknown field is a rejected spec, not a query.
 *
 * The response includes the filters that were applied, so the user can see what
 * the question was understood to mean. A natural-language interface that
 * silently answers a different question than the one asked is worse than no
 * interface, and showing the interpretation is what makes it debuggable.
 */

const SYSTEMPROMPT = `Du oversetter norske spørsmål om foretak til et JSON-filter.

Svar KUN med JSON på denne formen, uten forklaring og uten kodeblokk:
{"filtre":[{"felt":"...","op":"...","verdi":...}],"sorter":"...","retning":"desc","grense":25}

Tilgjengelige felt:
${vokabular()}

Sorteringsfelt: navn, ansatte, driftsinntekter, aarsresultat, aksjekapital, stiftet

Regler:
- Bruk kun feltene og operatorene over. Finn ikke på nye.
- "største", "mest", "høyest" er IKKE operatorer. De styrer sortering:
  sorter på ansatte eller driftsinntekter med retning "desc".
- "minst", "over", "mer enn", "fra" -> op "minst"
- "høyst", "under", "mindre enn", "før" -> op "hoyst"
- "før 1950" betyr {"felt":"stiftet_aar","op":"hoyst","verdi":1949}
- "etter 2010" betyr {"felt":"stiftet_aar","op":"minst","verdi":2011}
- "aktive" betyr konkurs=false og under_avvikling=false.
- Beløp oppgis i hele kroner: "10 millioner" blir 10000000.
- Er noe uklart, utelat filteret heller enn å gjette.
- Legg ALDRI til filtre som ikke står i spørsmålet. Nevnes ikke sted, skal det
  ikke være stedsfilter. Nevnes ikke tall, skal det ikke være tallfilter.
- Færre filtre er bedre enn feil filtre.

Eksempel på retning:
Spørsmål: selskaper stiftet før 1950 med over 200 ansatte
Svar: {"filtre":[{"felt":"stiftet_aar","op":"hoyst","verdi":1949},{"felt":"ansatte","op":"minst","verdi":200}],"sorter":"ansatte","retning":"desc","grense":25}

Eksempel på sortering:
Spørsmål: de største byggefirmaene i Rogaland etter omsetning
Svar: {"filtre":[{"felt":"naering","op":"inneholder","verdi":"bygg"},{"felt":"fylke","op":"er","verdi":"Rogaland"}],"sorter":"driftsinntekter","retning":"desc","grense":25}

Eksempel:
Spørsmål: aktive AS i Bergen med minst 50 ansatte
Svar: {"filtre":[{"felt":"organisasjonsform","op":"er","verdi":"AS"},{"felt":"kommune","op":"er","verdi":"Bergen"},{"felt":"ansatte","op":"minst","verdi":50},{"felt":"konkurs","op":"er","verdi":false},{"felt":"under_avvikling","op":"er","verdi":false}],"sorter":"ansatte","retning":"desc","grense":25}`

/** Models like to wrap JSON in prose or a code fence. Take the outermost object. */
function hentJson(tekst: string): Spec {
  const a = tekst.indexOf('{')
  const b = tekst.lastIndexOf('}')
  if (a < 0 || b <= a) throw new SpecFeil('modellen svarte ikke med JSON')
  return JSON.parse(tekst.slice(a, b + 1))
}

export default defineEventHandler(async (event) => {
  enforceRateLimit(event, 'sporring')
  const body = await readBody<{ sporsmal?: unknown; modell?: unknown }>(event)
  const sporsmal = validateQuery(body?.sporsmal, 'sporsmal')
  // Optional per-request model, so the same endpoint can be compared across
  // models. Restricted to a known list — a model name reaches the provider's
  // HTTP call, so it is not a free-text field.
  // Allow-list, not free text: the model name reaches an HTTP call, so it is
  // not something a request gets to choose freely.
  const TILLATTE = ['gpt-4o-mini', 'gpt-4o']
  const modell = TILLATTE.includes(String(body?.modell)) ? String(body?.modell) : undefined

  const provider = requireAiProvider()
  const start = Date.now()

  let raat = ''
  for await (const bit of provider.streamChat(
    [{ role: 'system', content: SYSTEMPROMPT }, { role: 'user', content: sporsmal }],
    { temperature: 0, maxTokens: 400, jsonSchema: specSkjema(), model: modell }
  )) raat += bit
  const modellMs = Date.now() - start

  let spec: Spec
  try {
    spec = hentJson(raat)
  } catch (err) {
    throw createError({
      statusCode: 422,
      statusMessage: `Klarte ikke å tolke spørsmålet. Modellen svarte: ${raat.slice(0, 200)}`
    })
  }

  // One repair attempt.
  //
  // The validator's complaint is specific — "the operator 'største' does not
  // apply to navn" — and a model given that sentence usually fixes itself. This
  // is not the model checking its own work; the deterministic validator decides,
  // and simply tells it what was wrong. If the second attempt also fails, the
  // request is rejected: nothing reaches the database either way.
  let kompilert
  let reparert = false
  try {
    kompilert = kompiler(spec)
  } catch (err) {
    if (!(err instanceof SpecFeil)) throw err

    let andre = ''
    for await (const bit of provider.streamChat([
      { role: 'system', content: SYSTEMPROMPT },
      { role: 'user', content: sporsmal },
      { role: 'assistant', content: JSON.stringify(spec) },
      { role: 'user', content: `Dette filteret ble avvist: ${err.message}. Svar med korrigert JSON.` }
    ], { temperature: 0, maxTokens: 400, jsonSchema: specSkjema(), model: modell })) andre += bit

    try {
      kompilert = kompiler(hentJson(andre))
      reparert = true
    } catch (err2) {
      throw createError({
        statusCode: 422,
        statusMessage: `Klarte ikke å tolke spørsmålet: ${(err2 as Error).message}`
      })
    }
  }

  const dbStart = Date.now()
  const rader = await query(kompilert.sql, kompilert.params)
  const dbMs = Date.now() - dbStart

  return {
    sporsmal,
    tolkning: kompilert.brukt,
    treff: rader.length ? Number(rader[0].totalt) : 0,
    foretak: rader.map(({ totalt, ...r }) => r),
    reparert,
    tid: { modell_ms: modellMs, database_ms: dbMs },
    modell: modell ?? provider.chatModel
  }
})
