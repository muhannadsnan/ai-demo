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
/**
 * The headline figures, each with the register it comes from rather than a
 * description of what it is. A reader who recognises "Skatteetatens
 * aksjonærregister" learns more from that than from "Aksjonærregisteret", and
 * one who does not now knows which agency to go and check.
 */
const NOKKELTALL = [
  { etikett: 'Foretak',      felt: 'foretak',        kilde: 'Brønnøysundregistrene (Enhetsregisteret)' },
  { etikett: 'Roller',       felt: 'roller',         kilde: 'Brønnøysundregistrene (Enhetsregisteret)' },
  { etikett: 'Aksjeposter',  felt: 'aksjeposter',    kilde: 'Skatteetatens aksjonærregister' },
  { etikett: 'Regnskapsår',  felt: 'regnskapsrader', kilde: 'Brønnøysundregistrene (Regnskapsregisteret)' },
  { etikett: 'Beskrivelser', felt: 'beskrivelser',   kilde: 'Søkbare på mening (OpenAI-embeddinger)' }
] as const

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

/**
 * What holds the platform up, stated with the measurement behind it.
 *
 * Every number here was measured on this dataset rather than estimated — an
 * unsourced claim about performance is worth less than no claim, because the
 * first question is always "compared to what".
 */
const TEKNIKK = [
  {
    tittel: 'Kildene, ikke en kopi av dem',
    hva: 'Åtte importrutiner mot fire offentlige registre. Fullfilene lastes ned på nytt bare når kilden har en nyere versjon, og den daglige jobben leser Brønnøysunds endringsstrøm i stedet for å spørre om alt.',
    tall: '10 rutiner · 4 registre · 7 timere'
  },
  {
    tittel: 'Et avbrudd er ikke et hull',
    hva: 'Importen husker siste hendelse den behandlet. Står maskinen av i en måned, fortsetter neste kjøring fra samme punkt — ingenting hoppes over, ingenting hentes to ganger. Samme kode som en vanlig natt.',
    tall: 'markørbasert gjenopptaking'
  },
  {
    tittel: 'Ventetid er ikke arbeid',
    hva: 'Regnskapshentingen brukte 47 sekunder CPU på 42 minutter — resten var venting på svar. Med åtte forespørsler i luften samtidig gikk hele registeret fra 16,8 timer til 1,4.',
    tall: '7 → 93 foretak i sekundet'
  },
  {
    tittel: 'Feil i kilden, ikke skjult',
    hva: 'Historikkfilen oppgir NOK for alle regnskap. API-et er uenig for over tusen rader i tolv andre valutaer, som ellers ville stått ti ganger for store øverst i enhver rangering. Statussiden viser det i stedet for å pusse det bort.',
    tall: 'tolv valutaer funnet, ikke én'
  },
  {
    tittel: 'Personopplysninger lagres, men vises ikke',
    hva: 'Aksjonærregisteret inneholder privatpersoner. De ligger i en tabell appen aldri leser — visningen går gjennom et view uten navnekolonnene, så en feil i en spørring kan ikke lekke dem.',
    tall: '126.932 skjult for Equinor alene'
  },
  {
    tittel: 'Indekser som er målt, ikke gjettet',
    hva: 'Hvert filter og hver sortering har en indeks bak seg, lagt til fordi en måling viste at den trengtes. Søk uten indeks: 318 ms. Med: 0,2 ms. Semantisk søk uten HNSW: 6,4 sekunder. Med: 68 ms.',
    tall: '66 indekser · 8,1 GB'
  }
] as const

const FUNKSJONER = computed(() => [
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
    merke: 'naturlig språk → filter',
    hva: 'En språkmodell oversetter spørsmålet til et filter over faste felter. Den ser aldri databasen og kan ikke navngi et felt som ikke finnes. Tolkningen vises over resultatene, så du ser hvilket spørsmål som faktisk ble besvart.',
    lenke: { path: '/ai-db-search' },
    eksempel: 'aktive byggefirmaer i Bergen med over 50 ansatte'
  },
  {
    tittel: 'Foretaksprofil',
    hva: 'Alt om ett foretak, fordelt på faner: nøkkeltall, regnskap år for år med endring fra i fjor, styre og ledelse, aksjonærer og datterselskap — og hvor foretaket sitter i eierskapsnettverket. Equinor har 32 datterselskap og 4.658 eiere som selv er foretak.',
    lenke: { path: '/foretak/923609016' },
    eksempel: 'Equinor'
  },
  {
    tittel: 'Topplister',
    hva: 'Rangeringer regnet ut av hele datasettet hver natt, ikke per besøk. Konkurser, regnskap, roller, eierskap og geografi.',
    lenke: { path: '/topplister' },
    eksempel: 'Norges mektigste kvinner'
  },
  {
    tittel: 'Assistent',
    hva: 'Svarer på hvordan norsk foretaksregistrering henger sammen — selskapsformer, roller, regnskap. Den har ikke databasetilgang, og sier det, i stedet for å finne på tall.',
    lenke: { path: '/chat' },
    eksempel: 'Hva er forskjellen på AS, ENK og NUF?'
  },
  {
    tittel: 'Åpen om egen tilstand',
    hva: 'Hver importkjøring logges, også når den feiler. Statussiden viser dekning, kjente feil i kildedataene, og hvor langt vi har kommet i endringsstrømmen.',
    lenke: { path: '/status' },
    eksempel: 'Er dataene ferske akkurat nå?'
  }
])
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
      <label for="forsidesok" class="soketikett">Søk</label>
      <span class="sokeboks">
        <input id="forsidesok" v-model="sok" type="text"
               placeholder="Foretaksnavn eller organisasjonsnummer…" @keydown.enter="gaaTilSok">
        <button v-if="sok" class="tom" type="button" aria-label="Tøm" @click="sok = ''">×</button>
      </span>
      <button @click="gaaTilSok">Søk</button>
    </div>

    <div class="kort-rad">
      <div v-for="k in NOKKELTALL" :key="k.etikett" class="kort">
        <span class="kort-etikett"><i class="ferskprikk" /> {{ k.etikett }}</span>
        <span class="kort-tall">{{ kort(data?.tall[k.felt]) }}</span>
        <span class="kort-kilde">{{ k.kilde }}</span>
      </div>
    </div>

    <h2>Tre måter å søke på</h2>
    <p class="muted avsnitt">
      Forskjellige nivåer av spørring og filtrering som gir bedre treff og
      datadekning. Ekte eksempler følger med.
    </p>
    <div class="maater">
      <NuxtLink v-for="m in SOKEMAATER" :key="m.tittel" :to="m.lenke"
                class="maate" :class="{ fremhevet: m.fremhevet }">
        <span class="maate-tittel">{{ m.tittel }}</span>
        <span class="maate-hva">{{ m.hva }}</span>
        <span class="eksempelblokk">
          <span class="eksempeletikett">Eks.:</span>
          <span class="maate-eksempel">«{{ m.eksempel }}»</span>
        </span>
      </NuxtLink>
    </div>

    <h2>Resten av plattformen</h2>
    <div class="forsidekort">
      <NuxtLink v-for="f in FUNKSJONER" :key="f.tittel" class="inngang" :to="f.lenke">
        <h3>{{ f.tittel }}</h3>
        <span v-if="f.merke" class="inngang-merke">{{ f.merke }}</span>
        <p>{{ f.hva }}</p>
        <span class="eksempelblokk">
          <span class="eksempeletikett">Eks.:</span>
          <span class="inngang-eksempel">«{{ f.eksempel }}»</span>
        </span>
      </NuxtLink>
    </div>

    <h2>Hvordan det er bygget</h2>
    <p class="lede">
      Det som er interessant her er ikke funksjonene, men hva som holder dem
      oppe: hvor dataene kommer fra, hva som skjer når en kilde svarer feil, og
      hvordan systemet tar igjen etter å ha stått stille.
    </p>
    <div class="teknikk">
      <div v-for="t in TEKNIKK" :key="t.tittel" class="teknikkort">
        <h3>{{ t.tittel }}</h3>
        <p>{{ t.hva }}</p>
        <span v-if="t.tall" class="teknikktall">{{ t.tall }}</span>
      </div>
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
.forsidesok { width: 75%; margin: 0 auto 22px; align-items: center; }
.soketikett { font: 500 13px/1 var(--mono); flex: none; }
/* The one input on this page, so it gets a border that says so. Every other
   field on the site sits inside a panel that frames it; this one does not. */
.forsidesok .sokeboks input { border-color: var(--text); }
.forsidesok .sokeboks input:focus { border-color: var(--accent); }
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
/* The example is the clickable promise of the card. Blue text, no chip — the
   filled badge was reading as a button on a card that is already one link. */
.maate-eksempel, .inngang-eksempel {
  color: var(--info); font: 12px/1.5 var(--mono);
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* Quoted and labelled, so the example reads as something you could type rather
   than as a caption describing the card. The label sits on the same line — as
   its own row it took a third line on a card that only needed two. */
.eksempelblokk { margin-top: auto; padding-top: 10px; display: flex; gap: 8px; align-items: baseline; min-width: 0; }
.eksempeletikett {
  flex: none; font: 500 11px/1.5 var(--mono); color: var(--text-dim);
}
.maate-eksempel, .inngang-eksempel { font-weight: 650; min-width: 0; }
.maate { padding-bottom: 14px; }
.maate-eksempel { margin-top: 10px; }

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
.inngang-eksempel { margin-top: 12px; }
.ferskhet p { margin: 0 0 10px; font-size: 13.5px; line-height: 1.6; }
.ferskhet p:last-child { margin-bottom: 0; }
.kildenote { margin-top: 22px; }
</style>
