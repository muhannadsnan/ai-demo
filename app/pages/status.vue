<script setup lang="ts">
import { nb } from "~/utils/tall"
import { beskrivTabell, beskrivJobb } from "~/utils/datasett"

const { data } = await useFetch('/api/status')

// Jobs whose source is worth naming. Everything else comes from
// Enhetsregisteret, which the title already implies.
const VIS_KILDE = new Set(['embedding', 'referansedata', 'enheter', 'fornavn'])

const alder = (sek: number | null) => {
  if (sek == null) return 'aldri'
  const t = Math.floor(sek / 3600), d = Math.floor(sek / 86400)
  if (d >= 1) return `${d} ${d === 1 ? 'dag' : 'dager'} siden`
  if (t >= 1) return `${t} ${t === 1 ? 'time' : 'timer'} siden`
  return `${Math.max(1, Math.floor(sek / 60))} min siden`
}
const tid = (v: string | null) => v ? new Date(v).toLocaleString('nb-NO') : '—'
/**
 * hh:mm:ss for anything over a minute, otherwise seconds or milliseconds.
 *
 * The full accounts pass took 4,812.8 s, which is a number nobody can read as
 * "one hour twenty". Durations here span four orders of magnitude — 463 ms for
 * the name statistics, over an hour for a full refresh — so the unit has to
 * change with the size.
 */
function varighet(ms: number | null) {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const sek = Math.floor(ms / 1000)
  const t = Math.floor(sek / 3600)
  const m = Math.floor((sek % 3600) / 60)
  const s2 = sek % 60
  const to = (n: number) => String(n).padStart(2, '0')
  return t ? `${t}:${to(m)}:${to(s2)}` : `${m}:${to(s2)}`
}
const tall = (n: number) => nb(n)
const pst = (a: number, b: number) => b ? `${((a / b) * 100).toFixed(1).replace('.', ',')} %` : '—'
const storrelse = (b: number) =>
  b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} GB`
  : b >= 1e6 ? `${Math.round(b / 1e6)} MB`
  : `${Math.round(b / 1e3)} kB`

/** Just the indexed columns out of the full CREATE INDEX statement. */
function kolonnerAv(def: string) {
  const m = def.match(/\((.*)\)(?:\s+WHERE\s+(.*))?$/)
  if (!m) return ''
  const hvor = def.match(/\sWHERE\s+(.+)$/)
  return m[1].replace(/\s+/g, ' ') + (hvor ? ` — kun ${hvor[1]}` : '')
}

/** Every index added up, for the heading. */
const indeksBytes = computed(() =>
  (data.value?.indekser ?? []).reduce((n: number, i: any) => n + i.bytes, 0))

/** Indexes grouped by table, biggest table first. */
const indeksGrupper = computed(() => {
  const m = new Map<string, { tabell: string; indekser: any[]; bytes: number }>()
  for (const i of data.value?.indekser ?? []) {
    if (!m.has(i.tabell)) m.set(i.tabell, { tabell: i.tabell, indekser: [], bytes: 0 })
    const g = m.get(i.tabell)!
    g.indekser.push(i)
    g.bytes += i.bytes
  }
  return [...m.values()].sort((a, b) => b.bytes - a.bytes)
})

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

    <h2>Import-rutiner</h2>
    <p class="muted avsnitt">
      Jobbene som holder dataene oppdatert. De fleste kjører daglig; de tunge
      fullfilene ukentlig. Hver kjøring logges, også når den feiler.
    </p>
    <div class="tablewrap">
      <table class="meta">
        <thead>
          <tr>
            <th class="jobbkol">Jobb</th><th>Status</th><th>Sist kjørt</th>
            <th style="text-align:right">Lest</th>
            <th style="text-align:right">Nye</th>
            <th style="text-align:right">Endret</th>
            <th style="text-align:right">Slettet</th>
            <th style="text-align:right">Tid</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in data.importer" :key="i.kilde">
            <td class="jobbkol">
              <span class="jobbnavn">{{ beskrivJobb(i.kilde).tittel }}</span>
              <!-- How the data arrives, which is what actually distinguishes
                   these jobs — the full file and the change stream hit the same
                   register and the same table by opposite routes. -->
              <span v-if="beskrivJobb(i.kilde).type" class="jobbtype">({{ beskrivJobb(i.kilde).type }})</span>
              <span v-if="VIS_KILDE.has(i.kilde)" class="jobbkilde">{{ beskrivJobb(i.kilde).kilde }}</span>
            </td>
            <td>
              <span class="pill" :class="i.status === 'ok' ? 'ok' : i.status === 'feilet' ? 'bad' : 'warn'">
                {{ i.status }}
              </span>
            </td>
            <td>
              <span :class="fersk(i.alder_sek) ? 'fersk' : 'gammel'">{{ alder(i.alder_sek) }}</span>
              <span class="muted"> · {{ tid(i.ferdig_at ?? i.startet_at) }}</span>
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
          <tr><th>Datasett</th><th>Kilde</th><th style="text-align:right">Rader</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in data.tabeller" :key="t.tabell">
            <td><span class="jobbnavn">{{ beskrivTabell(t.tabell).tittel }}</span></td>
            <td class="muted" style="white-space:nowrap">{{ beskrivTabell(t.tabell).kilde }}</td>
            <td style="text-align:right; white-space:nowrap">{{ tall(t.rader) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2>Dekning</h2>
    <p class="muted avsnitt">Hvor stor del av registeret hvert datasett faktisk når.</p>
    <div class="card" v-if="data.dekningstall">
      <table class="meta">
        <tbody>
          <tr><td>Foretak i registeret</td><td>{{ tall(data.dekningstall.foretak) }}</td></tr>
          <tr>
            <td>Har sendt inn regnskap</td>
            <td>{{ tall(data.dekningstall.med_regnskap) }}
              <span class="andel">{{ pst(data.dekningstall.med_regnskap, data.dekningstall.foretak) }}</span></td>
          </tr>
          <tr>
            <td>Har skrevet en beskrivelse</td>
            <td>{{ tall(data.dekningstall.med_beskrivelse) }}
              <span class="andel">{{ pst(data.dekningstall.med_beskrivelse, data.dekningstall.foretak) }}</span></td>
          </tr>
          <tr>
            <td>Arkiverte roller<br><span class="muted">roller som har opphørt</span></td>
            <td>
              {{ tall(data.dekningstall.arkiverte_roller) }}
              <span class="muted" v-if="data.dekningstall.arkiv_siden">
                — arkiverer siden {{ data.dekningstall.arkiv_siden }}<template v-if="data.dekningstall.arkiv_fra">, eldste {{ data.dekningstall.arkiv_fra }}</template>
              </span>
              <span class="muted" v-if="!data.dekningstall.arkiverte_roller">
                (ingen roller har opphørt siden vi begynte å følge med)
              </span>
            </td>
          </tr>
          <tr><td>Slettet fra registeret</td><td>{{ tall(data.dekningstall.slettet) }}</td></tr>
          <tr>
            <td>Savnet i siste fullfil<br><span class="muted">venter på bekreftelse før de merkes slettet</span></td>
            <td>{{ tall(data.dekningstall.savnet) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2>Datakvalitet</h2>
    <p class="muted avsnitt">Det vi vet er feil eller utelatt, sagt høyt.</p>
    <div class="card" v-if="data.dekningstall">
      <table class="meta">
        <tbody>
          <tr>
            <td>Regnskap med urimelig målestokk<br><span class="muted">utelatt fra rangeringer og filtre</span></td>
            <td>{{ tall(data.dekningstall.urimelige) }}</td>
          </tr>
          <tr>
            <td>Foretak Brreg svarer 500 på<br><span class="muted">finansforetak API-et ikke klarer å levere</span></td>
            <td>{{ tall(data.dekningstall.hentefeil) }}</td>
          </tr>
          <tr>
            <td>Valuta i regnskapstallene</td>
            <td>
              <span v-for="v in data.valutaer" :key="v.kilde + v.valuta" class="valutabit">
                {{ v.valuta }} {{ tall(v.rader) }}
                <span class="muted">{{ v.kilde === 'brreg-api' ? 'API' : 'historikk' }}</span>
              </span>
              <span class="muted hint" style="display:block; margin-top:6px">
                Historikkfilen oppgir NOK for alt. API-et er uenig for rundt én
                prosent, og de leses som ti ganger for store til de er hentet på nytt.
              </span>
            </td>
          </tr>
          <tr>
            <td>Markør i endringsstrømmen<br><span class="muted">neste kjøring fortsetter herfra</span></td>
            <td><code>{{ data.dekningstall.markor }}</code>
              <span class="muted"> · {{ tid(data.dekningstall.markor_at) }}</span></td>
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
          {{ tall(data.embedding.totalt) }} beskrivelser
          <span v-if="data.embedding.sist" class="sistoppdatert">({{ tid(data.embedding.sist) }})</span>
        </strong>
        <span class="pill" :class="data.embedding.ferdig ? 'ok' : 'warn'">
          {{ nb(data.embedding.andel) }} %
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
          bare i de {{ nb(data.embedding.andel) }} prosentene
          som er lest inn — foretak lenger ned i organisasjonsnummer-rekkefølgen
          finnes ennå ikke. Kjøres med
          <code>./run-import.sh embedding</code>, og kan stoppes og startes igjen
          uten å miste arbeid.
        </template>

      </p>
    </div>

    <h2>Indekser <span class="hodetall">({{ data.indekser.length }} · {{ storrelse(indeksBytes) }})</span></h2>
    <p class="muted avsnitt">
      Hver av dem er en avgjørelse om hva som skal være raskt — kommentarene i
      <code>server-drift/migrations/</code> sier hvorfor hver enkelt finnes.
    </p>
    <div class="card indekstre">
      <template v-for="g in indeksGrupper" :key="g.tabell">
        <div class="indekstabell-rad">
          <span class="indekstabell-navn">{{ beskrivTabell(g.tabell).tittel }}</span>
          <span class="indekstabell-antall">({{ g.indekser.length }})</span>
          <span class="indekstabell-tall">{{ storrelse(g.bytes) }}</span>
        </div>
        <div v-for="i in g.indekser" :key="i.navn" class="indeksrad">
          <code class="indeksnavn">{{ i.navn }}</code>
          <span class="indekskolonner">{{ kolonnerAv(i.definisjon) }}</span>
          <span class="indeksbytes">{{ storrelse(i.bytes) }}</span>
        </div>
      </template>
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
