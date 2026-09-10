<script setup lang="ts">
import { kort } from "~/utils/tall"
/**
 * A county or municipality picker that filters a known list rather than taking
 * free text.
 *
 * Typing "berg" used to run a `navn ILIKE '%berg%'` against the search itself,
 * which matched Bergen, Sandnessjøen... and told you nothing until the results
 * came back. Filtering a list of 360 municipalities in the browser shows every
 * candidate with its company count while you type, so you pick a real place and
 * see how big it is first.
 *
 * The value is still the number, so the URL stays shareable and the API is
 * unchanged.
 */
const props = defineProps<{ type: 'fylke' | 'kommune'; fylkeFilter?: string }>()
const valgt = defineModel<string>({ default: '' })

const { data } = await useFetch('/api/geografi', { lazy: true })

interface Sted { nr: string; navn: string; antall: number; fylke?: string }

const alle = computed<Sted[]>(() =>
  (props.type === 'fylke' ? data.value?.fylker : data.value?.kommuner) ?? [])

const sok = ref('')
const apen = ref(false)

const valgtNavn = computed(() => alle.value.find(s => s.nr === valgt.value)?.navn ?? '')

const treff = computed(() => {
  let liste = alle.value
  // A municipality list narrows to the chosen county: picking Oslo county and
  // then being offered Bergen is not a useful list.
  if (props.type === 'kommune' && props.fylkeFilter) {
    liste = liste.filter(s => s.fylke === props.fylkeFilter)
  }
  const q = sok.value.trim().toLowerCase()
  if (q) liste = liste.filter(s => s.navn.toLowerCase().includes(q) || s.nr.startsWith(q))
  return liste
})

function velg(s: Sted) {
  valgt.value = s.nr
  sok.value = ''
  apen.value = false
}
function tom() {
  valgt.value = ''
  sok.value = ''
}

/**
 * Close the list on a click outside it, or on Escape.
 *
 * Without this the list only ever closed by picking something: `apen` was set
 * on focus and never cleared, so moving on without choosing left an absolutely
 * positioned panel open on top of the filters below it. The fields underneath
 * were then unreachable — clicks landed on the list, not on them — which looked
 * like those filters being broken rather than like a dropdown being stuck.
 *
 * `mousedown`, not `click`: it fires before focus moves, so the panel is gone
 * by the time the field you aimed at receives the event. A `blur` handler is
 * the other common approach and it is worse here — blur beats the list item's
 * own click, so choosing a municipality would close the list before `velg` ran.
 */
const rot = ref<HTMLElement | null>(null)

function utenfor(e: MouseEvent) {
  if (rot.value && !rot.value.contains(e.target as Node)) apen.value = false
}
function paaEscape(e: KeyboardEvent) {
  if (e.key === 'Escape') apen.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', utenfor)
  document.addEventListener('keydown', paaEscape)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', utenfor)
  document.removeEventListener('keydown', paaEscape)
})

const tall = kort
</script>

<template>
  <div ref="rot" class="geo">
    <div v-if="valgt" class="geo-valgt">
      <span class="geo-navn">{{ valgtNavn || valgt }}</span>
      <button type="button" aria-label="Fjern" @click="tom">×</button>
    </div>

    <template v-else>
      <input
        v-model="sok" type="text" class="geo-sok"
        :placeholder="type === 'fylke' ? 'Søk fylke…' : 'Søk kommune…'"
        @focus="apen = true"
        @input="apen = true">
      <!-- `apen` alone, not `apen || sok`: with the text still in the box, the
           old condition kept the panel open after it had been dismissed. -->
      <ul v-if="apen" class="geo-liste">
        <li v-for="s in treff" :key="s.nr">
          <button type="button" @click="velg(s)">
            <span class="geo-navn">{{ s.navn }}</span>
            <span class="geo-nr">{{ s.nr }}</span>
            <span class="geo-antall">{{ tall(s.antall) }}</span>
          </button>
        </li>
        <li v-if="!treff.length" class="geo-tomt">Ingen treff</li>
      </ul>
    </template>
  </div>
</template>
