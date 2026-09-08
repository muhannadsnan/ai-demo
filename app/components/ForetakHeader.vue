<script setup lang="ts">
const props = defineProps<{ foretak: any; antall: any }>()
const route = useRoute()
const o = props.foretak.organisasjonsnummer

const status = computed(() => {
  const f = props.foretak
  if (f.slettet_dato)          return { label: 'Slettet',            cls: 'bad'  }
  if (f.konkurs)               return { label: 'Konkurs',            cls: 'bad'  }
  if (f.under_tvangsavvikling) return { label: 'Tvangsavvikling',    cls: 'bad'  }
  if (f.under_avvikling)       return { label: 'Under avvikling',    cls: 'warn' }
  return { label: 'Aktiv', cls: 'ok' }
})

const faner = computed(() => [
  { to: `/foretak/${o}`,           navn: 'Info',      antall: null },
  { to: `/foretak/${o}/regnskap`,  navn: 'Regnskap',  antall: Number(props.antall.regnskapsaar) },
  { to: `/foretak/${o}/roller`,    navn: 'Roller',    antall: Number(props.antall.roller) },
  { to: `/foretak/${o}/eierskap`,  navn: 'Eierskap',  antall: Number(props.antall.aksjonaerer) }
])
</script>

<template>
  <div class="foretak-head">
    <div class="row" style="gap:10px; align-items:baseline">
      <h1>{{ foretak.navn }}</h1>
      <span class="pill" :class="status.cls">{{ status.label }}</span>
    </div>
    <p class="muted" style="margin:4px 0 0">
      <code>{{ foretak.organisasjonsnummer }}</code>
      · {{ foretak.organisasjonsform_beskrivelse }}
      <template v-if="foretak.forretningsadresse_poststed"> · {{ foretak.forretningsadresse_poststed }}</template>
      <template v-if="foretak.fylke_navn"> · {{ foretak.fylke_navn }}</template>
    </p>

    <nav class="faner">
      <NuxtLink v-for="f in faner" :key="f.to" :to="f.to"
                :class="{ aktiv: route.path === f.to }">
        {{ f.navn }}<span v-if="f.antall" class="tall">{{ f.antall }}</span>
      </NuxtLink>
    </nav>
  </div>
</template>
