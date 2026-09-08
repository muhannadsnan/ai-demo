<script setup lang="ts">
import { kort } from "~/utils/tall"
useHead({ title: 'Norske foretak — data fra offentlige registre' })

const { data } = await useFetch('/api/oversikt', { lazy: true })
const router = useRouter()
const sok = ref('')

function gaaTilSok() {
  const q = sok.value.trim()
  router.push({ path: '/foretak', query: q ? { q, aktive: 'true' } : {} })
}

const mill = kort
</script>

<template>
  <div>
    <h1>Norske foretak</h1>
    <p class="lede">
      Alle foretak i Enhetsregisteret, med roller, eierskap og regnskap, samlet
      fra Brønnøysundregistrene og Skatteetaten og oppdatert automatisk hver
      natt. Søk på navn, på organisasjonsnummer, eller på hva et foretak
      faktisk driver med.
    </p>

    <div class="sokefelt forsidesok">
      <span class="sokeboks">
        <input v-model="sok" type="text"
               placeholder="Foretaksnavn eller organisasjonsnummer…" @keydown.enter="gaaTilSok">
        <button v-if="sok" class="tom" type="button" aria-label="Tøm" @click="sok = ''">×</button>
      </span>
      <button @click="gaaTilSok">Søk</button>
    </div>

    <div class="kort-rad">
      <div class="kort"><span class="kort-etikett">Foretak</span>
        <span class="kort-tall">{{ mill(data?.tall.foretak) }}</span>
        <span class="kort-enhet">Enhetsregisteret</span></div>
      <div class="kort"><span class="kort-etikett">Roller</span>
        <span class="kort-tall">{{ mill(data?.tall.roller) }}</span>
        <span class="kort-enhet">styre og ledelse</span></div>
      <div class="kort"><span class="kort-etikett">Aksjeposter</span>
        <span class="kort-tall">{{ mill(data?.tall.aksjeposter) }}</span>
        <span class="kort-enhet">Aksjonærregisteret</span></div>
      <div class="kort"><span class="kort-etikett">Regnskapsår</span>
        <span class="kort-tall">{{ mill(data?.tall.regnskapsrader) }}</span>
        <span class="kort-enhet">innsendte tall</span></div>
    </div>

    <div class="forsidekort">
      <NuxtLink class="inngang" to="/foretak">
        <h2>Søk og filtrer</h2>
        <p>Fylke, kommune, næring i fire nivåer, antall ansatte og fem
           regnskapsstørrelser — eller beskriv hva du leter etter og la søket
           finne foretak som aldri skrev de ordene.</p>
      </NuxtLink>

      <NuxtLink class="inngang" to="/ai-db-search">
        <h2>Spør med egne ord</h2>
        <p>«Aktive byggefirmaer i Bergen med over 50 ansatte». En språkmodell
           oversetter setningen til et filter — ikke til SQL — og tolkningen
           vises over resultatene så du ser hva som faktisk ble spurt om.</p>
      </NuxtLink>

      <NuxtLink class="inngang" to="/topplister">
        <h2>Topplister</h2>
        <p>Rangeringer regnet ut av hele datasettet hver natt.</p>
        <ul class="inngang-liste">
          <li v-for="l in data?.lister ?? []" :key="l.type">
            <span class="inngang-tittel">{{ l.tittel }}</span>
            <span class="inngang-topp">{{ l.topp }}</span>
          </li>
        </ul>
      </NuxtLink>

      <NuxtLink class="inngang" to="/status">
        <h2>Hvordan dataene holdes ferske</h2>
        <p>Den daglige importen leser Brønnøysunds endringsstrøm og husker hvor
           den slapp, som en <strong>markør</strong> i strømmen. Står maskinen
           stille i en måned, fortsetter neste kjøring fra samme punkt og henter
           alt som skjedde i mellomtiden — ingenting hoppes over, og ingenting
           hentes to ganger. Hver kjøring logges, så det er synlig når hver
           kilde sist ble oppdatert og om den feilet.</p>
      </NuxtLink>
    </div>

    <p class="muted" style="margin-top:22px">
      Kildene er offentlige og gjengis under NLOD. Personopplysninger fra
      Aksjonærregisteret lagres, men vises ikke.
    </p>
  </div>
</template>

<style scoped>
/* Not full width: a single input stretched across 1180px reads as a form field,
   not as the thing the page is for. */
.forsidesok { width: 75%; margin: 0 auto 22px; }
@media (max-width: 700px) { .forsidesok { width: 100%; } }

.forsidekort {
  display: grid; gap: 12px; margin-top: 22px;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}
.inngang {
  display: block; padding: 14px 16px; text-decoration: none; color: inherit;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); transition: border-color .12s ease;
}
.inngang:hover { border-color: var(--accent); }
.inngang h2 { font-size: 15px; margin: 0 0 6px; color: var(--accent); }
.inngang p { font-size: 13px; color: var(--text-dim); margin: 0; line-height: 1.55; }
.inngang-liste { list-style: none; margin: 10px 0 0; padding: 0; }
.inngang-liste li {
  display: flex; gap: 8px; justify-content: space-between; align-items: baseline;
  font-size: 12.5px; padding: 2px 0; min-width: 0;
}
.inngang-tittel { color: var(--text-dim); flex: none; }
.inngang-topp {
  color: var(--text); text-align: right; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
</style>
