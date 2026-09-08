<script setup lang="ts">
const route = useRoute()
const router = useRouter()

const q       = ref(String(route.query.q ?? ''))
const kommune = ref(String(route.query.kommune ?? ''))
const ansatte = ref(String(route.query.ansatte ?? ''))
const aktive  = ref(route.query.aktive !== 'false')
const side    = ref(Number(route.query.side ?? 1))
const per     = ref(Number(route.query.per ?? 10))

const params = computed(() => ({
  q: q.value || undefined,
  kommune: kommune.value || undefined,
  ansatte: ansatte.value || undefined,
  aktive: aktive.value ? 'true' : undefined,
  side: side.value > 1 ? side.value : undefined,
  per: per.value
}))

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
      <input v-model="kommune" type="text" placeholder="Kommunenr" style="max-width:120px" @keydown.enter="sok">
      <input v-model="ansatte" type="text" placeholder="Min. ansatte" style="max-width:130px" @keydown.enter="sok">
      <button @click="sok">Søk</button>
    </div>

    <div class="row" style="margin-top:10px; gap:18px; align-items:center">
      <label class="muted"><input type="checkbox" v-model="aktive" @change="sok"> Bare aktive foretak</label>
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
