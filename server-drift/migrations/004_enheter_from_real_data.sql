-- Rewrite `enheter` to match the real Brreg CSV.
--
-- 002_enheter.sql was written from the field list in the planning document and
-- guessed 25 columns. The actual download has **90**, and several guesses were
-- wrong in ways that would have lost data or produced misleading queries:
--
--   * `antallAnsatte` is filled on only 6.7% of rows, and there is a separate
--     `harRegistrertAntallAnsatte` flag. "45 employees", "reported as 0" and
--     "never reported" are three different states. A plain nullable integer
--     collapses the last two, so `SUM(antall_ansatte)` would silently understate
--     and `WHERE antall_ansatte = 0` would find almost nothing.
--   * There are THREE industry codes, not one.
--   * Addresses are already flat in the CSV, and there are two of them
--     (business and postal) each with seven parts — including two different
--     kommunenummer. 002 had one ambiguous column and a jsonb blob.
--   * Capital has a currency (NOK and EUR both occur), so a bare bigint of
--     "belop" is not comparable across rows.
--   * `vedtektsfestetFormaal` is filled on 43.6% of rows, while `aktivitet`
--     is filled on 100% and carries the same kind of description. For "find
--     similar companies", `aktivitet` is the column to embed.
--
-- The table is empty, so this drops and recreates rather than running forty
-- ALTERs. That is only acceptable *because* it is empty — once real rows exist,
-- corrections have to be additive.

DROP TABLE IF EXISTS enheter CASCADE;

CREATE TABLE enheter (
    organisasjonsnummer                 char(9)     PRIMARY KEY,
    navn                                text        NOT NULL,

    -- ---- classification -----------------------------------------------------
    organisasjonsform_kode              varchar(10),
    organisasjonsform_beskrivelse       text,
    naeringskode1_kode                  varchar(10),
    naeringskode1_beskrivelse           text,
    naeringskode2_kode                  varchar(10),
    naeringskode2_beskrivelse           text,
    naeringskode3_kode                  varchar(10),
    naeringskode3_beskrivelse           text,
    hjelpeenhetskode_kode               varchar(10),
    hjelpeenhetskode_beskrivelse        text,
    institusjonell_sektorkode_kode      varchar(10),
    institusjonell_sektorkode_beskrivelse text,

    -- ---- employees ----------------------------------------------------------
    -- Keep the flag. Without it you cannot tell "reported zero" from "never
    -- reported", and 93% of rows are the latter.
    har_registrert_antall_ansatte       boolean     NOT NULL DEFAULT false,
    antall_ansatte                      integer,
    registreringsdato_antall_ansatte_enhetsregisteret   date,
    registreringsdato_antall_ansatte_nav_aaregisteret   date,

    -- ---- contact ------------------------------------------------------------
    hjemmeside                          text,
    epostadresse                        text,
    telefon                             text,
    mobil                               text,

    -- ---- addresses ----------------------------------------------------------
    -- Two of them. `forretningsadresse` (where the business is) is filled on
    -- 97% of rows; `postadresse` on 18%. Filter on the business one.
    -- postnummer stays varchar rather than char(4): every value observed is
    -- four digits, but 2.3% of entities are foreign-registered and a future
    -- foreign postcode should not abort an import.
    forretningsadresse_adresse          text,
    forretningsadresse_poststed         text,
    forretningsadresse_postnummer       varchar(12),
    forretningsadresse_kommune          text,
    forretningsadresse_kommunenummer    varchar(6),
    forretningsadresse_land             text,
    forretningsadresse_landkode         varchar(3),

    postadresse_adresse                 text,
    postadresse_poststed                text,
    postadresse_postnummer              varchar(12),
    postadresse_kommune                 text,
    postadresse_kommunenummer           varchar(6),
    postadresse_land                    text,
    postadresse_landkode                varchar(3),

    -- ---- registration dates and flags ---------------------------------------
    registreringsdato_enhetsregisteret  date,
    stiftelsesdato                      date,
    siste_innsendte_aarsregnskap        smallint,

    registrert_i_mva_registeret         boolean     NOT NULL DEFAULT false,
    registreringsdato_mva_registeret    date,
    registreringsdato_mva_registeret_enhetsregisteret   date,
    frivillig_mva_registrert_beskrivelser               text,
    registreringsdato_frivillig_mva_registeret          date,

    registrert_i_frivillighetsregisteret    boolean NOT NULL DEFAULT false,
    registreringsdato_frivillighetsregisteret           date,
    registrert_i_foretaksregisteret         boolean NOT NULL DEFAULT false,
    registreringsdato_foretaksregisteret                date,
    registrert_i_stiftelsesregisteret       boolean NOT NULL DEFAULT false,
    registrert_i_partiregisteret            boolean NOT NULL DEFAULT false,
    registreringsdato_partiregisteret                   date,

    -- ---- distress -----------------------------------------------------------
    konkurs                             boolean     NOT NULL DEFAULT false,
    konkursdato                         date,
    under_avvikling                     boolean     NOT NULL DEFAULT false,
    under_avvikling_dato                date,
    under_tvangsavvikling               boolean     NOT NULL DEFAULT false,
    tvangsopplost_manglende_daglig_leder_dato   date,
    tvangsopplost_manglende_revisor_dato        date,
    tvangsopplost_manglende_regnskap_dato       date,
    tvangsopplost_mangelfullt_styre_dato        date,
    tvangsavviklet_manglende_sletting_dato      date,
    under_utenlandsk_insolvensbehandling_dato   date,
    under_rekonstruksjonsforhandling_dato       date,

    -- ---- governance ---------------------------------------------------------
    er_i_konsern                        boolean     NOT NULL DEFAULT false,
    overordnet_enhet                    char(9),
    maalform                            text,
    vedtektsdato                        date,
    -- 43.6% filled.
    vedtektsfestet_formaal              text,
    -- 100% filled, same kind of content. THIS is the column to embed for
    -- "find similar companies". Longest value observed: 5,948 characters.
    aktivitet                           text,
    paategninger                        boolean     NOT NULL DEFAULT false,
    fravalg_revisjon_dato               date,
    fravalg_revisjon_beslutnings_dato   date,

    -- ---- capital ------------------------------------------------------------
    -- numeric, not bigint: values carry two decimals. And keep the currency —
    -- both NOK and EUR occur, so amounts are not directly comparable without it.
    kapital_belop                       numeric(20,2),
    kapital_antall_aksjer               bigint,
    kapital_type                        text,
    kapital_bundet                      numeric(20,2),
    kapital_valuta                      char(3),
    kapital_innbetalt                   numeric(20,2),
    kapital_fullt_innbetalt             boolean,
    kapital_innfort_dato                date,

    -- ---- foreign entities (2.3% of rows) ------------------------------------
    registreringsnummer_i_hjemlandet    text,
    utenlandsk_register_navn            text,
    utenlandsk_register_adresse_land    text,
    utenlandsk_register_adresse_poststed text,
    utenlandsk_register_adresse_adresse text,
    underlagt_lovgivning_land           text,
    underlagt_lovgivning_landkode       varchar(3),
    foretaksform_i_hjemlandet_kode      varchar(10),
    foretaksform_i_hjemlandet_beskrivelse           text,
    foretaksform_i_hjemlandet_beskrivelse_bokmaal   text,

    -- ---- bookkeeping --------------------------------------------------------
    -- sha256 of the source row, so a re-import skips rows that have not changed.
    content_hash                        char(64),
    created_at                          timestamptz NOT NULL DEFAULT now(),
    updated_at                          timestamptz NOT NULL DEFAULT now()
);

-- Fuzzy and partial name search over 1.47M rows.
CREATE INDEX enheter_navn_trgm_idx ON enheter USING gin (navn gin_trgm_ops);

-- The filters a company search actually uses. Business address, not postal —
-- the postal one is empty on 82% of rows.
CREATE INDEX enheter_kommune_idx  ON enheter (forretningsadresse_kommunenummer);
CREATE INDEX enheter_naering_idx  ON enheter (naeringskode1_kode);
CREATE INDEX enheter_orgform_idx  ON enheter (organisasjonsform_kode);
CREATE INDEX enheter_sektor_idx   ON enheter (institusjonell_sektorkode_kode);

-- Group structure. Partial: only 0.1% of rows have a parent, so indexing the
-- other 99.9% as NULLs would be pure waste.
CREATE INDEX enheter_overordnet_idx ON enheter (overordnet_enhet)
    WHERE overordnet_enhet IS NOT NULL;

-- "Active companies in this municipality, by size" — the common listing query.
CREATE INDEX enheter_active_idx ON enheter (forretningsadresse_kommunenummer, antall_ansatte)
    WHERE NOT konkurs AND NOT under_avvikling AND NOT under_tvangsavvikling;

-- Only 6.7% of rows report employees, so a partial index covers the whole of
-- "companies with a known headcount" in a fraction of the space.
CREATE INDEX enheter_ansatte_idx ON enheter (antall_ansatte)
    WHERE har_registrert_antall_ansatte;
