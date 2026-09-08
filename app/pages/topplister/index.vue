<script setup lang="ts">
useHead({ title: 'Topplister — norske foretak' })

const { data, status } = await useFetch('/api/topplister', { lazy: true })
const laster = computed(() => status.value === 'pending')

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
    <h1>Topplister</h1>
    <p class="lede">
      Tjue rangeringer regnet ut av hele datasettet — konkurser, regnskap, roller,
      eierskap og geografi. Listene beregnes én gang i døgnet og leses ferdige,
      så sidene svarer på millisekunder i stedet for å kjøre en aggregering per besøk.
    </p>

    <p v-if="data?.generert" class="muted">Sist oppdatert {{ tid(data.generert) }}.</p>

    <p v-if="laster" class="muted">Henter listene …</p>

    <section v-for="[kategori, lister] in grupper" :key="kategori" class="gruppe">
      <h2>{{ kategori }}</h2>
      <div class="liste-rutenett">
        <NuxtLink v-for="l in lister" :key="l.type" class="liste-kort" :to="`/topplister/${l.type}`">
          <span class="liste-tittel">{{ l.tittel }}</span>
          <span v-if="l.topp && !l.feilet" class="liste-topp">1. {{ l.topp }}</span>
          <span v-else-if="l.feilet" class="liste-topp feil">kunne ikke beregnes</span>
          <span class="liste-meta">{{ l.antall }} rader</span>
        </NuxtLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.gruppe { margin-top: 28px; }
.gruppe h2 { font-size: 15px; margin: 0 0 10px; letter-spacing: -0.01em; }
.liste-rutenett {
  display: grid; gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}
.liste-kort {
  display: flex; flex-direction: column; gap: 4px;
  padding: 12px 14px; text-decoration: none; color: inherit;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  transition: border-color .12s ease;
}
.liste-kort:hover { border-color: var(--accent); }
.liste-tittel { font-weight: 600; font-size: 14px; line-height: 1.3; }
.liste-topp { font-size: 13px; color: var(--accent); }
.liste-topp.feil { color: var(--text-dim); font-style: italic; }
.liste-meta { font: 11px/1 var(--mono); color: var(--text-dim); text-transform: uppercase; letter-spacing: .05em; }
</style>
