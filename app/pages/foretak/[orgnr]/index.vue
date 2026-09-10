<script setup lang="ts">
import { nb } from "~/utils/tall"
const route = useRoute()
const { data, error } = await useFetch(`/api/foretak/${route.params.orgnr}`)

/**
 * Subsidiaries load in a second request, after the page is on screen.
 *
 * `immediate: false` keeps them out of the server render, so the profile is not
 * held back by a query that most companies do not need — the ownership rollup
 * is the slowest thing on this page. `onMounted` then fires it in the browser
 * and the box shows a spinner until it lands.
 */
const { data: datter, status: datterStatus, execute: hentDatter } = await useFetch(
  `/api/foretak/${route.params.orgnr}/datterselskap`,
  { lazy: true, immediate: false, watch: false }
)
const datterLaster = computed(() => datterStatus.value !== 'success')

onMounted(() => {
  // execute() runs this one request. refreshNuxtData() would refetch every
  // useFetch on the page, which is a lot of work to load one list.
  if (Number(data.value?.antall?.datterselskap) > 0) hentDatter()
})
const nok = (v: any) => v == null ? '—' : (Number(v) / nb(1000), 0)
const dato = (v: any) => v ? new Date(v + 'T00:00:00').toLocaleDateString('nb-NO') : '—'
</script>

<template>
  <div v-if="error" class="error-box">Fant ikke foretaket.</div>
  <div v-else-if="data">
    <ForetakHeader :foretak="data.foretak" :antall="data.antall" />

    <div class="kort-rad">
      <div class="kort" v-if="data.sisteRegnskap">
        <span class="kort-etikett">Driftsinntekter {{ data.sisteRegnskap.periode_til.slice(0,4) }}</span>
        <span class="kort-tall">{{ nok(data.sisteRegnskap.sum_driftsinntekter) }}</span>
        <span class="kort-enhet">{{ data.sisteRegnskap.valuta }} i tusen</span>
      </div>
      <div class="kort" v-if="data.sisteRegnskap">
        <span class="kort-etikett">Årsresultat</span>
        <span class="kort-tall" :class="{ neg: Number(data.sisteRegnskap.aarsresultat) < 0 }">
          {{ nok(data.sisteRegnskap.aarsresultat) }}
        </span>
        <span class="kort-enhet">{{ data.sisteRegnskap.valuta }} i tusen</span>
      </div>
      <div class="kort">
        <span class="kort-etikett">Ansatte</span>
        <span class="kort-tall">{{ data.foretak.har_registrert_antall_ansatte ? data.foretak.antall_ansatte : '—' }}</span>
        <span class="kort-enhet">{{ data.foretak.har_registrert_antall_ansatte ? 'registrert' : 'ikke oppgitt' }}</span>
      </div>
      <div class="kort">
        <span class="kort-etikett">Stiftet</span>
        <span class="kort-tall" style="font-size:20px">{{ data.foretak.stiftelsesdato?.slice(0,4) ?? '—' }}</span>
        <span class="kort-enhet">{{ dato(data.foretak.stiftelsesdato) }}</span>
      </div>
    </div>

    <h2>Om foretaket</h2>
    <div class="card">
      <table class="meta">
        <tbody>
          <tr><td>Organisasjonsnummer</td><td><code>{{ data.foretak.organisasjonsnummer }}</code></td></tr>
          <tr><td>Organisasjonsform</td><td>{{ data.foretak.organisasjonsform_beskrivelse }} ({{ data.foretak.organisasjonsform_kode }})</td></tr>
          <tr v-if="data.foretak.naering_navn"><td>Næring</td><td>{{ data.foretak.naeringskode1_kode }} — {{ data.foretak.naering_navn }}</td></tr>
          <tr v-if="data.foretak.institusjonell_sektorkode_beskrivelse"><td>Sektor</td><td>{{ data.foretak.institusjonell_sektorkode_beskrivelse }}</td></tr>
          <tr><td>Registrert i Enhetsregisteret</td><td>{{ dato(data.foretak.registreringsdato_enhetsregisteret) }}</td></tr>
          <tr><td>Stiftet</td><td>{{ dato(data.foretak.stiftelsesdato) }}</td></tr>
          <tr><td>Registrert i Foretaksregisteret</td><td>{{ data.foretak.registrert_i_foretaksregisteret ? 'Ja' : 'Nei' }}</td></tr>
          <tr><td>Registrert i MVA-registeret</td><td>{{ data.foretak.registrert_i_mva_registeret ? 'Ja' : 'Nei' }}</td></tr>
          <tr v-if="data.foretak.kapital_belop"><td>Aksjekapital</td><td>{{ nb(Number(data.foretak.kapital_belop)) }} {{ data.foretak.kapital_valuta }}</td></tr>
          <tr v-if="data.foretak.maalform"><td>Målform</td><td>{{ data.foretak.maalform }}</td></tr>
        </tbody>
      </table>
    </div>

    <h2>Adresse</h2>
    <div class="card">
      <table class="meta">
        <tbody>
          <tr><td>Forretningsadresse</td><td>
            {{ data.foretak.forretningsadresse_adresse || '—' }}<br>
            {{ data.foretak.forretningsadresse_postnummer }} {{ data.foretak.forretningsadresse_poststed }}
          </td></tr>
          <tr><td>Kommune</td><td>{{ data.foretak.kommune_navn || '—' }} <span class="muted" v-if="data.foretak.forretningsadresse_kommunenummer">({{ data.foretak.forretningsadresse_kommunenummer }})</span></td></tr>
          <tr><td>Fylke</td><td>{{ data.foretak.fylke_navn || '—' }}</td></tr>
          <tr v-if="data.foretak.hjemmeside"><td>Hjemmeside</td><td>{{ data.foretak.hjemmeside }}</td></tr>
        </tbody>
      </table>
    </div>

    <template v-if="data.foretak.aktivitet || data.foretak.vedtektsfestet_formaal">
      <h2>Virksomhet</h2>
      <div class="card">
        <p style="margin:0; white-space:pre-wrap">{{ data.foretak.aktivitet || data.foretak.vedtektsfestet_formaal }}</p>
      </div>
    </template>

    <template v-if="data.foretak.morselskap_navn || Number(data.antall.datterselskap) > 0">
      <h2>Konsern</h2>
      <div class="card">
        <table class="meta">
          <tbody>
            <tr v-if="data.foretak.morselskap_navn"><td>Morselskap</td><td>
              <NuxtLink :to="`/foretak/${data.foretak.overordnet_enhet}`">{{ data.foretak.morselskap_navn }}</NuxtLink>
            </td></tr>
            <tr v-if="Number(data.antall.datterselskap) > 0">
              <td>Datterselskap<br><span class="muted">{{ data.antall.datterselskap }} med eierandel over 50 %</span></td>
              <td>
                <span v-if="datterLaster" class="muted"><span class="spinner" /> laster datterselskap…</span>
                <ul v-else class="datterliste">
                  <li v-for="d in datter?.datterselskap ?? []" :key="d.organisasjonsnummer">
                    <NuxtLink :to="`/foretak/${d.organisasjonsnummer}`">{{ d.navn }}</NuxtLink>
                    <span v-if="d.andel" class="andel">{{ nb(Number(d.andel), 1) }} %</span>
                    <span class="muted">
                      {{ d.organisasjonsform_kode }}<template v-if="d.forretningsadresse_poststed"> · {{ d.forretningsadresse_poststed }}</template><template v-if="d.har_registrert_antall_ansatte"> · {{ d.antall_ansatte }} ansatte</template>
                    </span>
                    <span v-if="d.konkurs" class="pill bad">Konkurs</span>
                  </li>
                </ul>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-if="data.foretak.konkurs || data.foretak.under_avvikling || data.foretak.slettet_dato">
      <h2>Status</h2>
      <div class="card">
        <table class="meta">
          <tbody>
            <tr v-if="data.foretak.konkurs"><td>Konkurs</td><td>{{ dato(data.foretak.konkursdato) }}</td></tr>
            <tr v-if="data.foretak.under_avvikling"><td>Under avvikling</td><td>{{ dato(data.foretak.under_avvikling_dato) }}</td></tr>
            <tr v-if="data.foretak.slettet_dato"><td>Slettet fra registeret</td><td>{{ dato(data.foretak.slettet_dato) }}</td></tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
