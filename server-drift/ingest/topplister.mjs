/**
 * The accounts lists all rank on "the newest annual accounts per company".
 *
 * That used to be two DISTINCT ON passes over 4.96 million rows inside every
 * list, which cost 8.4 seconds each. It is now the `regnskap_siste`
 * materialised view (migration 026), refreshed by the same nightly job that
 * runs these lists, so a list is a scan of 448,599 rows with an index on the
 * column it sorts by.
 *
 * `rimelig` is the plausibility flag described in that migration: it drops the
 * handful of filings each year that are reported in kroner where the file is in
 * thousands, which are harmless in aggregate and own the top of any ranking.
 */
export const REGNSKAP_CTE = `
  rimelig AS (SELECT * FROM regnskap_siste WHERE rimelig)
`

/**
 * The list definitions. Kept apart from the generator so adding a list is
 * adding an entry here, not editing a script.
 *
 * `kolonner` drives rendering: the page has no per-list template, it reads the
 * column definitions and formats accordingly. A new list therefore needs no
 * front-end work at all.
 *
 * Formats: tekst | tall | belop (thousands) | prosent | dato | orgnr | lenke
 */
export const LISTER = [
  // ---- status ------------------------------------------------------------
  {
    type: 'siste-konkurser', kategori: 'Status',
    tittel: 'Siste konkurser',
    beskrivelse: 'Foretak som nylig er registrert konkurs, nyeste først.',
    kolonner: [
      { felt: 'navn', tittel: 'Foretak', format: 'lenke' },
      { felt: 'konkursdato', tittel: 'Konkursdato', format: 'dato' },
      { felt: 'ansatte', tittel: 'Ansatte', format: 'tall' },
      { felt: 'sted', tittel: 'Sted', format: 'tekst' }
    ],
    sql: `SELECT e.organisasjonsnummer, e.navn, e.konkursdato,
                 nullif(e.antall_ansatte,0) AS ansatte,
                 e.forretningsadresse_poststed AS sted
          FROM enheter e
          WHERE e.konkurs AND e.konkursdato IS NOT NULL
          ORDER BY e.konkursdato DESC, e.antall_ansatte DESC NULLS LAST
          LIMIT 50`
  },
  {
    type: 'siste-nyetablerte', kategori: 'Status',
    tittel: 'Nyetablerte foretak',
    beskrivelse: 'Registrert i Enhetsregisteret de siste 30 dagene.',
    kolonner: [
      { felt: 'navn', tittel: 'Foretak', format: 'lenke' },
      { felt: 'registrert', tittel: 'Registrert', format: 'dato' },
      { felt: 'form', tittel: 'Form', format: 'tekst' },
      { felt: 'naering', tittel: 'Næring', format: 'tekst' },
      { felt: 'sted', tittel: 'Sted', format: 'tekst' }
    ],
    sql: `SELECT e.organisasjonsnummer, e.navn,
                 e.registreringsdato_enhetsregisteret AS registrert,
                 e.organisasjonsform_kode AS form,
                 e.naeringskode1_beskrivelse AS naering,
                 e.forretningsadresse_poststed AS sted
          FROM enheter e
          WHERE e.registreringsdato_enhetsregisteret >= current_date - 30
            AND e.slettet_dato IS NULL
          ORDER BY e.registreringsdato_enhetsregisteret DESC, e.navn
          LIMIT 50`
  },

  // ---- regnskap ----------------------------------------------------------
  {
    type: 'storst-omsetning', kategori: 'Regnskap',
    tittel: 'Størst omsetning',
    beskrivelse: 'Høyest driftsinntekter i siste tilgjengelige regnskapsår. Kun NOK.',
    kolonner: [
      { felt: 'navn', tittel: 'Foretak', format: 'lenke' },
      { felt: 'omsetning', tittel: 'Driftsinntekter', format: 'belop' },
      { felt: 'resultat', tittel: 'Årsresultat', format: 'belop' },
      { felt: 'aar', tittel: 'År', format: 'tekst' }
    ],
    sql: `WITH ${REGNSKAP_CTE} SELECT e.organisasjonsnummer, e.navn, r.sum_driftsinntekter AS omsetning,
                 r.aarsresultat AS resultat, r.aar::text AS aar
          FROM rimelig r JOIN enheter e USING (organisasjonsnummer)
          WHERE e.slettet_dato IS NULL
          ORDER BY r.sum_driftsinntekter DESC NULLS LAST LIMIT 50`
  },
  {
    type: 'storst-overskudd', kategori: 'Regnskap',
    tittel: 'Størst overskudd',
    beskrivelse: 'Høyest årsresultat i siste regnskapsår. Kun NOK.',
    kolonner: [
      { felt: 'navn', tittel: 'Foretak', format: 'lenke' },
      { felt: 'resultat', tittel: 'Årsresultat', format: 'belop' },
      { felt: 'omsetning', tittel: 'Driftsinntekter', format: 'belop' },
      { felt: 'aar', tittel: 'År', format: 'tekst' }
    ],
    sql: `WITH ${REGNSKAP_CTE} SELECT e.organisasjonsnummer, e.navn, r.aarsresultat AS resultat,
                 r.sum_driftsinntekter AS omsetning, r.aar::text AS aar
          FROM rimelig r JOIN enheter e USING (organisasjonsnummer)
          WHERE e.slettet_dato IS NULL
          ORDER BY r.aarsresultat DESC NULLS LAST LIMIT 50`
  },
  {
    type: 'storst-underskudd', kategori: 'Regnskap',
    tittel: 'Størst underskudd',
    beskrivelse: 'Lavest årsresultat i siste regnskapsår. Kun NOK.',
    kolonner: [
      { felt: 'navn', tittel: 'Foretak', format: 'lenke' },
      { felt: 'resultat', tittel: 'Årsresultat', format: 'belop' },
      { felt: 'omsetning', tittel: 'Driftsinntekter', format: 'belop' },
      { felt: 'aar', tittel: 'År', format: 'tekst' }
    ],
    sql: `WITH ${REGNSKAP_CTE} SELECT e.organisasjonsnummer, e.navn, r.aarsresultat AS resultat,
                 r.sum_driftsinntekter AS omsetning, r.aar::text AS aar
          FROM rimelig r JOIN enheter e USING (organisasjonsnummer)
          WHERE e.slettet_dato IS NULL
          ORDER BY r.aarsresultat ASC NULLS LAST LIMIT 50`
  },
  {
    type: 'storst-vekst', kategori: 'Regnskap',
    tittel: 'Størst vekst i omsetning',
    beskrivelse: 'Prosentvis vekst mellom de to siste regnskapsårene, fra minst 10 mill. Filinger som hopper mer enn 50x er utelatt — de er nesten alltid feil målestokk, ikke vekst.',
    kolonner: [
      { felt: 'navn', tittel: 'Foretak', format: 'lenke' },
      { felt: 'vekst', tittel: 'Vekst', format: 'prosent' },
      { felt: 'fra', tittel: 'Fra', format: 'belop' },
      { felt: 'til', tittel: 'Til', format: 'belop' }
    ],
    sql: `WITH ${REGNSKAP_CTE} SELECT e.organisasjonsnummer, e.navn,
                 r.forrige_inntekter AS fra, r.sum_driftsinntekter AS til,
                 r.vekst_prosent AS vekst
          FROM rimelig r JOIN enheter e USING (organisasjonsnummer)
          WHERE e.slettet_dato IS NULL AND r.forrige_inntekter >= 10000000
            AND r.sum_driftsinntekter > r.forrige_inntekter
          ORDER BY (r.sum_driftsinntekter - r.forrige_inntekter)/r.forrige_inntekter DESC LIMIT 50`
  },
  {
    type: 'storst-fall', kategori: 'Regnskap',
    tittel: 'Størst fall i omsetning',
    beskrivelse: 'Prosentvis nedgang mellom de to siste regnskapsårene, fra minst 10 mill.',
    kolonner: [
      { felt: 'navn', tittel: 'Foretak', format: 'lenke' },
      { felt: 'vekst', tittel: 'Endring', format: 'prosent' },
      { felt: 'fra', tittel: 'Fra', format: 'belop' },
      { felt: 'til', tittel: 'Til', format: 'belop' }
    ],
    sql: `WITH ${REGNSKAP_CTE} SELECT e.organisasjonsnummer, e.navn,
                 r.forrige_inntekter AS fra, r.sum_driftsinntekter AS til,
                 r.vekst_prosent AS vekst
          FROM rimelig r JOIN enheter e USING (organisasjonsnummer)
          WHERE e.slettet_dato IS NULL AND r.forrige_inntekter >= 10000000
            AND r.sum_driftsinntekter < r.forrige_inntekter
            AND r.sum_driftsinntekter >= 0
          ORDER BY (r.sum_driftsinntekter - r.forrige_inntekter)/r.forrige_inntekter ASC,
                   r.forrige_inntekter DESC LIMIT 50`
  },
  {
    type: 'negativ-egenkapital', kategori: 'Regnskap',
    tittel: 'Negativ egenkapital',
    beskrivelse: 'Foretak med negativ egenkapital i siste regnskap — et av de tydeligste faresignalene i offentlige tall.',
    kolonner: [
      { felt: 'navn', tittel: 'Foretak', format: 'lenke' },
      { felt: 'egenkapital', tittel: 'Egenkapital', format: 'belop' },
      { felt: 'gjeld', tittel: 'Gjeld', format: 'belop' },
      { felt: 'ansatte', tittel: 'Ansatte', format: 'tall' }
    ],
    sql: `WITH ${REGNSKAP_CTE} SELECT e.organisasjonsnummer, e.navn, r.sum_egenkapital AS egenkapital,
                 r.sum_gjeld AS gjeld, nullif(e.antall_ansatte,0) AS ansatte
          FROM rimelig r JOIN enheter e USING (organisasjonsnummer)
          WHERE r.sum_egenkapital < 0 AND NOT e.konkurs AND e.slettet_dato IS NULL
          ORDER BY r.sum_egenkapital ASC LIMIT 50`
  },
  {
    type: 'hoyest-aksjekapital', kategori: 'Regnskap',
    tittel: 'Høyest aksjekapital',
    beskrivelse: 'Registrert aksjekapital i Enhetsregisteret.',
    kolonner: [
      { felt: 'navn', tittel: 'Foretak', format: 'lenke' },
      { felt: 'kapital', tittel: 'Aksjekapital', format: 'belop' },
      { felt: 'form', tittel: 'Form', format: 'tekst' },
      { felt: 'sted', tittel: 'Sted', format: 'tekst' }
    ],
    sql: `SELECT organisasjonsnummer, navn, kapital_belop AS kapital,
                 organisasjonsform_kode AS form, forretningsadresse_poststed AS sted
          FROM enheter WHERE kapital_belop IS NOT NULL AND kapital_valuta='NOK' AND slettet_dato IS NULL
          ORDER BY kapital_belop DESC LIMIT 50`
  },
  {
    type: 'resultat-per-ansatt', kategori: 'Regnskap',
    tittel: 'Høyest resultat per ansatt',
    beskrivelse: 'Årsresultat delt på antall ansatte, for foretak med minst 20 ansatte.',
    kolonner: [
      { felt: 'navn', tittel: 'Foretak', format: 'lenke' },
      { felt: 'per_ansatt', tittel: 'Per ansatt', format: 'belop' },
      { felt: 'resultat', tittel: 'Årsresultat', format: 'belop' },
      { felt: 'ansatte', tittel: 'Ansatte', format: 'tall' }
    ],
    sql: `WITH ${REGNSKAP_CTE} SELECT e.organisasjonsnummer, e.navn, e.antall_ansatte AS ansatte,
                 r.aarsresultat AS resultat,
                 round(r.aarsresultat / e.antall_ansatte) AS per_ansatt
          FROM rimelig r JOIN enheter e USING (organisasjonsnummer)
          WHERE e.antall_ansatte >= 20 AND r.aarsresultat > 0 AND e.slettet_dato IS NULL
          ORDER BY r.aarsresultat / e.antall_ansatte DESC LIMIT 50`
  },

  // ---- roller og mennesker -----------------------------------------------
  {
    type: 'kvinner-daglig-leder', kategori: 'Roller',
    tittel: 'Størst med kvinnelig daglig leder',
    beskrivelse: 'De største foretakene der daglig leder har et fornavn SSB registrerer som jentenavn. Kjønn er utledet fra fornavn, ikke en registrert opplysning.',
    kolonner: [
      { felt: 'navn', tittel: 'Foretak', format: 'lenke' },
      { felt: 'leder', tittel: 'Daglig leder', format: 'tekst' },
      { felt: 'ansatte', tittel: 'Ansatte', format: 'tall' },
      { felt: 'sted', tittel: 'Sted', format: 'tekst' }
    ],
    sql: `SELECT * FROM (
            SELECT DISTINCT ON (e.organisasjonsnummer)
                   e.organisasjonsnummer, e.navn,
                   r.person_fornavn || ' ' || r.person_etternavn AS leder,
                   e.antall_ansatte AS ansatte, e.forretningsadresse_poststed AS sted
            FROM roller r
            JOIN fornavn_kjonn f ON f.fornavn = upper(split_part(r.person_fornavn,' ',1)) AND f.kjonn = 'K'
            JOIN enheter e USING (organisasjonsnummer)
            WHERE r.rolletype_kode = 'DAGL' AND NOT r.avregistrert
              AND e.slettet_dato IS NULL AND e.antall_ansatte IS NOT NULL
            ORDER BY e.organisasjonsnummer, r.rekkefolge
          ) s ORDER BY ansatte DESC LIMIT 50`
  },
  {
    type: 'kvinneandel-fylke', kategori: 'Roller',
    tittel: 'Kvinneandel blant daglige ledere, etter fylke',
    beskrivelse: 'Andel daglige ledere med jentenavn, per fylke. Kjønn er utledet fra fornavn.',
    kolonner: [
      { felt: 'fylke', tittel: 'Fylke', format: 'tekst' },
      { felt: 'andel', tittel: 'Kvinneandel', format: 'prosent' },
      { felt: 'kvinner', tittel: 'Kvinner', format: 'tall' },
      { felt: 'totalt', tittel: 'Totalt', format: 'tall' }
    ],
    sql: `SELECT fy.navn AS fylke,
                 count(*) FILTER (WHERE f.kjonn='K') AS kvinner,
                 count(*) AS totalt,
                 round(100.0*count(*) FILTER (WHERE f.kjonn='K')/count(*), 1) AS andel
          FROM roller r
          JOIN fornavn_kjonn f ON f.fornavn = upper(split_part(r.person_fornavn,' ',1)) AND f.kjonn IN ('K','M')
          JOIN enheter e USING (organisasjonsnummer)
          JOIN kommuner k ON k.kommunenummer = e.forretningsadresse_kommunenummer
          JOIN fylker fy ON fy.fylkesnummer = k.fylkesnummer
          WHERE r.rolletype_kode='DAGL' AND NOT r.avregistrert AND e.slettet_dato IS NULL
          GROUP BY fy.navn HAVING count(*) > 500
          ORDER BY andel DESC`
  },
  {
    type: 'flest-styreverv', kategori: 'Roller',
    tittel: 'Flest styreverv',
    beskrivelse: 'Personer med flest aktive styreverv. Identifisert på fornavn, etternavn og fødselsdato.',
    kolonner: [
      { felt: 'person', tittel: 'Person', format: 'tekst' },
      { felt: 'verv', tittel: 'Styreverv', format: 'tall' }
    ],
    sql: `SELECT max(person_fornavn || ' ' || person_etternavn) AS person,
                 count(DISTINCT organisasjonsnummer) AS verv
          FROM roller
          WHERE rollegruppe_kode='STYR' AND NOT avregistrert AND person_etternavn IS NOT NULL
          GROUP BY person_fornavn, person_etternavn, person_fodselsdato
          ORDER BY verv DESC LIMIT 50`
  },
  {
    type: 'flest-datterselskap', kategori: 'Eierskap',
    tittel: 'Flest datterselskap',
    beskrivelse: 'Foretak som eier mer enn 50 % av andre foretak, regnet fra aksjonærregisteret.',
    kolonner: [
      { felt: 'navn', tittel: 'Morselskap', format: 'lenke' },
      { felt: 'datterselskap', tittel: 'Datterselskap', format: 'tall' },
      { felt: 'sted', tittel: 'Sted', format: 'tekst' }
    ],
    sql: `WITH eierandel AS (
            SELECT eier_orgnr, organisasjonsnummer, sum(andel_prosent) AS andel
            FROM aksjonar
            WHERE eier_orgnr IS NOT NULL AND regnskapsaar = (SELECT max(regnskapsaar) FROM aksjonar)
            GROUP BY 1, 2)
          SELECT ea.eier_orgnr AS organisasjonsnummer,
                 coalesce(e.navn, '(ukjent)') AS navn,
                 count(*) AS datterselskap,
                 e.forretningsadresse_poststed AS sted
          FROM eierandel ea LEFT JOIN enheter e ON e.organisasjonsnummer = ea.eier_orgnr
          WHERE ea.andel > 50
          GROUP BY 1, 2, 4 ORDER BY datterselskap DESC LIMIT 50`
  },
  {
    type: 'eldste-foretak', kategori: 'Status',
    tittel: 'Eldste aktive foretak',
    beskrivelse: 'Foretak med tidligste stiftelsesdato som fortsatt er aktive.',
    kolonner: [
      { felt: 'navn', tittel: 'Foretak', format: 'lenke' },
      { felt: 'stiftet', tittel: 'Stiftet', format: 'dato' },
      { felt: 'ansatte', tittel: 'Ansatte', format: 'tall' },
      { felt: 'sted', tittel: 'Sted', format: 'tekst' }
    ],
    sql: `SELECT organisasjonsnummer, navn, stiftelsesdato AS stiftet,
                 nullif(antall_ansatte,0) AS ansatte, forretningsadresse_poststed AS sted
          FROM enheter
          WHERE stiftelsesdato IS NOT NULL AND stiftelsesdato > '1000-01-01'
            AND NOT konkurs AND NOT under_avvikling AND slettet_dato IS NULL
          ORDER BY stiftelsesdato ASC LIMIT 50`
  },

  // ---- eierskap ----------------------------------------------------------
  {
    type: 'flest-aksjonarer', kategori: 'Eierskap',
    tittel: 'Flest aksjonærer',
    beskrivelse: 'Foretak med flest registrerte aksjonærer. Privatpersoner telles, men navngis ikke.',
    kolonner: [
      { felt: 'navn', tittel: 'Foretak', format: 'lenke' },
      { felt: 'eiere', tittel: 'Aksjonærer', format: 'tall' },
      { felt: 'foretakseiere', tittel: 'Herav foretak', format: 'tall' }
    ],
    sql: `SELECT a.organisasjonsnummer, coalesce(e.navn, a.selskap_navn) AS navn,
                 count(*) AS eiere, count(*) FILTER (WHERE NOT a.er_person) AS foretakseiere
          FROM aksjonar a LEFT JOIN enheter e USING (organisasjonsnummer)
          GROUP BY 1, 2 ORDER BY eiere DESC LIMIT 50`
  },
  {
    type: 'revisorer-klienter', kategori: 'Eierskap',
    tittel: 'Revisorer med flest klienter',
    beskrivelse: 'Revisjonsselskaper rangert etter antall foretak de reviderer.',
    kolonner: [
      { felt: 'navn', tittel: 'Revisor', format: 'lenke' },
      { felt: 'klienter', tittel: 'Klienter', format: 'tall' }
    ],
    sql: `SELECT r.innehaver_orgnr AS organisasjonsnummer,
                 coalesce(e.navn, r.innehaver_navn) AS navn,
                 count(DISTINCT r.organisasjonsnummer) AS klienter
          FROM roller r LEFT JOIN enheter e ON e.organisasjonsnummer = r.innehaver_orgnr
          WHERE r.rolletype_kode = 'REVI' AND r.innehaver_orgnr IS NOT NULL AND NOT r.avregistrert
          GROUP BY 1, 2 ORDER BY klienter DESC LIMIT 50`
  },

  {
    type: 'regnskapsforere-klienter', kategori: 'Eierskap',
    tittel: 'Regnskapsførere med flest klienter',
    beskrivelse: 'Regnskapsførerselskaper rangert etter antall foretak de fører regnskap for.',
    kolonner: [
      { felt: 'navn', tittel: 'Regnskapsfører', format: 'lenke' },
      { felt: 'klienter', tittel: 'Klienter', format: 'tall' }
    ],
    sql: `SELECT r.innehaver_orgnr AS organisasjonsnummer,
                 coalesce(e.navn, r.innehaver_navn) AS navn,
                 count(DISTINCT r.organisasjonsnummer) AS klienter
          FROM roller r LEFT JOIN enheter e ON e.organisasjonsnummer = r.innehaver_orgnr
          WHERE r.rolletype_kode = 'REGN' AND r.innehaver_orgnr IS NOT NULL AND NOT r.avregistrert
          GROUP BY 1, 2 ORDER BY klienter DESC LIMIT 50`
  },

  // ---- geografi og bransje ------------------------------------------------
  {
    type: 'nyetablering-kommune', kategori: 'Geografi',
    tittel: 'Flest nyetableringer siste år, etter kommune',
    beskrivelse: 'Antall foretak registrert de siste 365 dagene, per kommune.',
    kolonner: [
      { felt: 'kommune', tittel: 'Kommune', format: 'tekst' },
      { felt: 'fylke', tittel: 'Fylke', format: 'tekst' },
      { felt: 'nye', tittel: 'Nye foretak', format: 'tall' }
    ],
    sql: `SELECT k.navn AS kommune, fy.navn AS fylke, count(*) AS nye
          FROM enheter e
          JOIN kommuner k ON k.kommunenummer = e.forretningsadresse_kommunenummer
          JOIN fylker fy ON fy.fylkesnummer = k.fylkesnummer
          WHERE e.registreringsdato_enhetsregisteret >= current_date - 365
          GROUP BY 1, 2 ORDER BY nye DESC LIMIT 50`
  },
  {
    type: 'konkurser-naering', kategori: 'Geografi',
    tittel: 'Næringer med flest konkurser',
    beskrivelse: 'Antall registrerte konkurser per næring, med andel av alle foretak i næringen.',
    kolonner: [
      { felt: 'naering', tittel: 'Næring', format: 'tekst' },
      { felt: 'konkurser', tittel: 'Konkurser', format: 'tall' },
      { felt: 'totalt', tittel: 'Foretak i næringen', format: 'tall' },
      { felt: 'andel', tittel: 'Andel', format: 'prosent' }
    ],
    sql: `SELECT n.navn AS naering,
                 count(*) FILTER (WHERE e.konkurs) AS konkurser,
                 count(*) AS totalt,
                 round(100.0*count(*) FILTER (WHERE e.konkurs)/count(*), 2) AS andel
          FROM enheter e JOIN naeringskoder n ON n.kode = e.naeringskode1_kode
          GROUP BY n.navn HAVING count(*) FILTER (WHERE e.konkurs) > 20
          ORDER BY konkurser DESC LIMIT 50`
  }
]
