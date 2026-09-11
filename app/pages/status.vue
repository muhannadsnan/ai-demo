<script setup lang="ts">
import { nb } from "~/utils/tall"
import { beskrivTabell, beskrivJobb } from "~/utils/datasett"

/**
 * Polled, not reloaded.
 *
 * `refresh()` swaps the data in place and leaves the rendered page alone while
 * the request is out, so a running job's row updates without the screen
 * blanking. A plain reload would also re-fetch the page, and this endpoint can
 * take a second and a half when its cache is cold.
 */
const { data, refresh, status: hentestatus } = await useFetch('/api/status')

const POLL_MS = 30_000
const sisteHenting = ref(Date.now())
const sekunderSiden = ref(0)
let poll: ReturnType<typeof setInterval> | null = null
let klokke: ReturnType<typeof setInterval> | null = null

async function oppdater() {
  await refresh()
  sisteHenting.value = Date.now()
}

onMounted(() => {
  poll = setInterval(oppdater, POLL_MS)
  // Separate, faster tick so "x sekunder siden" counts up rather than jumping
  // by thirty each time.
  klokke = setInterval(() => {
    sekunderSiden.value = Math.round((Date.now() - sisteHenting.value) / 1000)
  }, 1000)
})
// Both cleared on unmount: an interval left running after the user navigates
// away keeps polling the server for a page nobody is looking at.
onUnmounted(() => {
  if (poll) clearInterval(poll)
  if (klokke) clearInterval(klokke)
})


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

/**
 * Currency totals across both sources.
 *
 * It used to list each source separately — "NOK 443.272 API, NOK 4.523.285
 * historikk" — which put thirteen entries on the row and made the interesting
 * part, that anything other than NOK exists at all, impossible to see.
 */
const valutasum = computed(() => {
  const m = new Map<string, number>()
  for (const v of data.value?.valutaer ?? []) m.set(v.valuta, (m.get(v.valuta) ?? 0) + v.rader)
  return [...m.entries()].map(([valuta, rader]) => ({ valuta, rader })).sort((a, b) => b.rader - a.rader)
})

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
  <div v-if="data" class="statusside">
    <div class="sidehode">
      <h1>Status</h1>
      <button class="levende" :class="{ henter: hentestatus === 'pending' }"
              :title="`Oppdaterer automatisk hvert ${POLL_MS / 1000}. sekund. Trykk for å hente nå.`"
              @click="oppdater">
        <span class="puls" />
        <span v-if="hentestatus === 'pending'">oppdaterer…</span>
        <span v-else-if="sekunderSiden < 5">nettopp oppdatert</span>
        <span v-else>oppdatert for {{ sekunderSiden }} s siden</span>
      </button>
    </div>
    <p class="lede">
      Hva plattformen inneholder, og når hver kilde sist ble oppdatert.
      Importrutinene kjøres på server; denne siden viser hva de faktisk gjorde.
    </p>

    <h2>Import-rutiner</h2>
    <section class="statuskort">
      <p class="kortnote">
        Jobbene som holder dataene oppdatert. De fleste kjører daglig; de tunge
        fullfilene ukentlig. Hver kjøring logges, også når den feiler.
      </p>
      <div class="tablewrap">
      <table class="meta jobbtabell">
        <thead>
          <tr>
            <th>Jobb</th><th>Status</th><th>Sist kjørt</th>
            <th>Lest</th>
            <th>Nye</th>
            <th>Endret</th>
            <th>Slettet</th>
            <th>Tid</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in data.importer" :key="i.kilde">
            <td>
              <span class="jobbnavn">{{ beskrivJobb(i.kilde).tittel }}</span>
              <!-- How the data arrives, which is what actually distinguishes
                   these jobs — the full file and the change stream hit the same
                   register and the same table by opposite routes. -->
              <span v-if="beskrivJobb(i.kilde).type" class="jobbtype">({{ beskrivJobb(i.kilde).type }})</span>
              <span class="jobbkilde">{{ beskrivJobb(i.kilde).kilde }}</span>
            </td>
            <td>
              <StatusIkon :status="i.status" />
            </td>
            <td>
              <span :class="fersk(i.alder_sek) ? 'fersk' : 'gammel'">{{ alder(i.alder_sek) }}</span>
              <span class="muted"> · {{ tid(i.ferdig_at ?? i.startet_at) }}</span>
            </td>
            <td>{{ i.rader_lest ? tall(Number(i.rader_lest)) : '—' }}</td>
            <td>{{ i.rader_nye != null ? tall(Number(i.rader_nye)) : '—' }}</td>
            <td>{{ i.rader_endret != null ? tall(Number(i.rader_endret)) : '—' }}</td>
            <td>{{ i.rader_slettet != null ? tall(Number(i.rader_slettet)) : '—' }}</td>
            <td>{{ varighet(i.varighet_ms) }}</td>
          </tr>
          <tr v-if="!data.importer.length"><td colspan="8" class="muted">Ingen importer registrert ennå.</td></tr>
        </tbody>
      </table>
      </div>
    </section>
    <p v-for="i in data.importer.filter(x => x.feilmelding)" :key="i.kilde" class="error-box">
      <strong>{{ beskrivJobb(i.kilde).tittel }}</strong>: {{ i.feilmelding }}
    </p>

    <h2>Tilstand</h2>
    <div class="statusrutenett">

      <section class="statuskort halv">
        <h3>Innhold</h3>
        <p class="kortnote">Hva plattformen faktisk inneholder, med kilde og antall rader.</p>
        <table class="meta innholdstabell">
          <tbody>
            <tr v-for="t in data.tabeller" :key="t.tabell">
              <td>
                <span class="jobbnavn">{{ beskrivTabell(t.tabell).tittel }}</span>
                <span class="jobbkilde">{{ beskrivTabell(t.tabell).kilde }}</span>
              </td>
              <td>{{ nb(t.rader) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="statuskort halv" v-if="data.dekningstall">
        <h3>Dekning</h3>
        <p class="kortnote">Hvor stor del av registeret hvert datasett når.</p>
        <dl>
        <div class="rad"><dt>Foretak i registeret</dt><dd>{{ nb(data.dekningstall.foretak) }}</dd></div>
        <div class="rad"><dt>Har sendt inn regnskap</dt><dd>{{ nb(data.dekningstall.med_regnskap) }} <span class="andel">{{ pst(data.dekningstall.med_regnskap, data.dekningstall.foretak) }}</span></dd></div>
        <div class="rad"><dt>Har skrevet en beskrivelse</dt><dd>{{ nb(data.dekningstall.med_beskrivelse) }} <span class="andel">{{ pst(data.dekningstall.med_beskrivelse, data.dekningstall.foretak) }}</span></dd></div>
        <div class="rad"><dt>Arkiverte roller</dt><dd>{{ nb(data.dekningstall.arkiverte_roller) }}<template v-if="data.dekningstall.arkiv_siden"> — siden {{ data.dekningstall.arkiv_siden }}</template></dd>
          <span class="kortnote"><template v-if="!data.dekningstall.arkiverte_roller">ingen roller har opphørt siden vi begynte å følge med</template></span></div>
        <div class="rad"><dt>Slettet fra registeret</dt><dd>{{ nb(data.dekningstall.slettet) }}</dd></div>
        <div class="rad"><dt>Savnet i siste fullfil</dt><dd>{{ nb(data.dekningstall.savnet) }}</dd>
          <span class="kortnote">venter på bekreftelse før de merkes slettet</span></div>
      </dl>
      </section>

      <section class="statuskort" v-if="data.dekningstall">
        <h3>Datakvalitet</h3>
        <p class="kortnote">Det vi vet er feil eller utelatt, sagt høyt.</p>
        <dl>
        <div class="rad"><dt>Urimelig målestokk</dt><dd>{{ nb(data.dekningstall.urimelige) }}</dd>
          <span class="kortnote">utelatt fra rangeringer og filtre</span></div>
        <div class="rad"><dt>Brreg svarer 500</dt><dd>{{ nb(data.dekningstall.hentefeil) }}</dd>
          <span class="kortnote">finansforetak API-et ikke klarer å levere</span></div>
        <div class="rad bred-rad"><dt>Valuta</dt>
          <dd class="valutaliste">
            <span v-for="(v, i) in valutasum" :key="v.valuta" class="valutabit">{{ v.valuta }} {{ nb(v.rader) }}<template v-if="i < valutasum.length - 1">,</template></span>
          </dd>
          <span class="kortnote">
            Historikkfilen oppgir NOK for alt. API-et er uenig for rundt én
            prosent, og de leses som ti ganger for store til de hentes på nytt.
          </span>
        </div>
        <div class="rad"><dt>Markør i endringsstrømmen</dt><dd><code>{{ data.dekningstall.markor }}</code></dd>
          <span class="kortnote">{{ tid(data.dekningstall.markor_at) }} — neste kjøring fortsetter herfra</span></div>
      </dl>
      </section>

      <section class="statuskort">
        <h3>Regnskapsdekning</h3>
        <dl>
        <div class="rad"><dt>Årsspenn</dt><dd>{{ data.regnskapsdekning.fra }}–{{ data.regnskapsdekning.til }}</dd></div>
        <div class="rad"><dt>Foretak med regnskap</dt><dd>{{ nb(Number(data.regnskapsdekning.foretak)) }}</dd></div>
        <div class="rad"><dt>Rader fra Brreg API</dt><dd>{{ nb(Number(data.regnskapsdekning.fra_api)) }}</dd>
          <span class="kortnote">eksakte tall</span></div>
        <div class="rad"><dt>Rader fra historikk</dt><dd>{{ nb(Number(data.regnskapsdekning.fra_historikk)) }}</dd>
          <span class="kortnote">avrundet ved kilden</span></div>
      </dl>
      </section>

      <div class="kortstabel">
      <section class="statuskort" v-if="data.embedding">
        <h3>Semantisk søk</h3>
        <dl>
          <div class="rad"><dt>Beskrivelser</dt><dd>{{ nb(data.embedding.totalt) }}</dd>
            <span class="sistoppdatert">sist oppd. {{ tid(data.embedding.sist) }}</span></div>
          <div class="rad bred-rad"><dt>Lest inn</dt>
            <dd class="medstolpe">
              <span>{{ nb(data.embedding.andel) }} %</span>
              <span class="framdrift"><i :style="{ width: Math.max(data.embedding.andel, 0.5) + '%' }" /></span>
            </dd>
            <span class="kortnote">
              <template v-if="data.embedding.ferdig && data.embedding.har_indeks">
                alt innlest, HNSW-indeksen er bygget
              </template>
              <template v-else-if="data.embedding.ferdig">
                innlest, men indeksen er ikke bygget — søk på mening er tregere enn nødvendig
              </template>
              <template v-else-if="data.embedding.andel >= 99">
                {{ nb(data.embedding.totalt - data.embedding.gjort) }} foretak er kommet
                til siden forrige kjøring; den daglige jobben tar dem
              </template>
              <template v-else>
                første gjennomkjøring pågår — søket virker, men bare i den ferdige delen
              </template>
            </span>
          </div>
        </dl>
      </section>

      <section class="statuskort">
        <h3>Database</h3>
        <dl>
        <div class="rad"><dt>Størrelse</dt><dd>{{ data.database.storrelse }}</dd></div>
        <div class="rad"><dt>Siste migrasjon</dt><dd><code>{{ data.database.siste_migrasjon?.filename ?? '—' }}</code></dd></div>
      </dl>
      </section>
      </div>

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
          <span class="indeksbytes">{{ storrelse(i.bytes) }}</span>
          <span class="indeksnavn">{{ i.navn }}</span>
          <span class="indekskolonner">{{ kolonnerAv(i.definisjon) }}</span>
        </div>
      </template>
    </div>

  </div>
</template>
