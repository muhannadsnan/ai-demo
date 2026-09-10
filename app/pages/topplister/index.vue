<script setup lang="ts">
import { nb } from "~/utils/tall"
useHead({ title: 'Topplister — norske foretak' })

const { data, status } = await useFetch('/api/topplister', { lazy: true })
const laster = computed(() => status.value === 'pending')

const antallLister = computed(() => data.value?.lister?.length ?? 0)

/** Group by category, keeping the order the API sorted them into. */
const grupper = computed(() => {
  const ut = new Map<string, any[]>()
  for (const l of data.value?.lister ?? []) {
    if (!ut.has(l.kategori)) ut.set(l.kategori, [])
    ut.get(l.kategori)!.push(l)
  }
  return [...ut.entries()]
})

const tid = (v: string | null) => v ? new Date(v).toLocaleString('nb-NO') : '—'
</script>

<template>
  <div>
    <div class="sidehode">
      <h1>Topplister</h1>
      <span v-if="data?.generert" class="oppdatert">Sist oppdatert {{ tid(data.generert) }}</span>
    </div>

    <p class="lede innramma">
      <strong class="listetall">{{ antallLister || '—' }}</strong>
      rangeringer regnet ut av hele datasettet — konkurser, regnskap, roller,
      eierskap og geografi. Listene beregnes én gang i døgnet og leses ferdige,
      så sidene svarer på millisekunder i stedet for å kjøre en aggregering per besøk.
    </p>

    <p v-if="laster" class="muted">Henter listene …</p>

    <section v-for="[kategori, lister] in grupper" :key="kategori" class="gruppe">
      <h2>{{ kategori }} <span class="gruppe-antall">({{ lister.length }})</span></h2>
      <div class="liste-rutenett">
        <NuxtLink v-for="l in lister" :key="l.type" class="liste-kort" :to="`/topplister/${l.type}`">
          <span class="liste-tittel">{{ l.tittel }}</span>
          <ol v-if="l.topp?.length && !l.feilet" class="liste-topp">
            <li v-for="(navn, i) in l.topp" :key="i">{{ navn }}</li>
          </ol>
          <span v-else-if="l.feilet" class="liste-topp feil">kunne ikke beregnes</span>
          <span class="liste-meta">
            <span class="prikker">·····</span>{{ l.antall }} rader
          </span>
        </NuxtLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* Heading and freshness on one line: when the list was last computed is the
   first thing to check on a page of precomputed numbers. */
.sidehode { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
.sidehode h1 { margin-right: auto; }
.oppdatert {
  font: 500 12px/1 var(--mono); color: var(--info);
  background: var(--info-soft); padding: 5px 9px; border-radius: 6px; white-space: nowrap;
}

/* The intro reads as a note about the page rather than as body copy, so it gets
   its own ground — full width, no frame around it. */
.innramma {
  max-width: none; margin: 14px auto 4px;
  background: var(--surface-2);
  border-radius: var(--radius); padding: 12px 20px;
}

.listetall { color: var(--info); font-weight: 700; font-size: 15px; }
.gruppe { margin-top: 30px; }
.gruppe h2 {
  font-size: 13px; margin: 0 0 12px; letter-spacing: .09em;
  text-transform: uppercase; color: var(--text-dim); font-weight: 650;
}
.gruppe-antall { color: var(--text-dim); font-weight: 500; }

.liste-rutenett {
  display: grid; gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
}
.liste-kort {
  display: flex; flex-direction: column; gap: 5px;
  padding: 12px 14px; text-decoration: none; color: inherit;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  transition: border-color .12s ease;
  overflow: hidden;
}
.liste-kort:hover { border-color: var(--accent); }
.liste-tittel { font-weight: 650; font-size: 14px; line-height: 1.3; color: var(--accent); }

/* `counter` rather than a real <ol> marker so the numbers sit tight against
   the names at this size. */
.liste-topp { list-style: none; margin: 0; padding: 0; counter-reset: plass; }
.liste-topp li {
  counter-increment: plass; color: var(--text);
  font-size: 13px; line-height: 1.5;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.liste-topp li::before {
  content: counter(plass) ". ";
  color: var(--text-dim); font: 11px/1 var(--mono);
}
.liste-topp.feil { color: var(--text-dim); font-style: italic; font-size: 13px; }
.liste-meta {
  margin-top: auto; padding-top: 8px;
  font: 11px/1 var(--mono); color: var(--text-dim);
  text-transform: uppercase; letter-spacing: .05em;
}
.liste-meta .prikker { letter-spacing: .18em; margin-right: 6px; opacity: .7; }
</style>
