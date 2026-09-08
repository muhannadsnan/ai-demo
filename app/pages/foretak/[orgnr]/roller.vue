<script setup lang="ts">
const route = useRoute()
const orgnr = route.params.orgnr as string
const { data: hode } = await useFetch(`/api/foretak/${orgnr}`)
const { data } = await useFetch(`/api/foretak/${orgnr}/roller`)

const navn = (r: any) => r.innehaver_orgnr
  ? r.innehaver_navn
  : [r.person_fornavn, r.person_mellomnavn, r.person_etternavn].filter(Boolean).join(' ')

const grupper = computed(() => {
  const m = new Map<string, any[]>()
  for (const r of data.value?.naavaerende ?? []) {
    const k = r.rollegruppe_beskrivelse || r.rollegruppe_kode
    m.set(k, [...(m.get(k) ?? []), r])
  }
  return [...m.entries()]
})
</script>

<template>
  <div v-if="hode">
    <ForetakHeader :foretak="hode.foretak" :antall="hode.antall" />

    <div v-if="!data?.naavaerende?.length" class="card muted">Ingen roller registrert.</div>

    <template v-for="[gruppe, roller] in grupper" :key="gruppe">
      <h2>{{ gruppe }}</h2>
      <div class="card">
        <div v-for="(r, i) in roller" :key="i" class="rolle">
          <span class="rolle-type">{{ r.rolletype_beskrivelse || r.rolletype_kode }}</span>
          <span class="rolle-navn">
            <NuxtLink v-if="r.innehaver_orgnr" :to="`/foretak/${r.innehaver_orgnr}`">{{ navn(r) }}</NuxtLink>
            <template v-else>{{ navn(r) }}</template>
          </span>
          <span class="muted" v-if="r.person_fodselsdato">f. {{ r.person_fodselsdato.slice(0, 4) }}</span>
        </div>
      </div>
    </template>

    <template v-if="data?.tidligere?.length">
      <h2>Tidligere roller</h2>
      <div class="card">
        <p class="muted" style="margin-top:0">
          Roller som ikke lenger finnes i registeret. Datoene viser når rollen ble
          først og sist observert i et datauttrekk, ikke når vervet faktisk startet og sluttet.
        </p>
        <div v-for="(r, i) in data.tidligere" :key="i" class="rolle">
          <span class="rolle-type">{{ r.rolletype_beskrivelse || r.rolletype_kode }}</span>
          <span class="rolle-navn">{{ navn(r) }}</span>
          <span class="muted">{{ r.forst_sett }} – {{ r.sist_sett }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
