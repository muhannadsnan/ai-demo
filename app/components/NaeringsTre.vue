<script setup lang="ts">
/**
 * The NACE industry tree as a checkbox tree, four levels deep.
 *
 * Selection is by node, not by leaf: ticking "F — Bygge- og anleggsvirksomhet"
 * sends the single code `F`, and the search expands it to its level-5 leaves in
 * SQL. Sending 300 leaf codes up the wire instead would work and be silly.
 *
 * A node inside a ticked branch is shown as included but not separately ticked,
 * because unticking it could not do anything — the parent already covers it.
 */
const valgt = defineModel<string[]>({ default: () => [] })

const { data } = await useFetch('/api/naeringskoder', { lazy: true })

const filter = ref('')
const apne = ref(new Set<string>())

interface Node { kode: string; navn: string; niva: number; parent_kode: string | null; antall: number }

/** Children indexed by parent code, so rendering never scans the full list. */
const barn = computed(() => {
  const m = new Map<string | null, Node[]>()
  for (const n of (data.value?.noder ?? []) as Node[]) {
    const k = n.niva === 1 ? null : n.parent_kode
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(n)
  }
  return m
})

/**
 * Codes matching the filter box, plus every ancestor of a match so the branch
 * can be drawn down to it. Empty filter means "no restriction", not "nothing".
 */
const synlig = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return null
  const alle = (data.value?.noder ?? []) as Node[]
  const etter = new Map(alle.map(n => [n.kode, n]))
  const ut = new Set<string>()
  for (const n of alle) {
    if (!n.navn.toLowerCase().includes(q) && !n.kode.toLowerCase().startsWith(q)) continue
    ut.add(n.kode)
    let p = n.parent_kode
    while (p) { ut.add(p); p = etter.get(p)?.parent_kode ?? null }
  }
  return ut
})

function vis(n: Node) { return !synlig.value || synlig.value.has(n.kode) }
function harBarn(n: Node) { return (barn.value.get(n.kode)?.length ?? 0) > 0 }
function erApen(n: Node) { return apne.value.has(n.kode) || (synlig.value?.has(n.kode) ?? false) }
function veksle(n: Node) {
  apne.value.has(n.kode) ? apne.value.delete(n.kode) : apne.value.add(n.kode)
  apne.value = new Set(apne.value)
}

/** True when an ancestor is ticked, so this node is already included. */
function dekket(n: Node): boolean {
  const etter = new Map(((data.value?.noder ?? []) as Node[]).map(x => [x.kode, x]))
  let p = n.parent_kode
  while (p) {
    if (valgt.value.includes(p)) return true
    p = etter.get(p)?.parent_kode ?? null
  }
  return false
}

function kryss(n: Node) {
  const i = valgt.value.indexOf(n.kode)
  if (i >= 0) valgt.value = valgt.value.filter(k => k !== n.kode)
  // Ticking a parent makes any ticked descendant redundant; drop them so the
  // chip list stays honest about what is actually filtering.
  else valgt.value = [...valgt.value.filter(k => !erEtterkommer(k, n.kode)), n.kode]
}
function erEtterkommer(kode: string, av: string): boolean {
  const etter = new Map(((data.value?.noder ?? []) as Node[]).map(x => [x.kode, x]))
  let p = etter.get(kode)?.parent_kode ?? null
  while (p) { if (p === av) return true; p = etter.get(p)?.parent_kode ?? null }
  return false
}

const tall = (n: number) => n.toLocaleString('nb-NO')
</script>

<template>
  <div class="tre">
    <input v-model="filter" class="tre-filter" type="text" placeholder="Filtrer næringer…">

    <p v-if="!data" class="muted"><span class="spinner" /> laster næringskoder…</p>

    <div v-else class="tre-liste">
      <template v-for="n1 in barn.get(null) ?? []" :key="n1.kode">
        <template v-if="vis(n1)">
          <div class="tre-rad" :class="{ dekket: dekket(n1) }">
            <button v-if="harBarn(n1)" class="tre-pil" type="button" @click="veksle(n1)">
              {{ erApen(n1) ? '▾' : '▸' }}
            </button>
            <span v-else class="tre-pil" />
            <label>
              <input type="checkbox" :checked="valgt.includes(n1.kode) || dekket(n1)"
                     :disabled="dekket(n1)" @change="kryss(n1)">
              <span class="tre-kode">{{ n1.kode }}</span>
              <span class="tre-navn">{{ n1.navn }}</span>
              <span class="tre-antall">{{ tall(n1.antall) }}</span>
            </label>
          </div>

          <template v-if="erApen(n1)" v-for="n2 in barn.get(n1.kode) ?? []" :key="n2.kode">
            <template v-if="vis(n2)">
              <div class="tre-rad niva2" :class="{ dekket: dekket(n2) }">
                <button v-if="harBarn(n2)" class="tre-pil" type="button" @click="veksle(n2)">
                  {{ erApen(n2) ? '▾' : '▸' }}
                </button>
                <span v-else class="tre-pil" />
                <label>
                  <input type="checkbox" :checked="valgt.includes(n2.kode) || dekket(n2)"
                         :disabled="dekket(n2)" @change="kryss(n2)">
                  <span class="tre-kode">{{ n2.kode }}</span>
                  <span class="tre-navn">{{ n2.navn }}</span>
                  <span class="tre-antall">{{ tall(n2.antall) }}</span>
                </label>
              </div>

              <template v-if="erApen(n2)" v-for="n3 in barn.get(n2.kode) ?? []" :key="n3.kode">
                <template v-if="vis(n3)">
                  <div class="tre-rad niva3" :class="{ dekket: dekket(n3) }">
                    <button v-if="harBarn(n3)" class="tre-pil" type="button" @click="veksle(n3)">
                      {{ erApen(n3) ? '▾' : '▸' }}
                    </button>
                    <span v-else class="tre-pil" />
                    <label>
                      <input type="checkbox" :checked="valgt.includes(n3.kode) || dekket(n3)"
                             :disabled="dekket(n3)" @change="kryss(n3)">
                      <span class="tre-kode">{{ n3.kode }}</span>
                      <span class="tre-navn">{{ n3.navn }}</span>
                      <span class="tre-antall">{{ tall(n3.antall) }}</span>
                    </label>
                  </div>

                  <template v-if="erApen(n3)" v-for="n4 in barn.get(n3.kode) ?? []" :key="n4.kode">
                    <div v-if="vis(n4)" class="tre-rad niva4" :class="{ dekket: dekket(n4) }">
                      <span class="tre-pil" />
                      <label>
                        <input type="checkbox" :checked="valgt.includes(n4.kode) || dekket(n4)"
                               :disabled="dekket(n4)" @change="kryss(n4)">
                        <span class="tre-kode">{{ n4.kode }}</span>
                        <span class="tre-navn">{{ n4.navn }}</span>
                        <span class="tre-antall">{{ tall(n4.antall) }}</span>
                      </label>
                    </div>
                  </template>
                </template>
              </template>
            </template>
          </template>
        </template>
      </template>
    </div>
  </div>
</template>
