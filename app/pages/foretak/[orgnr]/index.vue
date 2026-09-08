<script setup lang="ts">
const route = useRoute()
const { data, error } = await useFetch(`/api/foretak/${route.params.orgnr}`)
const nok = (v: any) => v == null ? '—' : (Number(v) / 1000).toLocaleString('nb-NO', { maximumFractionDigits: 0 })
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
          <tr v-if="data.foretak.kapital_belop"><td>Aksjekapital</td><td>{{ Number(data.foretak.kapital_belop).toLocaleString('nb-NO') }} {{ data.foretak.kapital_valuta }}</td></tr>
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
            <tr v-if="Number(data.antall.datterselskap) > 0"><td>Datterselskap</td><td>{{ data.antall.datterselskap }}</td></tr>
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
