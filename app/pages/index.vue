<script setup lang="ts">
import { kort, nb } from "~/utils/tall"

useHead({ title: 'Norske foretak — data fra offentlige registre' })

const { data } = await useFetch('/api/oversikt', { lazy: true })
const router = useRouter()
const sok = ref('')

function gaaTilSok() {
  const q = sok.value.trim()
  router.push({ path: '/foretak', query: q ? { q, aktive: 'true' } : {} })
}

/**
 * Every example below is a real link into the real search.
 *
 * A front page that describes its features is a brochure; one where every claim
 * is a query you can click and check is the feature itself. These are chosen
 * because each shows something the others cannot do — that is the point of
 * having three ways to search rather than one.
 */
const SOKEMAATER = [
  {
    tittel: 'Navn eller organisasjonsnummer',
    hva: 'Det vanlige søket. Tåler skrivefeil, fordi det sammenligner bokstavtrillinger i stedet for hele ord.',
    eksempel: 'equinor',
    lenke: { path: '/foretak', query: { q: 'equinor' } }
  },
  {
    tittel: 'Hva foretaket driver med',
    hva: 'Søker i beskrivelsene foretakene har skrevet om seg selv. Finner virksomheter som ikke røper noe i navnet.',
    eksempel: 'hundepensjonat',
    lenke: { path: '/foretak', query: { gjor: 'hundepensjonat' } }
  },
  {
    tittel: 'Beskriv det med egne ord',
    hva: 'Sammenligner mening i stedet for ord. Treffer foretak som aldri skrev noen av ordene du søkte på.',
    eksempel: 'folk som passer hunder',
    lenke: { path: '/foretak', query: { gjor: 'folk som passer hunder', semantisk: 'true' } },
    fremhevet: true
  }
]

const FUNKSJONER = [
  {
    tittel: 'Filtrer på det som betyr noe',
    hva: 'Fylke og kommune, næring i fire nivåer, antall ansatte og fem regnskapsstørrelser. Filtrene kombineres, og hvert aktivt filter kan fjernes for seg.',
    lenke: { path: '/foretak', query: { fylke: '03', nace: 'F', ansatte: '50' } },
    eksempel: 'byggefirmaer i Oslo med over 50 ansatte'
  },
  {
    tittel: 'Spør med en setning',
    // Named for what it does rather than for the technique. The category is
    // usually called text-to-SQL, and this deliberately is not that — the model
    // produces a filter over a fixed vocabulary and never writes a query — so
    // borrowing the label would advertise the exact thing the design avoids.
    merke: 'naturlig språk → filter, ikke SQL',
    hva: 'En språkmodell oversetter spørsmålet til et filter over faste felter. Den ser aldri databasen og kan ikke navngi et felt som ikke finnes. Tolkningen vises over resultatene, så du ser hvilket spørsmål som faktisk ble besvart.',
    lenke: { path: '/ai-db-search' },
    eksempel: '«aktive byggefirmaer i Bergen med over 50 ansatte»'
  },
  {
    tittel: 'Foretaksprofil',
    hva: 'Alt om ett foretak, fordelt på faner: nøkkeltall, regnskap år for år med endring fra i fjor, styre og ledelse, aksjonærer og datterselskap — og hvor foretaket sitter i eierskapsnettverket, oppover og nedover.',
    lenke: { path: '/foretak/923609016' },
    eksempel: 'Equinor: 32 datterselskap, 4.658 eiere'
  },
  {
    tittel: 'Topplister',
    hva: 'Rangeringer regnet ut av hele datasettet hver natt, ikke per besøk. Konkurser, regnskap, roller, eierskap og geografi.',
    lenke: { path: '/topplister' },
    eksempel: `${data.value?.lister?.length ?? 21} lister, oppdatert i natt`
  },
  {
    tittel: 'Assistent',
    hva: 'Svarer på hvordan norsk foretaksregistrering henger sammen — selskapsformer, roller, regnskap. Den har ikke databasetilgang, og sier det, i stedet for å finne på tall.',
    lenke: { path: '/chat' },
    eksempel: '«Hva er forskjellen på AS, ENK og NUF?»'
  },
  {
    tittel: 'Åpen om egen tilstand',
    hva: 'Hver importkjøring logges, også når den feiler. Statussiden viser dekning, kjente feil i kildedataene, og hvor langt vi har kommet i endringsstrømmen.',
    lenke: { path: '/status' },
    eksempel: 'siste kjøring, dekning og datakvalitet'
  }
]
</script>

<template>
  <div>
    <h1>Norske foretak</h1>
    <p class="lede">
      Alle foretak i Enhetsregisteret, med roller, eierskap og regnskap, samlet
      fra Brønnøysundregistrene og Skatteetaten og oppdatert automatisk hver
      natt.
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
        <span class="kort-tall">{{ kort(data?.tall.foretak) }}</span>
        <span class="kort-enhet">Enhetsregisteret</span></div>
      <div class="kort"><span class="kort-etikett">Roller</span>
        <span class="kort-tall">{{ kort(data?.tall.roller) }}</span>
        <span class="kort-enhet">styre og ledelse</span></div>
      <div class="kort"><span class="kort-etikett">Aksjeposter</span>
        <span class="kort-tall">{{ kort(data?.tall.aksjeposter) }}</span>
        <span class="kort-enhet">Aksjonærregisteret</span></div>
      <div class="kort"><span class="kort-etikett">Regnskapsår</span>
        <span class="kort-tall">{{ kort(data?.tall.regnskapsrader) }}</span>
        <span class="kort-enhet">innsendte tall</span></div>
      <div class="kort"><span class="kort-etikett">Beskrivelser</span>
        <span class="kort-tall">{{ kort(data?.tall.beskrivelser) }}</span>
        <span class="kort-enhet">søkbare på mening</span></div>
    </div>

    <h2>Tre måter å søke på</h2>
    <p class="muted avsnitt">
      Hver av dem finner noe de andre ikke finner. Eksemplene er ekte søk — trykk
      på dem.
    </p>
    <div class="maater">
      <NuxtLink v-for="m in SOKEMAATER" :key="m.tittel" :to="m.lenke"
                class="maate" :class="{ fremhevet: m.fremhevet }">
        <span class="maate-tittel">{{ m.tittel }}</span>
        <span class="maate-hva">{{ m.hva }}</span>
        <span class="maate-eksempel">{{ m.eksempel }} →</span>
      </NuxtLink>
    </div>

    <h2>Og videre</h2>
    <div class="forsidekort">
      <NuxtLink v-for="f in FUNKSJONER" :key="f.tittel" class="inngang" :to="f.lenke">
        <h3>{{ f.tittel }}</h3>
        <span v-if="f.merke" class="inngang-merke">{{ f.merke }}</span>
        <p>{{ f.hva }}</p>
        <span class="inngang-eksempel">{{ f.eksempel }} →</span>
      </NuxtLink>
    </div>

    <h2>Hvordan dataene holdes ferske</h2>
    <div class="card ferskhet">
      <p>
        Den daglige importen leser Brønnøysunds endringsstrøm og husker hvor den
        slapp, som en <strong>markør</strong> i strømmen. Står maskinen stille i
        en måned, fortsetter neste kjøring fra samme punkt og henter alt som
        skjedde i mellomtiden — ingenting hoppes over, og ingenting hentes to
        ganger.
      </p>
      <p class="muted">
        Regnskap hentes for foretak registeret sier har sendt inn et år vi ikke
        har, i stedet for å spørre om alle på nytt. Topplister og meningssøk
        regnes ut på nytt hver natt.
        <NuxtLink to="/status">Se siste kjøring →</NuxtLink>
      </p>
    </div>

    <p class="muted kildenote">
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

.maater { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); }
.maate {
  display: flex; flex-direction: column; gap: 6px;
  padding: 14px 16px; text-decoration: none; color: inherit;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); transition: border-color .12s ease;
}
.maate:hover { border-color: var(--accent); }
/* The semantic search is the one worth pointing at: it is the only one that
   finds a company which used none of the words. */
.maate.fremhevet { border-color: var(--accent); background: var(--accent-soft); }
.maate-tittel { font-weight: 650; font-size: 14px; }
.maate-hva { font-size: 12.5px; color: var(--text-dim); line-height: 1.55; }
.maate-eksempel {
  margin-top: auto; padding-top: 8px;
  font: 12px/1.4 var(--mono); color: var(--accent);
}

.forsidekort {
  display: grid; gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}
.inngang {
  display: flex; flex-direction: column; padding: 14px 16px;
  text-decoration: none; color: inherit;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); transition: border-color .12s ease;
}
.inngang:hover { border-color: var(--accent); }
.inngang h3 { font-size: 15px; margin: 0 0 2px; color: var(--accent); }
.inngang-merke {
  display: block; margin-bottom: 6px;
  font: 11px/1.4 var(--mono); color: var(--text-dim);
}
.inngang p { font-size: 12.5px; color: var(--text-dim); margin: 0; line-height: 1.55; }
.inngang-eksempel {
  margin-top: auto; padding-top: 10px;
  font: 12px/1.4 var(--mono); color: var(--text-dim);
}
.ferskhet p { margin: 0 0 10px; font-size: 13.5px; line-height: 1.6; }
.ferskhet p:last-child { margin-bottom: 0; }
.kildenote { margin-top: 22px; }
</style>
