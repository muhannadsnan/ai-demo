<script setup lang="ts">
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
const belop = reactive<Record<string, string>>({})
for (const b of BELOP) {
  belop[`${b.navn}_min`]  = String(route.query[`${b.navn}_min`]  ?? '')
  belop[`${b.navn}_maks`] = String(route.query[`${b.navn}_maks`] ?? '')
}
const iKroner = (v: string) => v.trim() === '' ? undefined : String(Math.round(Number(v) * 1000))

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
      n + (belop[`${b.navn}_min`]?.trim() ? 1 : 0) + (belop[`${b.navn}_maks`]?.trim() ? 1 : 0), 0))

// Same request the tree makes; useFetch dedupes on the key, so the badges get
// the industry names without a second round trip.
const { data: naeringer } = await useFetch('/api/naeringskoder', { lazy: true })
const naeringsnavn = computed(() =>
  new Map(((naeringer.value?.noder ?? []) as any[]).map(n => [n.kode, n.navn])))

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
      if (v?.trim()) ut.push({
        nokkel: `${b.navn}_${ende}`,
        tekst: `${b.tittel} ${ende === 'min' ? 'fra' : 'til'} ${Number(v).toLocaleString('nb-NO')}k`,
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
      Søk i 1 173 078 norske foretak fra Enhetsregisteret. Skriv et navn eller
      lim inn et organisasjonsnummer — eller søk i sidefeltet på
      <strong>hva foretaket driver med</strong>, i 940 807 beskrivelser
      foretakene har skrevet om seg selv. Slår du på «forstå meningen»,
      sammenlignes spørsmålet og beskrivelsene som mening i stedet for som ord,
      så «folk som passer hunder» også finner et hundepensjonat som aldri skrev
      noen av de ordene.
    </p>

    <div class="sokefelt">
      <span class="sokeboks">
        <input v-model="q" type="text" placeholder="Foretaksnavn eller organisasjonsnummer…" @keydown.enter="sok">
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
          <p class="muted hint">Beløp i tusen kroner, fra siste innsendte regnskap.</p>
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
            Ingen treff. Fjern et filter over, eller prøv et kortere navn.
          </div>

          <NuxtLink
            v-for="f in data.foretak" :key="f.organisasjonsnummer"
            :to="`/foretak/${f.organisasjonsnummer}`"
            class="treffrad" :class="{ inaktiv: inaktiv(f) }">
            <span class="treffrad-navn">
              <i v-if="merke(f)" class="merke" :class="merke(f)!.klasse" :title="merke(f)!.tittel" />
              {{ f.navn }}
              <span v-if="inaktiv(f)" class="pill bad">{{ status_tekst(f) }}</span>
            </span>
            <span class="treffrad-meta">
              <code>{{ f.organisasjonsnummer }}</code>
              · {{ f.organisasjonsform_kode }}
              <template v-if="f.forretningsadresse_poststed"> · {{ f.forretningsadresse_poststed }}</template>
              <template v-if="f.har_registrert_antall_ansatte"> · {{ f.antall_ansatte }} ansatte</template>
              <template v-if="f.naeringskode1_beskrivelse"> · {{ f.naeringskode1_beskrivelse }}</template>
            </span>
            <span v-if="data.semantisk && f.utdrag" class="treffrad-utdrag">
              <span class="likhet">{{ Number(f.likhet).toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</span>
              {{ f.utdrag }}
            </span>
            <span v-if="data.medRegnskap && f.sum_driftsinntekter != null" class="treffrad-tall">
              {{ Math.round(Number(f.sum_driftsinntekter) / 1000).toLocaleString('nb-NO') }} i driftsinntekter
              <template v-if="f.aarsresultat != null">
                · <span :class="{ neg: Number(f.aarsresultat) < 0 }">{{ Math.round(Number(f.aarsresultat) / 1000).toLocaleString('nb-NO') }}</span> i resultat
              </template>
              <span class="muted">({{ f.aar }}, tusen kr)</span>
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
