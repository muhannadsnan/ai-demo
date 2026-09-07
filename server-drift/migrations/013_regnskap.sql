-- Annual accounts, fetched per company from Brreg's API.
--
-- Regnskapsregisteret has no bulk download: it is one HTTP request per
-- organisation number, which rules out mirroring 1.17M companies. So this table
-- fills two ways — a seeded subset of larger companies, and on demand when a
-- company's page is viewed — and every row records when it was fetched.
--
-- Field set follows Brreg's actual response, which returns 32 leaf fields per
-- accounting period. That is summary level: revenue, operating result, assets,
-- equity, debt. Enough for trend charts and peer comparison.

CREATE TABLE IF NOT EXISTS regnskap (
    organisasjonsnummer         char(9)     NOT NULL REFERENCES enheter(organisasjonsnummer) ON DELETE CASCADE,
    -- SELSKAP (the company alone) or KONSERN (the consolidated group). A parent
    -- company files both, and mixing them double-counts revenue.
    regnskapstype               varchar(10) NOT NULL,
    periode_til                 date        NOT NULL,
    periode_fra                 date,

    -- NOT always NOK. Observed USD on a company reporting in dollars, so any
    -- comparison or sum across companies must group by this or convert.
    valuta                      char(3),

    oppstillingsplan            text,
    morselskap                  boolean,
    avviklingsregnskap          boolean,
    ikke_revidert               boolean,
    fravalg_revisjon            boolean,
    smaa_foretak                boolean,
    regnskapsregler             text,

    -- Resultatregnskap
    sum_driftsinntekter         numeric(20,2),
    sum_driftskostnad           numeric(20,2),
    driftsresultat              numeric(20,2),
    sum_finansinntekter         numeric(20,2),
    sum_finanskostnad           numeric(20,2),
    netto_finans                numeric(20,2),
    ordinaert_resultat_for_skatt numeric(20,2),
    aarsresultat                numeric(20,2),

    -- Balanse
    sum_eiendeler               numeric(20,2),
    sum_anleggsmidler           numeric(20,2),
    sum_omloepsmidler           numeric(20,2),
    sum_egenkapital             numeric(20,2),
    sum_innskutt_egenkapital    numeric(20,2),
    sum_opptjent_egenkapital    numeric(20,2),
    sum_gjeld                   numeric(20,2),
    sum_kortsiktig_gjeld        numeric(20,2),
    sum_langsiktig_gjeld        numeric(20,2),

    brreg_id                    bigint,
    journalnr                   bigint,
    raw                         jsonb,
    hentet_at                   timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (organisasjonsnummer, regnskapstype, periode_til)
);

CREATE INDEX IF NOT EXISTS regnskap_orgnr_idx ON regnskap (organisasjonsnummer, periode_til DESC);
CREATE INDEX IF NOT EXISTS regnskap_periode_idx ON regnskap (periode_til);
-- "Largest companies by revenue" — only meaningful within one currency.
CREATE INDEX IF NOT EXISTS regnskap_inntekter_idx ON regnskap (valuta, sum_driftsinntekter DESC)
    WHERE regnskapstype = 'SELSKAP';

-- One row per company attempted, whatever the outcome.
--
-- Without this, companies that have never filed accounts get re-requested on
-- every page view forever: 404 is a legitimate permanent answer for most of the
-- register, and "we asked and there is nothing" has to be storable.
CREATE TABLE IF NOT EXISTS regnskap_hentelogg (
    organisasjonsnummer char(9)     PRIMARY KEY REFERENCES enheter(organisasjonsnummer) ON DELETE CASCADE,
    forsokt_at          timestamptz NOT NULL DEFAULT now(),
    status              text        NOT NULL CHECK (status IN ('ok','ingen_data','feil')),
    http_status         smallint,
    antall_perioder     smallint    NOT NULL DEFAULT 0,
    feilmelding         text
);

CREATE INDEX IF NOT EXISTS regnskap_hentelogg_status_idx ON regnskap_hentelogg (status, forsokt_at);
