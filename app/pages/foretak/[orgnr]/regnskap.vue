<script setup lang="ts">
const route = useRoute()
const orgnr = route.params.orgnr as string
const { data: hode } = await useFetch(`/api/foretak/${orgnr}`)
const { data } = await useFetch(`/api/foretak/${orgnr}/regnskap`)

const t = (v: any) => v == null ? '—' : Math.round(Number(v) / 1000).toLocaleString('nb-NO')

// A simple bar chart of revenue, oldest to newest. No charting library: the
// data is a handful of numbers and a div with a width is enough.
const graf = computed(() => {
  const rader = [...(data.value?.aar ?? [])].reverse().filter(r => r.sum_driftsinntekter != null)
  const max = Math.max(...rader.map(r => Math.abs(Number(r.sum_driftsinntekter))), 1)
  return rader.map(r => ({
    aar: r.periode_til.slice(0, 4),
    verdi: Number(r.sum_driftsinntekter),
    andel: Math.max(1, Math.abs(Number(r.sum_driftsinntekter)) / max * 100)
  }))
})
const valuta = computed(() => data.value?.aar?.[0]?.valuta ?? 'NOK')
const harHistorikk = computed(() => (data.value?.aar ?? []).some(r => r.kilde === 'historikk'))
</script>

<template>
  <div v-if="hode">
    <ForetakHeader :foretak="hode.foretak" :antall="hode.antall" />

    <div v-if="!data?.antall" class="card muted">Ingen regnskapstall registrert for dette foretaket.</div>

    <template v-else>
      <h2>Driftsinntekter</h2>
      <div class="card">
        <div v-for="g in graf" :key="g.aar" class="stolpe-rad">
          <span class="stolpe-aar">{{ g.aar }}</span>
          <span class="stolpe-spor"><i :style="{ width: g.andel + '%' }" :class="{ neg: g.verdi < 0 }" /></span>
          <span class="stolpe-verdi">{{ t(g.verdi) }}</span>
        </div>
        <p class="muted" style="margin:12px 0 0">Alle tall i tusen {{ valuta }}.</p>
      </div>

      <h2>Resultat og balanse</h2>
      <div class="tablewrap">
        <table class="regnskap">
          <thead>
            <tr>
              <th>Tall i tusen {{ valuta }}</th>
              <th v-for="r in data.aar" :key="r.periode_til">{{ r.periode_til.slice(0, 4) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Driftsinntekter</td><td v-for="r in data.aar" :key="r.periode_til">{{ t(r.sum_driftsinntekter) }}</td></tr>
            <tr><td>Driftskostnader</td><td v-for="r in data.aar" :key="r.periode_til">{{ t(r.sum_driftskostnad) }}</td></tr>
            <tr class="sum"><td>Driftsresultat</td><td v-for="r in data.aar" :key="r.periode_til" :class="{ neg: Number(r.driftsresultat) < 0 }">{{ t(r.driftsresultat) }}</td></tr>
            <tr><td>Finansinntekter</td><td v-for="r in data.aar" :key="r.periode_til">{{ t(r.sum_finansinntekter) }}</td></tr>
            <tr><td>Finanskostnader</td><td v-for="r in data.aar" :key="r.periode_til">{{ t(r.sum_finanskostnad) }}</td></tr>
            <tr class="sum"><td>Årsresultat</td><td v-for="r in data.aar" :key="r.periode_til" :class="{ neg: Number(r.aarsresultat) < 0 }">{{ t(r.aarsresultat) }}</td></tr>
            <tr class="skille"><td>Anleggsmidler</td><td v-for="r in data.aar" :key="r.periode_til">{{ t(r.sum_anleggsmidler) }}</td></tr>
            <tr><td>Omløpsmidler</td><td v-for="r in data.aar" :key="r.periode_til">{{ t(r.sum_omloepsmidler) }}</td></tr>
            <tr class="sum"><td>Sum eiendeler</td><td v-for="r in data.aar" :key="r.periode_til">{{ t(r.sum_eiendeler) }}</td></tr>
            <tr><td>Egenkapital</td><td v-for="r in data.aar" :key="r.periode_til" :class="{ neg: Number(r.sum_egenkapital) < 0 }">{{ t(r.sum_egenkapital) }}</td></tr>
            <tr><td>Gjeld</td><td v-for="r in data.aar" :key="r.periode_til">{{ t(r.sum_gjeld) }}</td></tr>
            <tr class="kilde"><td>Kilde</td><td v-for="r in data.aar" :key="r.periode_til">{{ r.kilde === 'brreg-api' ? 'API' : 'hist.' }}</td></tr>
          </tbody>
        </table>
      </div>

      <p class="muted" style="margin-top:12px">
        Alle beløp er avrundet til nærmeste tusen.
        <template v-if="harHistorikk">
          Rader merket <em>hist.</em> er hentet fra en tidligere innsamling og er avrundet ved kilden;
          rader merket <em>API</em> kommer fra Brønnøysundregistrenes API.
        </template>
      </p>
    </template>
  </div>
</template>
