<script setup lang="ts">
const route = useRoute()
const orgnr = route.params.orgnr as string
const { data: hode } = await useFetch(`/api/foretak/${orgnr}`)
const { data } = await useFetch(`/api/foretak/${orgnr}/eierskap`)
const pst = (v: any) => v == null ? '—' : Number(v).toLocaleString('nb-NO', { maximumFractionDigits: 2 }) + ' %'
const tall = (v: any) => Number(v).toLocaleString('nb-NO')

/**
 * The ownership network loads after the page, like the subsidiaries do: it is
 * two recursive graph walks and most visitors never scroll to it.
 */
const dybde = ref(2)
const { data: nett, status: nettStatus, execute: hentNett } = await useFetch(
  () => `/api/foretak/${orgnr}/nettverk?dybde=${dybde.value}`,
  { lazy: true, immediate: false, watch: false }
)
const nettLaster = computed(() => nettStatus.value !== 'success')
onMounted(() => hentNett())
function settDybde(d: number) { dybde.value = d; hentNett() }

/** Group the nodes by how many steps away they are, for the rendering. */
const nivaer = (noder: any[] | undefined) => {
  const m = new Map<number, any[]>()
  for (const n of noder ?? []) {
    if (!m.has(n.niva)) m.set(n.niva, [])
    m.get(n.niva)!.push(n)
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0])
}
</script>

<template>
  <div v-if="hode">
    <ForetakHeader :foretak="hode.foretak" :antall="hode.antall" />

    <div v-if="!data?.eiere?.length" class="card muted">Ingen aksjonærinformasjon registrert.</div>

    <template v-else>
      <h2>Aksjonærer</h2>

      <!-- The cap is stated before the table, not after it, so nobody reads the
           first 200 rows believing they are all of them. -->
      <div v-if="data.oppsummering.avkortet" class="note-avkortet">
        <strong>Dette foretaket har {{ tall(data.oppsummering.antall_eiere) }} registrerte aksjonærer.</strong>
        Tabellen viser de {{ data.oppsummering.vist }} største eierpostene.
        Eierskap er skjevfordelt — de resterende
        {{ tall(data.oppsummering.antall_eiere - data.oppsummering.vist) }} eier
        små poster hver — og å tegne dem alle tok 3,8 sekunder i nettleseren.
      </div>

      <div v-if="data.oppsummering.personer_skjult" class="note-personvern">
        <strong>{{ data.oppsummering.antall_personeiere }} av {{ data.oppsummering.antall_eiere }} aksjonærer er privatpersoner, og navnene vises ikke.</strong>
        Aksjonærregisteret inneholder personopplysninger, og utleverte data er
        underlagt personopplysningsloven. Eierandelene vises i sin helhet;
        identiteten til privatpersoner gjør det ikke. Foretak som eier aksjer
        vises med navn og organisasjonsnummer — et organisasjonsnummer er ikke
        en personopplysning.
      </div>

      <div class="card">
        <table class="meta">
          <tbody>
            <tr v-for="(e, i) in data.eiere" :key="i">
              <td>
                <template v-if="e.er_person"><span class="anonym">Privatperson</span></template>
                <NuxtLink v-else-if="e.eier_orgnr" :to="`/foretak/${e.eier_orgnr}`">
                  {{ e.eier_foretaksnavn || e.eier_navn }}
                </NuxtLink>
                <template v-else>{{ e.eier_navn || 'Ukjent' }}</template>
                <span class="muted" v-if="e.aksjeklasse && e.aksjeklasse !== 'Ordinære aksjer'"> · {{ e.aksjeklasse }}</span>
              </td>
              <td style="text-align:right; width:34%">
                <strong>{{ pst(e.andel_prosent) }}</strong>
                <span class="muted"> · {{ Number(e.antall_aksjer).toLocaleString('nb-NO') }} aksjer</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <template v-if="data.eierandeler.length">
        <h2>Eierandeler i andre foretak</h2>
        <div class="card">
          <table class="meta">
            <tbody>
              <tr v-for="(e, i) in data.eierandeler" :key="i">
                <td><NuxtLink :to="`/foretak/${e.organisasjonsnummer}`">{{ e.navn || e.organisasjonsnummer }}</NuxtLink></td>
                <td style="text-align:right; width:30%"><strong>{{ pst(e.andel_prosent) }}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <h2>Eierskapsnettverk</h2>
      <p class="lede">
        Foretakene rundt dette, fulgt oppover gjennom hvem som eier det og
        nedover gjennom hva det eier. Bare foretak er noder — privatpersoner er
        med som antall, aldri som navn.
      </p>

      <div class="row" style="gap:8px; margin-bottom:10px">
        <span class="muted">Dybde</span>
        <button v-for="d in [1, 2, 3, 4]" :key="d" class="paginator-tall"
                :class="{ aktiv: dybde === d }" @click="settDybde(d)">{{ d }}</button>
        <span v-if="nett" class="muted" style="margin-left:auto">
          {{ tall(nett.direkte.eiere) }} foretak eier direkte ·
          eier direkte i {{ tall(nett.direkte.eier_i) }}
        </span>
      </div>

      <div v-if="nettLaster" class="laster"><span class="spinner" /> Følger eierskapet…</div>

      <template v-else-if="nett">
        <div class="nett-kolonner">
          <div class="nett-side">
            <h3>Eiere oppover</h3>
            <p v-if="!nett.opp.length" class="muted">Ingen foretak eier aksjer i dette foretaket.</p>
            <div v-for="[niva, noder] in nivaer(nett.opp)" :key="`o${niva}`" class="nett-niva">
              <span class="nett-merkelapp">{{ niva === 1 ? 'Direkte eiere' : `${niva} steg opp` }}</span>
              <NuxtLink v-for="n in noder" :key="n.orgnr" :to="`/foretak/${n.orgnr}`" class="nett-node">
                <span class="nett-andel">{{ pst(n.andel) }}</span>
                <span class="nett-navn">{{ n.navn || n.orgnr }}</span>
                <span v-if="n.konkurs" class="pill bad">Konkurs</span>
              </NuxtLink>
            </div>
            <p v-if="nett.avkortet.opp" class="muted hint">
              Avkortet ved {{ nett.maksNoder }} foretak — de største postene nærmest.
            </p>
          </div>

          <div class="nett-side">
            <h3>Eierskap nedover</h3>
            <p v-if="!nett.ned.length" class="muted">Dette foretaket eier ikke aksjer i andre foretak.</p>
            <div v-for="[niva, noder] in nivaer(nett.ned)" :key="`n${niva}`" class="nett-niva">
              <span class="nett-merkelapp">{{ niva === 1 ? 'Eier direkte' : `${niva} steg ned` }}</span>
              <NuxtLink v-for="n in noder" :key="n.orgnr" :to="`/foretak/${n.orgnr}`" class="nett-node">
                <span class="nett-andel">{{ pst(n.andel) }}</span>
                <span class="nett-navn">{{ n.navn || n.orgnr }}</span>
                <span v-if="n.ansatte" class="muted">{{ n.ansatte }} ans.</span>
                <span v-if="n.konkurs" class="pill bad">Konkurs</span>
              </NuxtLink>
            </div>
            <p v-if="nett.avkortet.ned" class="muted hint">
              Avkortet ved {{ nett.maksNoder }} foretak — de største postene nærmest.
            </p>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
