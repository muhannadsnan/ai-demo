<script setup lang="ts">
const route = useRoute()
const router = useRouter()

const q       = ref(String(route.query.q ?? ''))
const kommune = ref(String(route.query.kommune ?? ''))
const ansatte = ref(String(route.query.ansatte ?? ''))
const aktive  = ref(route.query.aktive !== 'false')
const side    = ref(Number(route.query.side ?? 1))

const params = computed(() => ({
  q: q.value || undefined,
  kommune: kommune.value || undefined,
  ansatte: ansatte.value || undefined,
  aktive: aktive.value ? 'true' : undefined,
  side: side.value > 1 ? side.value : undefined,
  per: 25
}))

const { data, pending } = await useFetch('/api/foretak/search', { query: params })

function sok() {
  side.value = 1
  router.replace({ query: { ...params.value, per: undefined } })
}
function bytt(n: number) {
  side.value = n
  router.replace({ query: { ...params.value, per: undefined } })
}
</script>

<template>
  <div>
    <h1>Foretak</h1>
    <p class="lede">
      Søk i {{ (1173013).toLocaleString('nb-NO') }} norske foretak fra Enhetsregisteret.
      Skriv et navn eller lim inn et organisasjonsnummer.
    </p>

    <div class="sokefelt">
      <input v-model="q" type="text" placeholder="Foretaksnavn eller organisasjonsnummer…" @keydown.enter="sok">
      <input v-model="kommune" type="text" placeholder="Kommunenr" style="max-width:130px" @keydown.enter="sok">
      <input v-model="ansatte" type="text" placeholder="Min. ansatte" style="max-width:140px" @keydown.enter="sok">
      <button @click="sok">Søk</button>
    </div>
    <label class="muted" style="display:block; margin:8px 0 0">
      <input type="checkbox" v-model="aktive" @change="sok"> Bare aktive foretak
    </label>

    <p v-if="data" class="muted" style="margin-top:18px">
      {{ data.treff.toLocaleString('nb-NO') }} treff<span v-if="data.sider > 1"> · side {{ data.side }} av {{ data.sider.toLocaleString('nb-NO') }}</span>
    </p>

    <div v-if="pending" class="muted">Søker…</div>

    <div v-for="f in data?.foretak ?? []" :key="f.organisasjonsnummer" class="treff">
      <NuxtLink :to="`/foretak/${f.organisasjonsnummer}`" class="treff-navn">{{ f.navn }}</NuxtLink>
      <span v-if="f.konkurs" class="pill bad">Konkurs</span>
      <span v-else-if="f.under_avvikling" class="pill warn">Under avvikling</span>
      <div class="treff-meta">
        <code>{{ f.organisasjonsnummer }}</code>
        · {{ f.organisasjonsform_kode }}
        <template v-if="f.forretningsadresse_poststed"> · {{ f.forretningsadresse_poststed }}</template>
        <template v-if="f.har_registrert_antall_ansatte"> · {{ f.antall_ansatte }} ansatte</template>
        <template v-if="f.naeringskode1_beskrivelse"> · {{ f.naeringskode1_beskrivelse }}</template>
      </div>
    </div>

    <div v-if="data && data.sider > 1" class="row" style="margin-top:20px">
      <button class="ghost" :disabled="data.side <= 1" @click="bytt(data.side - 1)">Forrige</button>
      <button class="ghost" :disabled="data.side >= data.sider" @click="bytt(data.side + 1)">Neste</button>
    </div>
  </div>
</template>
