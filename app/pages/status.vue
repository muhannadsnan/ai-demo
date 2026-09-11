<script setup lang="ts">
import { nb } from "~/utils/tall"
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
              <span class="pill" :class="i.status === 'ok' ? 'ok' : i.status === 'feilet' ? 'bad' : 'warn'">
                {{ i.status }}
              </span>
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
    <p v-for="i in data.importer.filter(x => x.feilmelding)" :key="i.kilde" class="error-box">
      <strong>{{ beskrivJobb(i.kilde).tittel }}</strong>: {{ i.feilmelding }}
    </p>

    <h2>Tilstand</h2>
    <div class="statusrutenett">

      <section class="statuskort bred">
        <h3>Innhold</h3>
        <p class="kortnote">Hva plattformen faktisk inneholder.</p>
        <div class="tablewrap">
      <table class="meta smaltabell">
        <thead>
          <tr><th>Datasett</th><th>Kilde</th><th>Rader</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in data.tabeller" :key="t.tabell">
            <td><span class="jobbnavn">{{ beskrivTabell(t.tabell).tittel }}</span></td>
            <td class="muted">{{ beskrivTabell(t.tabell).kilde }}</td>
            <td>{{ tall(t.rader) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
      </section>

      <section class="statuskort" v-if="data.dekningstall">
        <h3>Dekning</h3>
        <p class="kortnote">Hvor stor del av registeret hvert datasett når.</p>
        <dl>
          <dt>Foretak i registeret</dt><dd>{{ nb(data.dekningstall.foretak) }}</dd>
          <dt>Har sendt inn regnskap</dt>
          <dd>{{ nb(data.dekningstall.med_regnskap) }}
            <span class="andel">{{ pst(data.dekningstall.med_regnskap, data.dekningstall.foretak) }}</span></dd>
          <dt>Har skrevet en beskrivelse</dt>
          <dd>{{ nb(data.dekningstall.med_beskrivelse) }}
            <span class="andel">{{ pst(data.dekningstall.med_beskrivelse, data.dekningstall.foretak) }}</span></dd>
          <dt>Arkiverte roller</dt>
          <dd>
            {{ nb(data.dekningstall.arkiverte_roller) }}
            <template v-if="data.dekningstall.arkiv_siden">— siden {{ data.dekningstall.arkiv_siden }}</template>
            <span v-if="!data.dekningstall.arkiverte_roller" class="kortnote">
              ingen roller har opphørt siden vi begynte å følge med
            </span>
          </dd>
          <dt>Slettet fra registeret</dt><dd>{{ nb(data.dekningstall.slettet) }}</dd>
          <dt>Savnet i siste fullfil</dt>
          <dd>{{ nb(data.dekningstall.savnet) }}
            <span class="kortnote">venter på bekreftelse før de merkes slettet</span></dd>
        </dl>
      </section>

      <section class="statuskort" v-if="data.dekningstall">
        <h3>Datakvalitet</h3>
        <p class="kortnote">Det vi vet er feil eller utelatt, sagt høyt.</p>
        <dl>
          <dt>Urimelig målestokk</dt>
          <dd>{{ nb(data.dekningstall.urimelige) }}
            <span class="kortnote">utelatt fra rangeringer og filtre</span></dd>
          <dt>Brreg svarer 500</dt>
          <dd>{{ nb(data.dekningstall.hentefeil) }}
            <span class="kortnote">finansforetak API-et ikke klarer å levere</span></dd>
          <dt>Valuta</dt>
          <dd>
            <span v-for="v in valutasum" :key="v.valuta" class="valutabit">{{ v.valuta }} {{ nb(v.rader) }}</span>
            <span class="kortnote">
              Historikkfilen oppgir NOK for alt. API-et er uenig for rundt én
              prosent, og de leses som ti ganger for store til de hentes på nytt.
            </span>
          </dd>
          <dt>Markør i endringsstrømmen</dt>
          <dd><code>{{ data.dekningstall.markor }}</code>
            <span class="kortnote">{{ tid(data.dekningstall.markor_at) }} — neste kjøring fortsetter herfra</span></dd>
        </dl>
      </section>

      <section class="statuskort">
        <h3>Regnskapsdekning</h3>
        <dl>
          <dt>Årsspenn</dt><dd>{{ data.regnskapsdekning.fra }}–{{ data.regnskapsdekning.til }}</dd>
          <dt>Foretak med regnskap</dt><dd>{{ nb(Number(data.regnskapsdekning.foretak)) }}</dd>
          <dt>Rader fra Brreg API</dt>
          <dd>{{ nb(Number(data.regnskapsdekning.fra_api)) }}
            <span class="kortnote">eksakte tall</span></dd>
          <dt>Rader fra historikk</dt>
          <dd>{{ nb(Number(data.regnskapsdekning.fra_historikk)) }}
            <span class="kortnote">avrundet ved kilden</span></dd>
        </dl>
      </section>

      <section class="statuskort" v-if="data.embedding">
        <h3>Semantisk søk</h3>
        <dl>
          <dt>Beskrivelser</dt>
          <dd>{{ nb(data.embedding.totalt) }}
            <span class="sistoppdatert">{{ tid(data.embedding.sist) }}</span></dd>
          <dt>Lest inn</dt>
          <dd>
            <span class="medstolpe">
              <span>{{ nb(data.embedding.andel) }} %</span>
              <span class="framdrift"><i :style="{ width: Math.max(data.embedding.andel, 0.5) + '%' }" /></span>
            </span>
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
          </dd>
        </dl>
      </section>

      <section class="statuskort">
        <h3>Database</h3>
        <dl>
          <dt>Størrelse</dt><dd>{{ data.database.storrelse }}</dd>
          <dt>Siste migrasjon</dt>
          <dd><code>{{ data.database.siste_migrasjon?.filename ?? '—' }}</code></dd>
        </dl>
      </section>

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
