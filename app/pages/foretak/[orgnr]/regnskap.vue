<script setup lang="ts">
import { nb } from "~/utils/tall"
const route = useRoute()
const orgnr = route.params.orgnr as string
const { data: hode } = await useFetch(`/api/foretak/${orgnr}`)
const { data } = await useFetch(`/api/foretak/${orgnr}/regnskap`)

const t = (v: any) => v == null ? '—' : Math.round(Number(v) / nb(1000))

/**
 * Direction of travel against the previous year.
 *
 * `data.aar` is newest first, so the comparison year is the NEXT element, not
 * the previous one.
 *
 * Costs and debt are deliberately NOT coloured. They used to be inverted —
 * rising costs painted red — which produced a red cell reading "+10 %" right
 * beside a green revenue cell reading "+12 %". Costs rising slower than revenue
 * is a good year, and the table cannot know that, so asserting a judgement it
 * cannot support was worse than staying quiet. They show the change without a
 * verdict.
 */
const NOYTRALE = new Set(['sum_driftskostnad', 'sum_finanskostnad', 'sum_gjeld', 'sum_kortsiktig_gjeld'])
function retning(felt: string, i: number) {
  if (NOYTRALE.has(felt)) return ''
  const rader = data.value?.aar ?? []
  const naa = rader[i]?.[felt], forrige = rader[i + 1]?.[felt]
  if (naa == null || forrige == null) return ''
  const diff = Number(naa) - Number(forrige)
  if (diff === 0) return ''
  return diff > 0 ? 'opp' : 'ned'
}
function endring(felt: string, i: number) {
  const rader = data.value?.aar ?? []
  const naa = rader[i]?.[felt], forrige = rader[i + 1]?.[felt]
  if (naa == null || forrige == null || Number(forrige) === 0) return null
  return ((Number(naa) - Number(forrige)) / Math.abs(Number(forrige))) * 100
}
function prosent(felt: string, i: number) {
  const p = endring(felt, i)
  if (p == null) return null
  const tegn = p > 0 ? '+' : p < 0 ? '−' : ''
  // A company going from 12k to 4.7m is up 39,000 %, which is true and useless
  // in a table cell — but showing nothing left a coloured cell with no
  // explanation, so it says that it is off the scale instead.
  if (Math.abs(p) >= 1000) return `(${tegn}1000 %+)`
  // One decimal below 10 %, none above. Without it a real 0.3 % rise rendered
  // as "+0 %", which reads as "nothing happened".
  const n = Math.abs(p) < 10 ? Math.abs(p).toFixed(1).replace('.', ',') : Math.abs(p).toFixed(0)
  return `(${tegn}${n} %)`
}
const tittel = (felt: string, i: number) => {
  const p = endring(felt, i)
  return p == null ? '' : `${p > 0 ? '+' : ''}${p.toFixed(1)} % mot året før`
}

/**
 * Off by default: the percentages are a second layer of information, and the
 * table is easier to read as plain figures until you want the comparison.
 *
 * `useState` rather than `ref` so the choice survives navigating from one
 * company to the next — the page component is remounted each time, and having
 * to click the button again on every company would be irritating.
 */
const visProsent = useState('regnskap-vis-prosent', () => false)

/**
 * The table rows, as data.
 *
 * Eleven rows of near-identical markup meant any change to a cell had to be
 * made eleven times consistently. `klasse` is the row class, `negativ` marks
 * the rows where a value below zero should be called out in red.
 */
const RADER = [
  { felt: 'sum_driftsinntekter', tittel: 'Driftsinntekter' },
  { felt: 'sum_driftskostnad',   tittel: 'Driftskostnader' },
  { felt: 'driftsresultat',      tittel: 'Driftsresultat', klasse: 'sum', negativ: true },
  { felt: 'sum_finansinntekter', tittel: 'Finansinntekter' },
  { felt: 'sum_finanskostnad',   tittel: 'Finanskostnader' },
  { felt: 'aarsresultat',        tittel: 'Årsresultat', klasse: 'sum', negativ: true },
  { felt: 'sum_anleggsmidler',   tittel: 'Anleggsmidler', klasse: 'skille' },
  { felt: 'sum_omloepsmidler',   tittel: 'Omløpsmidler' },
  { felt: 'sum_eiendeler',       tittel: 'Sum eiendeler', klasse: 'sum' },
  { felt: 'sum_egenkapital',     tittel: 'Egenkapital', negativ: true },
  { felt: 'sum_gjeld',           tittel: 'Gjeld' }
]

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

      <div class="row" style="align-items:baseline; margin-top:28px">
        <h2 style="margin:0">Resultat og balanse</h2>
        <button
          class="ghost" style="margin-left:auto"
          :aria-pressed="visProsent"
          @click="visProsent = !visProsent">
          {{ visProsent ? 'Skjul prosent' : 'Vis prosent' }}
        </button>
      </div>
      <div class="tablewrap">
        <table class="regnskap">
          <thead>
            <tr>
              <th>Tall i tusen {{ valuta }}</th>
              <th v-for="r in data.aar" :key="r.periode_til">{{ r.periode_til.slice(0, 4) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="rad in RADER" :key="rad.felt" :class="rad.klasse">
              <td>{{ rad.tittel }}</td>
              <td
                v-for="(r, i) in data.aar" :key="r.periode_til"
                :class="[retning(rad.felt, i), { negativ: rad.negativ && Number(r[rad.felt]) < 0 }]"
                :title="tittel(rad.felt, i)">
                {{ t(r[rad.felt]) }}<span
                  v-if="visProsent && prosent(rad.felt, i)"
                  class="pst">{{ prosent(rad.felt, i) }}</span>
              </td>
            </tr>
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
