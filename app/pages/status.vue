<script setup lang="ts">
import { beskrivTabell, beskrivJobb } from "~/utils/datasett"

const { data } = await useFetch('/api/status')

const alder = (sek: number | null) => {
  if (sek == null) return 'aldri'
  const t = Math.floor(sek / 3600), d = Math.floor(sek / 86400)
  if (d >= 1) return `${d} ${d === 1 ? 'dag' : 'dager'} siden`
  if (t >= 1) return `${t} ${t === 1 ? 'time' : 'timer'} siden`
  return `${Math.max(1, Math.floor(sek / 60))} min siden`
}
const tid = (v: string | null) => v ? new Date(v).toLocaleString('nb-NO') : '—'
const varighet = (ms: number | null) => ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
const tall = (n: number) => n.toLocaleString('nb-NO')

// Anything not refreshed in over 48 hours is stale for a daily job.
const fersk = (sek: number | null) => sek != null && sek < 48 * 3600
</script>

<template>
  <div v-if="data">
    <h1>Status</h1>
    <p class="lede">
      Hva plattformen inneholder, og når hver kilde sist ble oppdatert.
      Importrutinene kjøres på server; denne siden viser hva de faktisk gjorde.
    </p>

    <h2>Importer</h2>
    <div class="tablewrap">
      <table class="meta">
        <thead>
          <tr>
            <th>Jobb</th><th>Sist kjørt</th><th>Status</th>
            <th style="text-align:right">Lest</th>
            <th style="text-align:right">Nye</th>
            <th style="text-align:right">Endret</th>
            <th style="text-align:right">Slettet</th>
            <th style="text-align:right">Tid</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in data.importer" :key="i.kilde">
            <td>
              <span class="jobbnavn">{{ beskrivJobb(i.kilde).tittel }}</span>
              <span class="jobbkilde">{{ beskrivJobb(i.kilde).kilde }}</span>
              <span class="jobbhva">{{ beskrivJobb(i.kilde).hva }}</span>
              <code class="jobbkode">{{ i.kilde }}</code>
            </td>
            <td>
              <span :class="fersk(i.alder_sek) ? 'fersk' : 'gammel'">{{ alder(i.alder_sek) }}</span>
              <span class="muted"> · {{ tid(i.ferdig_at ?? i.startet_at) }}</span>
            </td>
            <td>
              <span class="pill" :class="i.status === 'ok' ? 'ok' : i.status === 'feilet' ? 'bad' : 'warn'">
                {{ i.status }}
              </span>
            </td>
            <td style="text-align:right">{{ i.rader_lest ? tall(Number(i.rader_lest)) : '—' }}</td>
            <td style="text-align:right">{{ i.rader_nye != null ? tall(Number(i.rader_nye)) : '—' }}</td>
            <td style="text-align:right">{{ i.rader_endret != null ? tall(Number(i.rader_endret)) : '—' }}</td>
            <td style="text-align:right">{{ i.rader_slettet != null ? tall(Number(i.rader_slettet)) : '—' }}</td>
            <td style="text-align:right">{{ varighet(i.varighet_ms) }}</td>
          </tr>
          <tr v-if="!data.importer.length"><td colspan="8" class="muted">Ingen importer registrert ennå.</td></tr>
        </tbody>
      </table>
    </div>
    <p v-for="i in data.importer.filter(x => x.feilmelding)" :key="i.kilde" class="error-box">
      <strong>{{ beskrivJobb(i.kilde).tittel }}</strong>: {{ i.feilmelding }}
    </p>

    <h2>Innhold</h2>
    <div class="tablewrap">
      <table class="meta">
        <thead>
          <tr><th>Datasett</th><th>Hva det er</th><th>Kilde</th><th style="text-align:right">Rader</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in data.tabeller" :key="t.tabell">
            <td>
              <span class="jobbnavn">{{ beskrivTabell(t.tabell).tittel }}</span>
              <code class="jobbkode">{{ t.tabell }}</code>
            </td>
            <td class="hva">{{ beskrivTabell(t.tabell).hva }}</td>
            <td class="muted" style="white-space:nowrap">{{ beskrivTabell(t.tabell).kilde }}</td>
            <td style="text-align:right; white-space:nowrap">{{ tall(t.rader) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2>Regnskapsdekning</h2>
    <div class="card">
      <table class="meta">
        <tbody>
          <tr><td>Årsspenn</td><td>{{ data.regnskapsdekning.fra }}–{{ data.regnskapsdekning.til }}</td></tr>
          <tr><td>Foretak med regnskap</td><td>{{ tall(Number(data.regnskapsdekning.foretak)) }}</td></tr>
          <tr><td>Rader fra Brreg API</td><td>{{ tall(Number(data.regnskapsdekning.fra_api)) }} <span class="muted">— eksakte tall</span></td></tr>
          <tr><td>Rader fra historikk</td><td>{{ tall(Number(data.regnskapsdekning.fra_historikk)) }} <span class="muted">— avrundet ved kilden</span></td></tr>
        </tbody>
      </table>
    </div>

    <h2>Semantisk søk</h2>
    <div class="card" v-if="data?.embedding">
      <div class="row" style="justify-content:space-between; align-items:baseline">
        <strong>
          {{ tall(data.embedding.gjort) }} av {{ tall(data.embedding.totalt) }} beskrivelser
        </strong>
        <span class="pill" :class="data.embedding.ferdig ? 'ok' : 'warn'">
          {{ data.embedding.andel.toLocaleString('nb-NO') }} %
        </span>
      </div>
      <div class="framdrift"><i :style="{ width: Math.max(data.embedding.andel, 0.5) + '%' }" /></div>
      <p class="muted" style="margin:10px 0 0">
        <template v-if="data.embedding.ferdig && data.embedding.har_indeks">
          Alle beskrivelser er innlest, og HNSW-indeksen er bygget. Søk på mening
          treffer hele datasettet.
        </template>
        <template v-else-if="data.embedding.ferdig">
          Alle beskrivelser er innlest. HNSW-indeksen er ikke bygget ennå, så søk
          på mening sammenligner mot alle vektorene og er tregere enn det trenger
          å være.
        </template>
        <template v-else>
          Første gjennomkjøring pågår. Søk på mening virker allerede, men leter
          bare i de {{ data.embedding.andel.toLocaleString('nb-NO') }} prosentene
          som er lest inn — foretak lenger ned i organisasjonsnummer-rekkefølgen
          finnes ennå ikke. Kjøres med
          <code>./run-import.sh embedding</code>, og kan stoppes og startes igjen
          uten å miste arbeid.
        </template>
        <template v-if="data.embedding.sist">
          Sist oppdatert {{ tid(data.embedding.sist) }}.
        </template>
      </p>
    </div>

    <h2>Database</h2>
    <div class="card">
      <table class="meta">
        <tbody>
          <tr><td>Størrelse</td><td>{{ data.database.storrelse }}</td></tr>
          <tr><td>Siste migrasjon</td><td><code>{{ data.database.siste_migrasjon?.filename ?? '—' }}</code></td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
