-- Shareholdings, from Skatteetaten's Aksjonærregisteret.
--
-- THIS TABLE IS DIFFERENT FROM EVERY OTHER ONE HERE.
--
-- Everything else is Brreg data under NLOD: free to republish with attribution.
-- This is not. Skatteetaten releases it under the same criteria as the tax
-- lists and states explicitly that the extract contains personal data and that
-- the recipient must comply with personopplysningsloven for further use.
--
-- 2,526,639 of the 3,092,787 rows identify a private individual by name, birth
-- year, postcode and town. That combination identifies a real person.
--
-- The design consequence: personal columns are isolated, and a view exists that
-- exposes the corporate ownership graph without them. Point the public
-- application at the view, never at this table.

CREATE TABLE IF NOT EXISTS aksjeeie (
    id                      bigserial   PRIMARY KEY,
    regnskapsaar            smallint    NOT NULL,

    -- The company whose shares are held.
    organisasjonsnummer     char(9)     NOT NULL,
    selskap_navn            text,
    aksjeklasse             text,

    -- true  = a private individual (identifier is a 4-digit birth year)
    -- false = a company (identifier is a 9-digit organisation number)
    -- null  = neither, mostly foreign holders with no identifier at all
    er_person               boolean,

    -- ---- corporate holder: NOT personal data, safe to publish -------------
    eier_orgnr              char(9),

    -- ---- personal data: subject to personopplysningsloven ----------------
    eier_navn               text,
    eier_fodselsaar         smallint,
    eier_sted_raw           text,       -- "4020 STAVANGER", or a foreign address
    eier_postnr             text,
    eier_poststed           text,
    -- ----------------------------------------------------------------------

    eier_landkode           char(2),
    antall_aksjer           bigint,
    antall_aksjer_selskap   bigint,

    -- Ownership share. Generated, so it cannot drift from the counts.
    andel_prosent           numeric(9,6) GENERATED ALWAYS AS (
        CASE WHEN antall_aksjer_selskap > 0
             THEN 100.0 * antall_aksjer / antall_aksjer_selskap END) STORED,

    UNIQUE (regnskapsaar, organisasjonsnummer, aksjeklasse, eier_navn, eier_fodselsaar, eier_orgnr)
);

-- No foreign key to enheter: the register includes companies that have since
-- been deregistered, and an ownership record should survive that.
CREATE INDEX IF NOT EXISTS aksjeeie_orgnr_idx  ON aksjeeie (organisasjonsnummer, regnskapsaar);
CREATE INDEX IF NOT EXISTS aksjeeie_eier_idx   ON aksjeeie (eier_orgnr) WHERE eier_orgnr IS NOT NULL;
CREATE INDEX IF NOT EXISTS aksjeeie_andel_idx  ON aksjeeie (organisasjonsnummer, andel_prosent DESC);
CREATE INDEX IF NOT EXISTS aksjeeie_person_idx ON aksjeeie (eier_navn, eier_fodselsaar)
    WHERE er_person;

-- ---------------------------------------------------------------------------
-- The publishable view.
--
-- Corporate shareholders in full — an organisation number is not personal data,
-- and company-owns-company is the interesting half of the graph anyway.
-- Individuals reduced to a count and a share, with no name, birth year or
-- address. The ownership structure survives; the people do not appear.
CREATE OR REPLACE VIEW aksjeeie_offentlig AS
SELECT
    id, regnskapsaar, organisasjonsnummer, selskap_navn, aksjeklasse,
    er_person,
    eier_orgnr,
    CASE WHEN er_person THEN NULL ELSE eier_navn END       AS eier_navn,
    CASE WHEN er_person THEN NULL ELSE eier_landkode END   AS eier_landkode,
    antall_aksjer, antall_aksjer_selskap, andel_prosent
FROM aksjeeie;

COMMENT ON VIEW aksjeeie_offentlig IS
  'Ownership without personal data. Corporate holders in full; individuals appear as an anonymous row carrying only their share. Public-facing code should read this, never aksjeeie.';
