/**
 * What each table and each import job actually IS, in words.
 *
 * The database names are Norwegian register vocabulary — `enheter`,
 * `oppdateringer`, `roller` — which is precise and completely opaque to anyone
 * meeting the platform for the first time. Worse, two of them look like the
 * same thing: `enheter` is the weekly full file and `oppdateringer` is the
 * daily change feed, and BOTH write to the same table.
 *
 * So this is the one place that maps a name to a plain description and to the
 * public register it comes from. The status page reads it; nothing else has to
 * know.
 */

export interface Datasett {
  tittel: string
  hva: string
  kilde: string
}

/** Tables, as they appear in the content listing. */
export const TABELLER: Record<string, Datasett> = {
  enheter: {
    tittel: 'Foretak',
    hva: 'Alle registrerte foretak: navn, organisasjonsform, næring, adresse, ansatte og status.',
    kilde: 'Enhetsregisteret'
  },
  roller: {
    tittel: 'Roller',
    hva: 'Hvem som sitter i styret, er daglig leder, revisor eller regnskapsfører.',
    kilde: 'Enhetsregisteret'
  },
  roller_historikk: {
    tittel: 'Tidligere roller',
    hva: 'Roller som har opphørt, tatt vare på så et foretaks historikk ikke forsvinner.',
    kilde: 'Enhetsregisteret'
  },
  regnskap: {
    tittel: 'Årsregnskap',
    hva: 'Innsendte regnskapstall per år: driftsinntekter, resultat, eiendeler, egenkapital og gjeld.',
    kilde: 'Regnskapsregisteret'
  },
  aksjonar: {
    tittel: 'Aksjonærer',
    hva: 'Hvem som eier aksjer i hvilke foretak, og hvor stor andel. Privatpersoner telles, men navngis ikke.',
    kilde: 'Skatteetatens aksjonærregister'
  },
  naeringskoder: {
    tittel: 'Næringskoder',
    hva: 'Bransjeinndelingen i fem nivåer, som søket filtrerer på.',
    kilde: 'SSB (NACE)'
  },
  kommuner: {
    tittel: 'Kommuner',
    hva: 'Kommunenummer og navn, brukt til å slå opp sted i søket.',
    kilde: 'SSB'
  },
  fylker: {
    tittel: 'Fylker',
    hva: 'Fylkesnummer og navn, brukt til å slå opp sted i søket.',
    kilde: 'SSB'
  },
  postnummer: {
    tittel: 'Postnummer',
    hva: 'Postnummer og poststed.',
    kilde: 'Bring'
  }
}

/** Import jobs, as they appear in the run listing. */
export const JOBBER: Record<string, Datasett> = {
  oppdateringer: {
    tittel: 'Daglige endringer i foretak',
    hva: 'Leser Brønnøysunds endringsstrøm — en logg over hvilke foretak som er endret — og henter bare de foretakene. Skriver til samme tabell som den ukentlige fullfilen, men henter noen tusen i stedet for 1,2 millioner.',
    kilde: 'Enhetsregisteret · endringsstrøm'
  },
  enheter: {
    tittel: 'Full foretaksfil',
    hva: 'Hele registeret som én fil. Fanger opp alt endringsstrømmen måtte ha gått glipp av, og avgjør hvilke foretak som er slettet.',
    kilde: 'Enhetsregisteret · nedlastbar fil'
  },
  roller: {
    tittel: 'Full rollefil',
    hva: 'Alle roller på nytt. Roller som er borte siden sist arkiveres i stedet for å slettes.',
    kilde: 'Enhetsregisteret · nedlastbar fil'
  },
  regnskap: {
    tittel: 'Nye årsregnskap',
    hva: 'Henter regnskap for foretak som ifølge registeret har sendt inn et år vi ikke har. Rolig mesteparten av året, travelt fra april til juli når fristen nærmer seg.',
    kilde: 'Regnskapsregisteret · API'
  },
  referansedata: {
    tittel: 'Oppslagsdata',
    hva: 'Kommuner, fylker, næringskoder og postnummer.',
    kilde: 'SSB og Bring'
  },
  fornavn: {
    tittel: 'Fornavn og kjønn',
    hva: 'SSBs navnestatistikk, brukt til å anslå kjønnsfordeling blant daglige ledere. Et anslag utledet av fornavn, ikke en registrert opplysning.',
    kilde: 'SSB tabell 10501'
  },
  topplister: {
    tittel: 'Topplister',
    hva: 'Regner ut rangeringene på /topplister av hele datasettet, så sidene leser ferdige tall i stedet for å aggregere per besøk.',
    kilde: 'Utledet av våre egne data'
  },
  embedding: {
    tittel: 'Meningssøk',
    hva: 'Gjør foretakenes egne beskrivelser om til tall som kan sammenlignes på mening, slik at søket finner virksomheter som aldri skrev ordene du søkte på.',
    kilde: 'OpenAI text-embedding-3-small'
  }
}

export const beskrivTabell = (navn: string): Datasett =>
  TABELLER[navn] ?? { tittel: navn, hva: '', kilde: '' }
export const beskrivJobb = (navn: string): Datasett =>
  JOBBER[navn] ?? { tittel: navn, hva: '', kilde: '' }
