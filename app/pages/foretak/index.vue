<script setup lang="ts">
const route = useRoute()
const router = useRouter()

const q       = ref(String(route.query.q ?? ''))
const gjor    = ref(String(route.query.gjor ?? ''))
const kommune = ref(String(route.query.kommune ?? ''))
const ansatte = ref(String(route.query.ansatte ?? ''))
const aktive  = ref(route.query.aktive !== 'false')
const side    = ref(Number(route.query.side ?? 1))
const per     = ref(Number(route.query.per ?? 10))

// --- advanced filters ---
// Open on load when the URL already carries one, so a shared or bookmarked
// search shows why it returned what it did instead of looking arbitrary.
const AVANSERTE = ['fylke', 'kommune', 'nace', 'konkurs', 'avvikling', 'nye', 'ansatte', 'ansatte_maks']
const visFiltre = ref(Object.keys(route.query).some(
  k => AVANSERTE.includes(k) || k.endsWith('_min') || k.endsWith('_maks')))
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
    per: per.value
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

function nullstill() {
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
      Søk i 1 173 013 norske foretak fra Enhetsregisteret.
      Skriv et navn eller lim inn et organisasjonsnummer.
    </p>

    <div class="sokefelt">
      <span class="sokeboks">
        <input v-model="q" type="text" placeholder="Foretaksnavn eller organisasjonsnummer…" @keydown.enter="sok">
        <button v-if="q" class="tom" type="button" title="Tøm søket" aria-label="Tøm søket" @click="tomtSok">×</button>
      </span>
      <button @click="sok">Søk</button>
    </div>

    <!-- A different question from the one above: not what the company is
         called, but what it wrote that it does. 940 807 foretak have a real
         description, and it finds businesses whose name gives nothing away. -->
    <div class="sokefelt" style="margin-top:8px">
      <span class="sokeboks">
        <input v-model="gjor" type="text" placeholder="…eller hva foretaket driver med: «undervannssveising», «kunstig intelligens»" @keydown.enter="sok">
        <button v-if="gjor" class="tom" type="button" title="Tøm" aria-label="Tøm" @click="tomtGjor">×</button>
      </span>
    </div>

    <div class="row" style="margin-top:10px; gap:18px; align-items:center">
      <button class="ghost" @click="visFiltre = !visFiltre">
        {{ visFiltre ? 'Skjul filtre' : 'Flere filtre' }}
        <span v-if="antallFiltre" class="filterteller">{{ antallFiltre }}</span>
      </button>
      <label class="muted" :class="{ avslaatt: statusValgt }">
        <input type="checkbox" v-model="aktive" :disabled="statusValgt" @change="sok"> Bare aktive foretak
      </label>
      <label class="muted">
        Per side
        <select v-model.number="per" @change="sok" class="velger">
          <option :value="10">10</option><option :value="25">25</option>
          <option :value="50">50</option><option :value="100">100</option>
        </select>
      </label>
      <span v-if="data && !laster" class="muted" style="margin-left:auto">
        {{ data.treff.toLocaleString('nb-NO') }}{{ data.flere ? '+' : '' }} treff
      </span>
    </div>

    <div v-if="visFiltre" class="filterpanel">
      <div class="filtergrid">
        <fieldset>
          <legend>Status</legend>
          <label><input type="checkbox" v-model="nye" @change="sok"> Nyetablerte (siste 90 dager)</label>
          <label><input type="checkbox" v-model="konkurs" @change="sok"> Konkurs</label>
          <label><input type="checkbox" v-model="avvikling" @change="sok"> Under avvikling</label>
          <p class="muted hint">Flere avkryssinger betyr «eller», ikke «og».</p>
        </fieldset>

        <fieldset>
          <legend>Geografi</legend>
          <label class="feltrad">Fylke
            <input v-model="fylke" type="text" placeholder="navn eller nr" @keydown.enter="sok"></label>
          <label class="feltrad">Kommune
            <input v-model="kommune" type="text" placeholder="navn eller nr" @keydown.enter="sok"></label>
          <p class="muted hint">Både «Oslo» og «0301» virker.</p>
        </fieldset>

        <fieldset>
          <legend>Ansatte</legend>
          <div class="omraade">
            <input v-model="ansatte" type="number" placeholder="fra" @keydown.enter="sok">
            <span>–</span>
            <input v-model="ansatteMaks" type="number" placeholder="til" @keydown.enter="sok">
          </div>
        </fieldset>

        <fieldset class="bred">
          <legend>Regnskap — siste år, i tusen kroner</legend>
          <div v-for="b in BELOP" :key="b.navn" class="omraade merket">
            <span class="omraade-navn">{{ b.tittel }}</span>
            <input v-model="belop[`${b.navn}_min`]" type="number" placeholder="fra" @keydown.enter="sok">
            <span>–</span>
            <input v-model="belop[`${b.navn}_maks`]" type="number" placeholder="til" @keydown.enter="sok">
          </div>
          <p class="muted hint">
            Fra siste innsendte regnskap. Filinger med åpenbart feil målestokk er utelatt.
          </p>
        </fieldset>

        <fieldset class="bred">
          <legend>Næring<span v-if="nace.length" class="filterteller">{{ nace.length }}</span></legend>
          <NaeringsTre v-model="nace" />
        </fieldset>
      </div>

      <div class="row" style="justify-content:flex-end; gap:8px; margin-top:12px">
        <button class="ghost" :disabled="!antallFiltre" @click="nullstill">Nullstill filtre</button>
        <button @click="sok">Bruk filtre</button>
      </div>
    </div>

    <!-- Old results are cleared while a new search runs, so what is on screen is
         never a stale answer to a question that has already changed. -->
    <div v-if="laster" class="laster">
      <span class="spinner" /> Søker…
    </div>

    <template v-else-if="data">
      <div v-if="!data.foretak.length" class="card muted" style="margin-top:18px">
        Ingen treff. Prøv et kortere navn, eller slå av «bare aktive».
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
</template>
