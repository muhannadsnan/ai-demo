<script setup lang="ts">
const route = useRoute()
const orgnr = route.params.orgnr as string
const { data: hode } = await useFetch(`/api/foretak/${orgnr}`)
const { data } = await useFetch(`/api/foretak/${orgnr}/eierskap`)
const pst = (v: any) => v == null ? '—' : Number(v).toLocaleString('nb-NO', { maximumFractionDigits: 2 }) + ' %'
</script>

<template>
  <div v-if="hode">
    <ForetakHeader :foretak="hode.foretak" :antall="hode.antall" />

    <div v-if="!data?.eiere?.length" class="card muted">Ingen aksjonærinformasjon registrert.</div>

    <template v-else>
      <h2>Aksjonærer</h2>

      <div v-if="data.oppsummering.personer_skjult" class="note-personvern">
        <strong>{{ data.oppsummering.antall_personeiere }} av {{ data.oppsummering.antall_eiere }} aksjonærer er privatpersoner, og navnene vises ikke.</strong>
        Aksjonærregisteret inneholder personopplysninger, og utleverte data er
        underlagt personopplysningsloven. Eierandelene vises i sin helhet;
        identiteten til privatpersoner gjør det ikke. Foretak som eier aksjer
        vises med navn og organisasjonsnummer — et organisasjonsnummer er ikke
        en personopplysning.
      </div>

      <p v-if="data.oppsummering.avkortet" class="muted">
        Viser de {{ data.oppsummering.vist }} største eierpostene av
        {{ data.oppsummering.antall_eiere.toLocaleString('nb-NO') }}.
      </p>

      <div class="card">
        <table class="meta">
          <tbody>
            <tr v-for="(e, i) in data.eiere" :key="i">
              <td>
                <template v-if="e.er_person"><span class="anonym">Privatperson</span></template>
                <NuxtLink v-else-if="e.eier_orgnr" :to="`/foretak/${e.eier_orgnr}`">
                  {{ e.eier_foretaksnavn || e.eier_navn }}
                </NuxtLink>
                <template v-else>{{ e.eier_navn || 'Ukjent' }}</template>
                <span class="muted" v-if="e.aksjeklasse && e.aksjeklasse !== 'Ordinære aksjer'"> · {{ e.aksjeklasse }}</span>
              </td>
              <td style="text-align:right; width:34%">
                <strong>{{ pst(e.andel_prosent) }}</strong>
                <span class="muted"> · {{ Number(e.antall_aksjer).toLocaleString('nb-NO') }} aksjer</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <template v-if="data.eierandeler.length">
        <h2>Eierandeler i andre foretak</h2>
        <div class="card">
          <table class="meta">
            <tbody>
              <tr v-for="(e, i) in data.eierandeler" :key="i">
                <td><NuxtLink :to="`/foretak/${e.organisasjonsnummer}`">{{ e.navn || e.organisasjonsnummer }}</NuxtLink></td>
                <td style="text-align:right; width:30%"><strong>{{ pst(e.andel_prosent) }}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </div>
</template>
