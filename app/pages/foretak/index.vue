<script setup lang="ts">
import { kort, belopKort } from "~/utils/tall"
const route = useRoute()
const router = useRouter()

const q       = ref(String(route.query.q ?? ''))
const gjor    = ref(String(route.query.gjor ?? ''))
const semantisk = ref(route.query.semantisk === 'true')
const kommune = ref(String(route.query.kommune ?? ''))
const ansatte = ref(String(route.query.ansatte ?? ''))
const aktive  = ref(route.query.aktive !== 'false')
const side    = ref(Number(route.query.side ?? 1))
const per     = ref(Number(route.query.per ?? 10))

// --- advanced filters ---
const sorter = ref(String(route.query.sorter ?? 'ansatte'))
const fylke        = ref(String(route.query.fylke ?? ''))
const ansatteMaks  = ref(String(route.query.ansatte_maks ?? ''))
const konkurs      = ref(route.query.konkurs === 'true')
const avvikling    = ref(route.query.avvikling === 'true')
const nye          = ref(route.query.nye === 'true')
const nace         = ref(String(route.query.nace ?? '').split(',').filter(Boolean))

/**
 * Accounts ranges. Entered in thousands, because that is how the accounts are
 * shown everywhere else in the app, and sent in kroner, because that is how
 * they are stored — converting in one place beats explaining the unit twice.
 */
const BELOP = [
  { navn: 'omsetning',      tittel: 'Driftsinntekter' },
  { navn: 'resultat',       tittel: 'Årsresultat' },
  { navn: 'driftsresultat', tittel: 'Driftsresultat' },
  { navn: 'egenkapital',    tittel: 'Egenkapital' },
  { navn: 'eiendeler',      tittel: 'Sum eiendeler' }
]
// string | number: <input type="number"> hands back a Number via v-model.
const belop = reactive<Record<string, string | number>>({})

/**
 * Read a range bound back OUT of the URL, which stores kroner.
 *
 * The fields are in thousands and `iKroner` multiplies by 1000 on the way into
 * the query string. Reading the same parameter straight back into the field
 * treated kroner as thousands, so every reload multiplied the bound by 1000:
 * type 1000, get ?resultat_min=1000000, reload, and the field now says
 * 1000000 — a filter a thousand times wider than the one you set, silently.
 * The unit has to be undone on the way in exactly as it is applied on the way
 * out.
 */
const fraKroner = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v).trim()
  if (s === '' || !Number.isFinite(Number(s))) return ''
  return String(Number(s) / 1000)
}

for (const b of BELOP) {
  belop[`${b.navn}_min`]  = fraKroner(route.query[`${b.navn}_min`])
  belop[`${b.navn}_maks`] = fraKroner(route.query[`${b.navn}_maks`])
}
/**
 * These fields are <input type="number">, and Vue casts a numeric v-model on
 * those to an actual Number — so `belop` holds numbers at runtime even though
 * it is declared Record<string, string>. The declared type is what hid this:
 * TypeScript saw a string and allowed .trim(), which then threw
 * "v.trim is not a function" from inside a computed, taking the whole render
 * with it. Everything that reads these values goes through somTekst().
 */
const somTekst = (v: unknown) => v === null || v === undefined ? '' : String(v)

const iKroner = (v: unknown) => {
  const s = somTekst(v).trim()
  return s === '' ? undefined : String(Math.round(Number(s) * 1000))
}

const params = computed(() => {
  const p: Record<string, unknown> = {
    q: q.value || undefined,
    gjor: gjor.value || undefined,
    semantisk: semantisk.value && gjor.value ? 'true' : undefined,
    kommune: kommune.value || undefined,
    fylke: fylke.value || undefined,
    ansatte: ansatte.value || undefined,
    ansatte_maks: ansatteMaks.value || undefined,
    nace: nace.value.length ? nace.value.join(',') : undefined,
    konkurs: konkurs.value ? 'true' : undefined,
    avvikling: avvikling.value ? 'true' : undefined,
    nye: nye.value ? 'true' : undefined,
    aktive: aktive.value ? 'true' : undefined,
    side: side.value > 1 ? side.value : undefined,
    per: per.value,
    sorter: sorter.value !== 'ansatte' ? sorter.value : undefined
  }
  for (const b of BELOP) {
    p[`${b.navn}_min`]  = iKroner(belop[`${b.navn}_min`]!)
    p[`${b.navn}_maks`] = iKroner(belop[`${b.navn}_maks`]!)
  }
  return p
})

/** How many advanced filters are on, for the badge on the toggle button. */
const antallFiltre = computed(() =>
  [fylke.value, kommune.value, ansatte.value, ansatteMaks.value].filter(Boolean).length
  + nace.value.length
  + [konkurs.value, avvikling.value, nye.value].filter(Boolean).length
  + BELOP.reduce((n, b) =>
      n + (somTekst(belop[`${b.navn}_min`]).trim() ? 1 : 0)
        + (somTekst(belop[`${b.navn}_maks`]).trim() ? 1 : 0), 0))

// Same request the tree makes; useFetch dedupes on the key, so the badges get
// the industry names without a second round trip.
const { data: naeringer } = await useFetch('/api/naeringskoder', { lazy: true })
const naeringsnavn = computed(() =>
  new Map(((naeringer.value?.noder ?? []) as any[]).map(n => [n.kode, n.navn])))

// Live counts for the description, so it cannot go stale as the data grows.
const { data: oversikt } = await useFetch('/api/oversikt', { lazy: true })

// Geography filters hold the number, so the badge has to look up the name —
// "Fylke: 0301" tells nobody anything.
const { data: geografi } = await useFetch('/api/geografi', { lazy: true })
const stedsnavn = computed(() => new Map([
  ...((geografi.value?.fylker ?? []) as any[]).map(f => [`f${f.nr}`, f.navn] as const),
  ...((geografi.value?.kommuner ?? []) as any[]).map(k => [`k${k.nr}`, k.navn] as const)
]))

/**
 * One badge per active filter, each able to remove just itself.
 *
 * Built from the same state the query is built from, so a badge can never
 * describe a filter that is not actually applied.
 */
const merkelapper = computed(() => {
  const ut: { nokkel: string; tekst: string; fjern: () => void }[] = []
  const tekstfelt: [string, any, string, ((v: string) => string)?][] = [
    ['q', q, 'Navn'], ['gjor', gjor, 'Driver med'],
    ['fylke', fylke, 'Fylke', v => stedsnavn.value.get(`f${v}`) ?? v],
    ['kommune', kommune, 'Kommune', v => stedsnavn.value.get(`k${v}`) ?? v],
    ['ansatte', ansatte, 'Ansatte fra'], ['ansatte_maks', ansatteMaks, 'Ansatte til']
  ]
  for (const [nokkel, felt, etikett, vis] of tekstfelt) {
    if (felt.value) ut.push({
      nokkel,
      tekst: `${etikett}: ${vis ? vis(felt.value) : felt.value}`,
      fjern: () => { felt.value = ''; sok() }
    })
  }
  const bokser: [string, any, string][] = [
    ['nye', nye, 'Nyetablerte'], ['konkurs', konkurs, 'Konkurs'], ['avvikling', avvikling, 'Under avvikling']
  ]
  for (const [nokkel, felt, etikett] of bokser) {
    if (felt.value) ut.push({ nokkel, tekst: etikett, fjern: () => { felt.value = false; sok() } })
  }
  for (const b of BELOP) {
    for (const ende of ['min', 'maks'] as const) {
      const v = belop[`${b.navn}_${ende}`]
      if (somTekst(v).trim()) ut.push({
        nokkel: `${b.navn}_${ende}`,
        // v is in thousands; belopKort() takes kroner, so convert at this one point.
        tekst: `${b.tittel} ${ende === 'min' ? 'fra' : 'til'} ${belopKort(Number(v) * 1000, true)}`,
        fjern: () => { belop[`${b.navn}_${ende}`] = ''; sok() }
      })
    }
  }
  for (const kode of nace.value) {
    ut.push({
      nokkel: `nace-${kode}`,
      tekst: `Næring: ${naeringsnavn.value.get(kode) ?? kode}`,
      fjern: () => { nace.value = nace.value.filter(k => k !== kode); sok() }
    })
  }
  return ut
})

/**
 * Saved searches, in localStorage.
 *
 * This app has no accounts, so "per user" is per browser — an honest
 * implementation of the feature rather than a fake user id. A saved search is
 * just the query string, so restoring one is a navigation and it survives
 * every future change to what the filters can express.
 */
const NOKKEL = 'foretak-lagrede-sok'
const lagrede = ref<{ navn: string; query: string }[]>([])

onMounted(() => {
  try { lagrede.value = JSON.parse(localStorage.getItem(NOKKEL) || '[]') } catch { lagrede.value = [] }
})
function skrivLagrede() {
  try { localStorage.setItem(NOKKEL, JSON.stringify(lagrede.value)) } catch { /* private mode */ }
}
function lagreSok() {
  const forslag = merkelapper.value.slice(0, 2).map(m => m.tekst).join(', ') || 'Alle foretak'
  const navn = window.prompt('Navn på søket', forslag)?.trim()
  if (!navn) return
  const query = new URLSearchParams(
    Object.entries(params.value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
  ).toString()
  lagrede.value = [{ navn, query }, ...lagrede.value.filter(l => l.navn !== navn)].slice(0, 20)
  skrivLagrede()
}
function slettLagret(navn: string) {
  lagrede.value = lagrede.value.filter(l => l.navn !== navn)
  skrivLagrede()
}

function nullstill() {
  q.value = ''; gjor.value = ''
  kommune.value = ''; fylke.value = ''; ansatte.value = ''; ansatteMaks.value = ''
  konkurs.value = false; avvikling.value = false; nye.value = false
  nace.value = []
  for (const k of Object.keys(belop)) belop[k] = ''
  sok()
}

// Ticking a status box makes "bare aktive" contradictory — a company cannot be
// both bankrupt and not bankrupt — so the switch is disabled while one is on.
const statusValgt = computed(() => konkurs.value || avvikling.value || nye.value)

// `lazy` so a search does not block navigation, and the page can show a spinner
// instead of freezing on the old results.
const { data, status } = await useFetch('/api/foretak/search', { query: params, lazy: true })
const laster = computed(() => status.value === 'pending')

/**
 * The exact number of matches, fetched separately.
 *
 * The search returns a count capped at 10 000 because an exact count(*) has to
 * touch every matching row — 955 ms unfiltered against about 20 ms capped, and
 * paying that on every search to serve a number nobody has read yet is the
 * wrong trade. So the results land immediately showing "10 000+", this request
 * follows, and the figure is replaced when it arrives.
 */
const { data: eksakt } = await useFetch('/api/foretak/antall', {
  query: params, lazy: true, server: false
})
const treffTekst = computed(() => {
  if (!data.value) return ''
  // Semantic search ranks by distance and has no fixed membership to count.
  if (data.value.semantisk) return `${data.value.treff.toLocaleString('nb-NO')} nærmeste`
  if (eksakt.value) return `${eksakt.value.antall.toLocaleString('nb-NO')} treff`
  return `${data.value.treff.toLocaleString('nb-NO')}${data.value.flere ? '+' : ''} treff`
})

function oppdaterUrl() { router.replace({ query: params.value }) }
function sok()          { side.value = 1; oppdaterUrl() }

/**
 * Read the whole filter state back OUT of the URL.
 *
 * Everything above flows one way — refs to `params` to `useFetch` — and
 * `oppdaterUrl` writes that state into the query string. Nothing read it back,
 * so following a link to /foretak?<other query> changed the address bar and
 * nothing else: the route is the same, Vue Router reuses the component, the
 * refs keep their old values and `params` never changes, so no refetch. That is
 * what made a saved search look like it did nothing.
 *
 * Also fixes the browser Back button, which had the same defect for the same
 * reason.
 */
function lesFraUrl() {
  const s = (n: string) => String(route.query[n] ?? '')
  q.value = s('q');  gjor.value = s('gjor');  semantisk.value = s('semantisk') === 'true'
  fylke.value = s('fylke');  kommune.value = s('kommune')
  ansatte.value = s('ansatte');  ansatteMaks.value = s('ansatte_maks')
  konkurs.value = s('konkurs') === 'true'
  avvikling.value = s('avvikling') === 'true'
  nye.value = s('nye') === 'true'
  aktive.value = s('aktive') !== 'false'
  nace.value = s('nace').split(',').filter(Boolean)
  sorter.value = s('sorter') || 'ansatte'
  side.value = Number(route.query.side ?? 1)
  per.value = Number(route.query.per ?? 10)
  for (const b of BELOP) {
    belop[`${b.navn}_min`]  = fraKroner(route.query[`${b.navn}_min`])
    belop[`${b.navn}_maks`] = fraKroner(route.query[`${b.navn}_maks`])
  }
}

/**
 * Compare two query objects by value, ignoring key order and empty entries.
 * Needed because `oppdaterUrl` writing the URL also fires the watcher below —
 * without this, every search would immediately re-read its own write, and any
 * value the URL rounds differently would oscillate.
 */
function somNokkel(o: Record<string, unknown>) {
  return new URLSearchParams(
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v)] as [string, string])
      .sort(([a], [b]) => a.localeCompare(b))
  ).toString()
}

watch(() => route.query, () => {
  // Our own write — the refs already hold this state.
  if (somNokkel(route.query as Record<string, unknown>) === somNokkel(params.value)) return
  lesFraUrl()
})
function gaaTil(n: number) {
  side.value = Math.min(Math.max(n, 1), data.value?.sider ?? 1)
  oppdaterUrl()
  if (import.meta.client) window.scrollTo({ top: 0, behavior: 'smooth' })
}

/** A window of page numbers around the current one, with the ends always shown. */
const sidetall = computed(() => {
  const n = data.value?.sider ?? 1, c = side.value
  if (n <= 9) return Array.from({ length: n }, (_, i) => i + 1)
  const ut = new Set([1, 2, n - 1, n])
  for (let i = c - 2; i <= c + 2; i++) if (i > 0 && i <= n) ut.add(i)
  const sortert = [...ut].sort((a, b) => a - b)
  const med: (number | '…')[] = []
  sortert.forEach((s, i) => {
    if (i && s - (sortert[i - 1] as number) > 1) med.push('…')
    med.push(s)
  })
  return med
})

const inaktiv = (f: any) => f.konkurs || f.under_avvikling || f.under_tvangsavvikling
const status_tekst = (f: any) =>
  f.konkurs ? 'Konkurs' : f.under_tvangsavvikling ? 'Tvangsavvikling' : f.under_avvikling ? 'Under avvikling' : ''

function tomtSok() {
  q.value = ''
  sok()
}
function tomtGjor() {
  gjor.value = ''
  sok()
}

const TRE_MND_MS = 92 * 24 * 60 * 60 * 1000

/**
 * The coloured dot in front of the name.
 *
 * Returns null for an ordinary active company, which is the common case: a dot
 * on every row would carry no information. Only the exceptions get a marker.
 *
 * Order matters — a company can be both newly registered and already bankrupt,
 * and bankruptcy is the more important fact.
 */
/**
 * Cap a label so one long value cannot break the two-column result row.
 *
 * Norwegian company names and NACE descriptions both run long — the register
 * holds names past 200 characters, and descriptions like "Produksjon av andre
 * ikke-metallholdige mineralprodukter ikke nevnt annet sted" are routine. Left
 * whole, one of them pushes the right-hand column off the row.
 *
 * Truncated on a word boundary rather than mid-word, and the full value stays
 * in the title attribute so nothing is actually lost.
 */
/**
 * "5014, BERGEN" — postcode, comma, one space, place.
 *
 * Built as a single string rather than two elements so the separator is fixed.
 * A company can have one without the other, and the filter drops the empty side
 * so a lone place never arrives with a leading comma.
 */
function sted(f: any): string {
  return [f.forretningsadresse_postnummer, f.forretningsadresse_kommune]
    .filter(Boolean).join(', ')
}

/**
 * The accounting figures to show on a result row, and which of them the search
 * was actually filtered on.
 *
 * Driftsinntekter and årsresultat always show — they are what "how big is this
 * company" means. Any other field you filtered on is added, because a row
 * matched on egenkapital while showing only revenue asks the reader to take the
 * match on trust. The filtered ones are marked so the answer to "why is this
 * here?" is visible on the row rather than inferred from the sidebar.
 */
const FELTKART: Record<string, { tittel: string; kolonne: string }> = {
  omsetning:      { tittel: 'driftsinntekter', kolonne: 'sum_driftsinntekter' },
  resultat:       { tittel: 'resultat',        kolonne: 'aarsresultat' },
  driftsresultat: { tittel: 'driftsresultat',  kolonne: 'driftsresultat' },
  egenkapital:    { tittel: 'egenkapital',     kolonne: 'sum_egenkapital' },
  eiendeler:      { tittel: 'eiendeler',       kolonne: 'sum_eiendeler' }
}

/** Which range filters are currently set — drives both the display and the mark. */
const filtrerteBelop = computed(() => new Set(
  BELOP.filter(b => somTekst(belop[`${b.navn}_min`]).trim()
                 || somTekst(belop[`${b.navn}_maks`]).trim())
       .map(b => b.navn)))

function belopsrad(f: any) {
  const aktive = filtrerteBelop.value
  const vis = ['omsetning', 'resultat', ...aktive].filter((n, i, a) => a.indexOf(n) === i)
  return vis
    .map(navn => {
      const k = FELTKART[navn]
      if (!k) return null
      const verdi = f[k.kolonne]
      if (verdi === null || verdi === undefined) return null
      return { navn, tittel: k.tittel, verdi: Number(verdi), aktiv: aktive.has(navn) }
    })
    .filter(Boolean) as { navn: string; tittel: string; verdi: number; aktiv: boolean }[]
}

function avkort(tekst: string | null, tak = 100): string {
  if (!tekst) return ''
  if (tekst.length <= tak) return tekst
  const kuttet = tekst.slice(0, tak)
  const mellomrom = kuttet.lastIndexOf(' ')
  return `${mellomrom > tak * 0.6 ? kuttet.slice(0, mellomrom) : kuttet}…`
}

function merke(f: any): { klasse: string, tittel: string } | null {
  if (f.konkurs) return { klasse: 'konkurs', tittel: 'Konkurs' }
  if (f.under_tvangsavvikling) return { klasse: 'konkurs', tittel: 'Under tvangsavvikling' }
  if (f.under_avvikling) return { klasse: 'inaktiv', tittel: 'Under avvikling' }

  const reg = f.registreringsdato_enhetsregisteret
  if (reg && Date.now() - new Date(reg).getTime() < TRE_MND_MS) {
    return {
      klasse: 'ny',
      tittel: `Nyetablert — registrert ${new Date(reg).toLocaleDateString('nb-NO')}`
    }
  }
  return null
}
</script>

<template>
  <div>
    <h1>Foretak</h1>
    <p class="lede">
      Søk i {{ kort(oversikt?.tall.foretak) }} norske foretak fra
      Enhetsregisteret. Skriv et navn eller lim inn et organisasjonsnummer —
      eller søk i sidefeltet på <strong>hva foretaket driver med</strong>, i
      {{ kort(oversikt?.tall.beskrivelser) }} beskrivelser foretakene har
      skrevet om seg selv. Slår du på «forstå meningen»,
      sammenlignes spørsmålet og beskrivelsene som mening i stedet for som ord,
      så «folk som passer hunder» også finner et hundepensjonat som aldri skrev
      noen av de ordene.
    </p>

    <div class="sokefelt">
      <!-- A real <label for>, not a styled span: clicking it focuses the field,
           and a screen reader announces the field by name instead of reading
           out the placeholder, which disappears the moment you type. -->
      <label class="sokefelt-etikett" for="foretak-sok">Søk</label>
      <span class="sokeboks">
        <input id="foretak-sok" v-model="q" type="text" placeholder="Foretaksnavn eller organisasjonsnummer…" @keydown.enter="sok">
        <button v-if="q" class="tom" type="button" title="Tøm søket" aria-label="Tøm søket" @click="tomtSok">×</button>
      </span>
      <button @click="sok">Søk</button>
    </div>

    <!-- One badge per active filter. Each removes only itself, which is the
         quickest way to walk back from a search that returned nothing. -->
    <div v-if="merkelapper.length" class="merkelapper">
      <span v-for="m in merkelapper" :key="m.nokkel" class="merkelapp">
        {{ m.tekst }}
        <button type="button" :aria-label="`Fjern ${m.tekst}`" @click="m.fjern()">×</button>
      </span>
      <button class="lenkeknapp" @click="nullstill">Fjern alle</button>
    </div>

    <div class="soke-layout">
      <aside class="filter-sidebar">
        <fieldset>
          <legend>Hva de driver med</legend>
          <span class="sokeboks">
            <input v-model="gjor" type="text" :placeholder="semantisk
              ? 'f.eks. «folk som passer hunder»'
              : 'f.eks. «hundepensjonat»'" @keydown.enter="sok">
            <button v-if="gjor" class="tom" type="button" title="Tøm" aria-label="Tøm" @click="tomtGjor">×</button>
          </span>
          <label class="modusvalg">
            <input type="checkbox" v-model="semantisk" @change="sok">
            Forstå meningen
            <span class="hjelp" title="Av: finner foretak som skrev nøyaktig de ordene. På: spørsmålet og beskrivelsene sammenlignes som mening, så «folk som passer hunder» finner et hundepensjonat som aldri skrev noen av ordene.">?</span>
          </label>
          <p class="muted hint">Søker i 940 807 egenskrevne beskrivelser.</p>
        </fieldset>

        <fieldset>
          <legend>Status</legend>
          <label><input type="checkbox" v-model="nye" @change="sok"> Nyetablerte (90 dager)</label>
          <label><input type="checkbox" v-model="konkurs" @change="sok"> Konkurs</label>
          <label><input type="checkbox" v-model="avvikling" @change="sok"> Under avvikling</label>
          <label :class="{ avslaatt: statusValgt }">
            <input type="checkbox" v-model="aktive" :disabled="statusValgt" @change="sok"> Bare aktive
          </label>
          <p class="muted hint">Flere avkryssinger betyr «eller», ikke «og».</p>
        </fieldset>

        <fieldset>
          <legend>Geografi</legend>
          <div class="omraade">
            <span class="omraade-navn">Fylke</span>
            <GeoVelger type="fylke" v-model="fylke" @update:model-value="sok" />
          </div>
          <div class="omraade">
            <span class="omraade-navn">Kommune</span>
            <GeoVelger type="kommune" v-model="kommune" :fylke-filter="fylke" @update:model-value="sok" />
          </div>
        </fieldset>

        <fieldset>
          <legend>Størrelse og regnskap</legend>
          <div class="omraade">
            <span class="omraade-navn">Ansatte</span>
            <input v-model="ansatte" type="number" placeholder="fra" @keydown.enter="sok">
            <span class="strek">–</span>
            <input v-model="ansatteMaks" type="number" placeholder="til" @keydown.enter="sok">
          </div>
          <div v-for="b in BELOP" :key="b.navn" class="omraade">
            <span class="omraade-navn">{{ b.tittel }}</span>
            <input v-model="belop[`${b.navn}_min`]" type="number" placeholder="fra" @keydown.enter="sok">
            <span class="strek">–</span>
            <input v-model="belop[`${b.navn}_maks`]" type="number" placeholder="til" @keydown.enter="sok">
          </div>
          <!-- The unit is the trap here: "1000000" in a field measured in
               thousands is a billion kroner, not a million. The example makes
               the scale concrete, and the chip above echoes the amount back in
               kroner so a wrong one is visible before you read the results. -->
          <p class="muted hint">
            Beløp i <strong>tusen</strong> kroner — 1 000 = 1m kr, 1 000 000 = 1b kr.
            Fra siste innsendte regnskap.
          </p>
        </fieldset>

        <fieldset>
          <legend>Næring<span v-if="nace.length" class="filterteller">{{ nace.length }}</span></legend>
          <NaeringsTre v-model="nace" />
        </fieldset>

        <div class="sidebar-knapper">
          <button @click="sok">Bruk filtre</button>
          <button class="ghost" :disabled="!antallFiltre" @click="nullstill">Nullstill</button>
        </div>

        <fieldset>
          <legend>Lagrede søk</legend>
          <button class="ghost full" @click="lagreSok">Lagre dette søket</button>
          <ul v-if="lagrede.length" class="lagret-liste">
            <li v-for="l in lagrede" :key="l.navn">
              <NuxtLink :to="`/foretak?${l.query}`">{{ l.navn }}</NuxtLink>
              <button type="button" :aria-label="`Slett ${l.navn}`" @click="slettLagret(l.navn)">×</button>
            </li>
          </ul>
          <p class="muted hint">Lagres i denne nettleseren — appen har ingen innlogging.</p>
        </fieldset>
      </aside>

      <div class="soke-resultat">
        <div class="row" style="gap:16px; align-items:center; margin-bottom:8px">
          <label class="muted">
            Sorter
            <select v-model="sorter" @change="sok" class="velger" :disabled="semantisk">
              <option v-for="o in data?.sorteringer ?? []" :key="o.verdi" :value="o.verdi">{{ o.tittel }}</option>
            </select>
          </label>
          <span v-if="semantisk" class="muted">— sortert etter likhet</span>
          <label class="muted">
            Per side
            <select v-model.number="per" @change="sok" class="velger">
              <option :value="10">10</option><option :value="25">25</option>
              <option :value="50">50</option><option :value="100">100</option>
            </select>
          </label>
          <span v-if="data && !laster" class="muted" style="margin-left:auto">{{ treffTekst }}</span>
        </div>

        <!-- Old results are cleared while a new search runs, so what is on screen is
             never a stale answer to a question that has already changed. -->
        <div v-if="laster" class="laster">
          <span class="spinner" /> Søker…
        </div>

        <template v-else-if="data">
          <div v-if="!data.foretak.length" class="card muted">
            <template v-if="data.semantisk">
              Ingen beskrivelser ligger nær nok spørsmålet. Meningssøket er best
              på hele setninger — «dykking og undervannsarbeid» treffer der
              «undervannssveising» alene ikke gjør det. Prøv å beskrive
              virksomheten, eller slå av «forstå meningen» og søk på ordet
              direkte.
            </template>
            <template v-else>Ingen treff. Fjern et filter over, eller prøv et kortere navn.</template>
          </div>

          <NuxtLink
            v-for="f in data.foretak" :key="f.organisasjonsnummer"
            :to="`/foretak/${f.organisasjonsnummer}`"
            class="treffrad" :class="{ inaktiv: inaktiv(f) }">
            <!-- Line 1: name left, where-and-what-kind right.
                 Line 2: the identifiers. Two aligned columns rather than one
                 run-on line, so the eye can scan down either side. -->
            <span class="treffrad-topp">
              <span class="treffrad-navn">
                <i v-if="merke(f)" class="merke" :class="merke(f)!.klasse" :title="merke(f)!.tittel" />
                {{ avkort(f.navn) }}
                <!-- One badge per row: a company cannot be both newly founded
                     and closed in a way worth showing twice, and bankruptcy is
                     the more important fact — the same precedence merke() uses. -->
                <span v-if="inaktiv(f)" class="pill bad">{{ status_tekst(f) }}</span>
                <span v-else-if="merke(f)?.klasse === 'ny'" class="pill ok">Nyetablert</span>
              </span>
              <span class="treffrad-sted">
                <span class="pill nokkel">{{ f.organisasjonsform_kode }}</span>
                <!-- One expression, so the separator is exactly ", " and cannot
                     be collapsed or widened by layout. Two adjacent elements
                     could not guarantee a single space: whitespace between tags
                     collapses, and a flex gap is not a space character. -->
                <span class="treffrad-adresse">{{ sted(f) }}</span>
              </span>
            </span>
            <span class="treffrad-meta">
              <code>{{ f.organisasjonsnummer }}</code>
              <template v-if="f.har_registrert_antall_ansatte"> · {{ f.antall_ansatte }} ansatte</template>
              <template v-if="f.naeringskode1_beskrivelse"> · {{ avkort(f.naeringskode1_beskrivelse) }}</template>
            </span>
            <span v-if="data.semantisk && f.utdrag" class="treffrad-utdrag">
              <span class="likhet">{{ Number(f.likhet).toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</span>
              {{ f.utdrag }}
            </span>
            <span v-if="data.medRegnskap && f.sum_driftsinntekter != null" class="treffrad-tall">
              <template v-for="(t, i) in belopsrad(f)" :key="t.navn">
                <span v-if="i" class="skille"> · </span>
                <!-- .traff marks the field this row was filtered on, so "why is
                     this in my results?" is answered on the row itself. -->
                <span :class="{ traff: t.aktiv }">
                  <span :class="{ neg: t.verdi < 0 }">{{ belopKort(t.verdi) }}</span>
                  i {{ t.tittel }}
                </span>
              </template>
              <span class="muted">({{ f.aar }})</span>
            </span>
          </NuxtLink>

          <nav v-if="data.sider > 1" class="paginator midtstilt">
            <button class="ghost" :disabled="side <= 1" @click="gaaTil(side - 1)">‹</button>
            <template v-for="(s, i) in sidetall" :key="i">
              <span v-if="s === '…'" class="paginator-hopp">…</span>
              <button v-else class="paginator-tall" :class="{ aktiv: s === side }" @click="gaaTil(s as number)">{{ s }}</button>
            </template>
            <button class="ghost" :disabled="side >= data.sider" @click="gaaTil(side + 1)">›</button>
            <span class="muted" v-if="data.flere" style="margin-left:8px">av mange</span>
          </nav>
        </template>
      </div>
    </div>
  </div>
</template>
