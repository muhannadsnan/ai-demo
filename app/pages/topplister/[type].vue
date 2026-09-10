<script setup lang="ts">
import { nb } from "~/utils/tall"
const route = useRoute()
const { data, status, error } = await useFetch(() => `/api/topplister/${route.params.type}`, { lazy: true })
const laster = computed(() => status.value === 'pending')

useHead(() => ({ title: data.value ? `${data.value.tittel} — topplister` : 'Toppliste' }))


/**
 * Money is stored in kroner. A list of the largest companies in Norway is a list
 * of ten- and hundred-billion numbers, and eleven digits in a table cell is
 * unreadable, so anything over a million is shortened.
 */
function belop(v: any) {
  if (v == null) return '—'
  const n = Number(v), a = Math.abs(n)
  if (a >= 1e9) return nb(n / 1e9, 1) + ' mrd'
  if (a >= 1e6) return nb(n / 1e6, 1) + ' mill'
  return nb(n)
}

function celle(rad: any, kol: any) {
  const v = rad[kol.felt]
  if (v == null || v === '') return '—'
  switch (kol.format) {
    case 'belop':   return belop(v)
    case 'tall':    return nb(Number(v))
    case 'prosent': return nb(Number(v), 1) + ' %'
    case 'dato':    return new Date(v).toLocaleDateString('nb-NO')
    default:        return String(v)
  }
}

/** Right-align anything numeric, so the digits line up down the column. */
const erTall = (kol: any) => ['belop', 'tall', 'prosent'].includes(kol.format)

const tid = (v: string | null) => v ? new Date(v).toLocaleString('nb-NO') : '—'
</script>

<template>
  <div>
    <p class="tilbake"><NuxtLink to="/topplister">← Alle topplister</NuxtLink></p>

    <div v-if="error" class="error-box">Fant ikke listen.</div>
    <p v-else-if="laster && !data" class="muted">Henter listen …</p>

    <template v-else-if="data">
      <h1>{{ data.tittel }}</h1>
      <p class="lede">{{ data.beskrivelse }}</p>

      <div v-if="data.feilmelding" class="error-box">
        Listen kunne ikke beregnes sist den kjørte, så tallene under kan være gamle.
        <code>{{ data.feilmelding }}</code>
      </div>

      <div class="tabell-vindu">
        <table>
          <thead>
            <tr>
              <th class="nr">#</th>
              <th v-for="k in data.kolonner" :key="k.felt" :class="{ tall: erTall(k) }">{{ k.tittel }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(rad, i) in data.data" :key="i">
              <td class="nr">{{ i + 1 }}</td>
              <td v-for="k in data.kolonner" :key="k.felt" :class="{ tall: erTall(k) }">
                <NuxtLink
                  v-if="k.format === 'lenke' && rad.organisasjonsnummer"
                  :to="`/foretak/${rad.organisasjonsnummer}`">{{ rad[k.felt] || '—' }}</NuxtLink>
                <template v-else>{{ celle(rad, k) }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="muted footnote">
        {{ data.antall }} rader · beregnet {{ tid(data.generert_at) }}
        <template v-if="data.varighet_ms"> på {{ (data.varighet_ms / 1000).toFixed(1) }} s</template>
      </p>
    </template>
  </div>
</template>

<style scoped>
.tilbake { font-size: 13px; margin: 0 0 12px; }
.tabell-vindu { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
th { font: 500 11px/1.3 var(--mono); text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--accent-soft); }
.tall { text-align: right; font-variant-numeric: tabular-nums; }
.nr { width: 34px; color: var(--text-dim); font: 12px/1 var(--mono); text-align: right; }
.footnote { margin-top: 12px; }
</style>
