<script setup lang="ts">
import { nb } from "~/utils/tall"
useHead({ title: 'Spør om foretak — naturlig språk' })

/**
 * Natural language to a filter, not to SQL.
 *
 * The model's only job is to turn the sentence into a small JSON filter spec
 * over a fixed vocabulary of fields and operators. It never sees the database
 * and never writes SQL, so the worst a bad answer can do is filter on the wrong
 * field — which is why the interpretation is shown, in full, above the results.
 */
const sporsmal = ref('')
const svar = ref<any>(null)
const feil = ref('')
const laster = ref(false)

const EKSEMPLER = [
  'aktive byggefirmaer i Bergen med over 50 ansatte',
  'de største selskapene i Rogaland etter omsetning',
  'selskaper stiftet før 1950 med mer enn 200 ansatte',
  'AS i Tromsø med mer enn 10 millioner i aksjekapital',
  'konkursrammede restauranter i Oslo'
]

async function spor(tekst?: string) {
  const q = (tekst ?? sporsmal.value).trim()
  if (!q || laster.value) return
  sporsmal.value = q
  laster.value = true
  feil.value = ''
  svar.value = null
  try {
    svar.value = await $fetch('/api/ai/sporring', { method: 'POST', body: { sporsmal: q } })
  } catch (e: any) {
    feil.value = e?.data?.statusMessage || e?.message || 'Noe gikk galt'
  } finally {
    laster.value = false
  }
}

const OP_TEKST: Record<string, string> = {
  er: 'er', ikke: 'er ikke', minst: 'minst', hoyst: 'høyst', inneholder: 'inneholder'
}
const visVerdi = (v: unknown) =>
  typeof v === 'boolean' ? (v ? 'ja' : 'nei')
  : typeof v === 'number' ? nb(v)
  : String(v)
const tall = (v: any) => v == null ? '—' : nb(Number(v))
const nok = (v: any) => v == null ? '—' : Math.round(Number(v) / nb(1000))
</script>

<template>
  <div>
    <h1>Spør om foretak</h1>
    <p class="sidebeskrivelse">
      Skriv spørsmålet som en setning. En språkmodell oversetter det til et
      <strong>filter</strong> — ikke til SQL. Modellen ser aldri databasen og kan
      ikke navngi et felt som ikke finnes; et ukjent felt blir et avvist filter,
      ikke en spørring. Tolkningen vises over resultatene, slik at du ser hvilket
      spørsmål som faktisk ble besvart.
    </p>

    <div class="sokefelt">
      <span class="sokeboks">
        <input v-model="sporsmal" type="text" :disabled="laster"
               placeholder="f.eks. aktive byggefirmaer i Bergen med over 50 ansatte"
               @keydown.enter="spor()">
        <button v-if="sporsmal" class="tom" type="button" aria-label="Tøm" @click="sporsmal = ''">×</button>
      </span>
      <button :disabled="laster || !sporsmal.trim()" @click="spor()">Spør</button>
    </div>

    <div class="chips">
      <span v-for="e in EKSEMPLER" :key="e" class="chip" @click="spor(e)">{{ e }}</span>
    </div>

    <div v-if="laster" class="laster"><span class="spinner" /> Tolker spørsmålet …</div>
    <div v-if="feil" class="error-box">{{ feil }}</div>

    <template v-if="svar">
      <h2>Slik ble spørsmålet forstått</h2>
      <div class="card">
        <div class="tolkning">
          <span v-for="(f, i) in svar.tolkning.filtre" :key="i" class="filterbit">
            <span class="felt">{{ f.felt }}</span>
            <span class="op">{{ OP_TEKST[f.op] ?? f.op }}</span>
            <span class="verdi">{{ visVerdi(f.verdi) }}</span>
          </span>
          <span v-if="!svar.tolkning.filtre.length" class="muted">ingen filtre — alle foretak</span>
        </div>
        <p class="muted" style="margin:10px 0 0">
          Sortert på <strong>{{ svar.tolkning.sorter }}</strong> {{ svar.tolkning.retning }}.
          <template v-if="svar.reparert">
            Første forsøk ble avvist av validatoren, og modellen korrigerte seg.
          </template>
        </p>
      </div>

      <h2>{{ tall(svar.treff) }} treff</h2>
      <div v-if="!svar.foretak.length" class="card muted">
        Ingen foretak passer. Prøv å fjerne en betingelse fra spørsmålet.
      </div>
      <div v-else class="tabellvindu">
        <table>
          <thead>
            <tr><th>Foretak</th><th>Form</th><th>Sted</th><th class="t">Ansatte</th><th class="t">Driftsinnt.</th></tr>
          </thead>
          <tbody>
            <tr v-for="f in svar.foretak" :key="f.organisasjonsnummer">
              <td><NuxtLink :to="`/foretak/${f.organisasjonsnummer}`">{{ f.navn }}</NuxtLink></td>
              <td class="dim">{{ f.organisasjonsform_kode }}</td>
              <td class="dim">{{ f.forretningsadresse_poststed || '—' }}</td>
              <td class="t">{{ tall(f.antall_ansatte) }}</td>
              <td class="t">{{ nok(f.sum_driftsinntekter) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="muted" style="margin-top:10px">
        Beløp i tusen kroner. Modell <code>{{ svar.modell }}</code> brukte
        {{ (svar.tid.modell_ms / 1000).toFixed(1) }} s på å tolke spørsmålet;
        databasen brukte {{ svar.tid.database_ms }} ms på å svare.
      </p>
    </template>
  </div>
</template>

<style scoped>
.tolkning { display: flex; flex-wrap: wrap; gap: 8px; }
.filterbit {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 9px; border-radius: 6px; font-size: 13px;
  background: var(--surface-2); border: 1px solid var(--border);
}
.filterbit .felt { font: 500 12px/1 var(--mono); color: var(--accent); }
.filterbit .op { color: var(--text-dim); font-size: 12px; }
.filterbit .verdi { font-weight: 600; }
.tabellvindu { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { padding: 7px 12px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
th { font: 500 11px/1.3 var(--mono); text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--accent-soft); }
.t { text-align: right; font-variant-numeric: tabular-nums; }
.dim { color: var(--text-dim); }
</style>
