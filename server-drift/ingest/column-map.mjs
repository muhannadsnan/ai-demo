/**
 * The single source of truth for CSV header -> database column.
 *
 * Twelve database columns were deliberately named shorter than their CSV
 * headers (`underTvangsavviklingEllerTvangsopplosning` -> `under_tvangsavvikling`),
 * so automatic snake_casing does not line up. Rather than scatter that
 * knowledge through the importer, it lives here once and the SQL is generated
 * from it.
 *
 * Types drive the cast applied when moving from the all-text staging table into
 * the real one:
 *   text     nullif(v, '')
 *   date     nullif(v, '')::date
 *   int      nullif(v, '')::integer
 *   smallint nullif(v, '')::smallint
 *   bigint   nullif(v, '')::bigint
 *   numeric  nullif(v, '')::numeric
 *   bool     nullif(v, '')::boolean          -- nullable
 *   bool_nn  coalesce(nullif(v,'')::boolean, false)  -- NOT NULL in the schema
 */
export const COLUMNS = [
  ['organisasjonsnummer',                       'organisasjonsnummer',                              'text'],
  ['navn',                                      'navn',                                             'text'],
  ['organisasjonsform.kode',                    'organisasjonsform_kode',                           'text'],
  ['organisasjonsform.beskrivelse',             'organisasjonsform_beskrivelse',                    'text'],
  ['naeringskode1.kode',                        'naeringskode1_kode',                               'text'],
  ['naeringskode1.beskrivelse',                 'naeringskode1_beskrivelse',                        'text'],
  ['naeringskode2.kode',                        'naeringskode2_kode',                               'text'],
  ['naeringskode2.beskrivelse',                 'naeringskode2_beskrivelse',                        'text'],
  ['naeringskode3.kode',                        'naeringskode3_kode',                               'text'],
  ['naeringskode3.beskrivelse',                 'naeringskode3_beskrivelse',                        'text'],
  ['hjelpeenhetskode.kode',                     'hjelpeenhetskode_kode',                            'text'],
  ['hjelpeenhetskode.beskrivelse',              'hjelpeenhetskode_beskrivelse',                     'text'],
  ['harRegistrertAntallAnsatte',                'har_registrert_antall_ansatte',                    'bool_nn'],
  ['antallAnsatte',                             'antall_ansatte',                                   'int'],
  ['registreringsdatoAntallAnsatteEnhetsregisteret', 'registreringsdato_antall_ansatte_enhetsregisteret', 'date'],
  ['registreringsdatoantallansatteNAVAaregisteret',  'registreringsdato_antall_ansatte_nav_aaregisteret', 'date'],
  ['hjemmeside',                                'hjemmeside',                                       'text'],
  ['epostadresse',                              'epostadresse',                                     'text'],
  ['telefon',                                   'telefon',                                          'text'],
  ['mobil',                                     'mobil',                                            'text'],
  ['postadresse.adresse',                       'postadresse_adresse',                              'text'],
  ['postadresse.poststed',                      'postadresse_poststed',                             'text'],
  ['postadresse.postnummer',                    'postadresse_postnummer',                           'text'],
  ['postadresse.kommune',                       'postadresse_kommune',                              'text'],
  ['postadresse.kommunenummer',                 'postadresse_kommunenummer',                        'text'],
  ['postadresse.land',                          'postadresse_land',                                 'text'],
  ['postadresse.landkode',                      'postadresse_landkode',                             'text'],
  ['forretningsadresse.adresse',                'forretningsadresse_adresse',                       'text'],
  ['forretningsadresse.poststed',               'forretningsadresse_poststed',                      'text'],
  ['forretningsadresse.postnummer',             'forretningsadresse_postnummer',                    'text'],
  ['forretningsadresse.kommune',                'forretningsadresse_kommune',                       'text'],
  ['forretningsadresse.kommunenummer',          'forretningsadresse_kommunenummer',                 'text'],
  ['forretningsadresse.land',                   'forretningsadresse_land',                          'text'],
  ['forretningsadresse.landkode',               'forretningsadresse_landkode',                      'text'],
  ['institusjonellSektorkode.kode',             'institusjonell_sektorkode_kode',                   'text'],
  ['institusjonellSektorkode.beskrivelse',      'institusjonell_sektorkode_beskrivelse',            'text'],
  ['sisteInnsendteAarsregnskap',                'siste_innsendte_aarsregnskap',                     'smallint'],
  ['registreringsdatoenhetsregisteret',         'registreringsdato_enhetsregisteret',               'date'],
  ['stiftelsesdato',                            'stiftelsesdato',                                   'date'],
  ['registrertIMvaRegisteret',                  'registrert_i_mva_registeret',                      'bool_nn'],
  ['registreringsdatoMerverdiavgiftsregisteret', 'registreringsdato_mva_registeret',                'date'],
  ['registreringsdatoMerverdiavgiftsregisteretEnhetsregisteret', 'registreringsdato_mva_registeret_enhetsregisteret', 'date'],
  ['frivilligMvaRegistrertBeskrivelser',        'frivillig_mva_registrert_beskrivelser',            'text'],
  ['registreringsdatoFrivilligMerverdiavgiftsregisteret', 'registreringsdato_frivillig_mva_registeret', 'date'],
  ['registrertIFrivillighetsregisteret',        'registrert_i_frivillighetsregisteret',             'bool_nn'],
  ['registreringsdatoFrivillighetsregisteret',  'registreringsdato_frivillighetsregisteret',        'date'],
  ['registrertIForetaksregisteret',             'registrert_i_foretaksregisteret',                  'bool_nn'],
  ['registreringsdatoForetaksregisteret',       'registreringsdato_foretaksregisteret',             'date'],
  ['registrertIStiftelsesregisteret',           'registrert_i_stiftelsesregisteret',                'bool_nn'],
  ['registrertIPartiregisteret',                'registrert_i_partiregisteret',                     'bool_nn'],
  ['registreringsdatoPartiregisteret',          'registreringsdato_partiregisteret',                'date'],
  ['konkurs',                                   'konkurs',                                          'bool_nn'],
  ['konkursdato',                               'konkursdato',                                      'date'],
  ['underAvvikling',                            'under_avvikling',                                  'bool_nn'],
  ['underAvviklingDato',                        'under_avvikling_dato',                             'date'],
  ['underTvangsavviklingEllerTvangsopplosning', 'under_tvangsavvikling',                            'bool_nn'],
  ['tvangsopplostPgaManglendeDagligLederDato',  'tvangsopplost_manglende_daglig_leder_dato',        'date'],
  ['tvangsopplostPgaManglendeRevisorDato',      'tvangsopplost_manglende_revisor_dato',             'date'],
  ['tvangsopplostPgaManglendeRegnskapDato',     'tvangsopplost_manglende_regnskap_dato',            'date'],
  ['tvangsopplostPgaMangelfulltStyreDato',      'tvangsopplost_mangelfullt_styre_dato',             'date'],
  ['tvangsavvikletPgaManglendeSlettingDato',    'tvangsavviklet_manglende_sletting_dato',           'date'],
  ['overordnetEnhet',                           'overordnet_enhet',                                 'text'],
  ['maalform',                                  'maalform',                                         'text'],
  ['vedtektsdato',                              'vedtektsdato',                                     'date'],
  ['vedtektsfestetFormaal',                     'vedtektsfestet_formaal',                           'text'],
  ['aktivitet',                                 'aktivitet',                                        'text'],
  ['paategninger',                              'paategninger',                                     'bool_nn'],
  ['underUtenlandskInsolvensbehandlingDato',    'under_utenlandsk_insolvensbehandling_dato',        'date'],
  ['underRekonstruksjonsforhandlingDato',       'under_rekonstruksjonsforhandling_dato',            'date'],
  ['fravalgRevisjonDato',                       'fravalg_revisjon_dato',                            'date'],
  ['fravalgRevisjonBeslutningsDato',            'fravalg_revisjon_beslutnings_dato',                'date'],
  ['erIKonsern',                                'er_i_konsern',                                     'bool_nn'],
  ['kapital.belop',                             'kapital_belop',                                    'numeric'],
  ['kapital.antallAksjer',                      'kapital_antall_aksjer',                            'bigint'],
  ['kapital.type',                              'kapital_type',                                     'text'],
  ['kapital.bundet',                            'kapital_bundet',                                   'numeric'],
  ['kapital.valuta',                            'kapital_valuta',                                   'text'],
  ['kapital.innbetalt',                         'kapital_innbetalt',                                'numeric'],
  ['kapital.fulltInnbetalt',                    'kapital_fullt_innbetalt',                          'bool'],
  ['kapital.innfortDato',                       'kapital_innfort_dato',                             'date'],
  ['registreringsnummerIHjemlandet',            'registreringsnummer_i_hjemlandet',                 'text'],
  ['utenlandskRegisterNavn',                    'utenlandsk_register_navn',                         'text'],
  ['utenlandskRegisterAdresse.land',            'utenlandsk_register_adresse_land',                 'text'],
  ['utenlandskRegisterAdresse.poststed',        'utenlandsk_register_adresse_poststed',             'text'],
  ['utenlandskRegisterAdresse.adresse',         'utenlandsk_register_adresse_adresse',              'text'],
  ['underlagtLovgivningLand',                   'underlagt_lovgivning_land',                        'text'],
  ['underlagtLovgivningLandKode',               'underlagt_lovgivning_landkode',                    'text'],
  ['foretaksformIHjemlandet.kode',              'foretaksform_i_hjemlandet_kode',                   'text'],
  ['foretaksformIHjemlandet.beskrivelse',       'foretaksform_i_hjemlandet_beskrivelse',            'text'],
  ['foretaksformIHjemlandet.beskrivelseBokmaal','foretaksform_i_hjemlandet_beskrivelse_bokmaal',    'text']
]

/** The SQL expression that converts one staging column to its final type. */
export function cast(csvHeader, type) {
  const v = `nullif(s."${csvHeader}", '')`
  switch (type) {
    case 'date':     return `${v}::date`
    case 'int':      return `${v}::integer`
    case 'smallint': return `${v}::smallint`
    case 'bigint':   return `${v}::bigint`
    case 'numeric':  return `${v}::numeric`
    case 'bool':     return `${v}::boolean`
    case 'bool_nn':  return `coalesce(${v}::boolean, false)`
    default:         return v
  }
}
