-- Brreg Enhetsregisteret — the foundation table. Every other dataset joins to
-- this on organisasjonsnummer.
--
-- Shape follows the pattern used for the imports: typed columns for the fields
-- that get queried, the raw payload kept alongside for anything not yet
-- extracted, and a content hash so re-imports can skip unchanged rows.

CREATE TABLE IF NOT EXISTS enheter (
    organisasjonsnummer         char(9)     PRIMARY KEY,
    navn                        text        NOT NULL,
    organisasjonsform           varchar(10),

    naeringskode1               varchar(10),
    naeringskode1_beskrivelse   text,

    -- Addresses arrive as nested objects. The parts that get filtered on are
    -- promoted to columns; the rest stays in jsonb rather than being discarded.
    forretningsadresse          jsonb,
    postadresse                 jsonb,
    kommunenummer               char(4),
    postnummer                  char(4),
    poststed                    text,

    stiftelsesdato                      date,
    registreringsdato_enhetsregisteret  date,

    konkurs                     boolean     NOT NULL DEFAULT false,
    under_avvikling             boolean     NOT NULL DEFAULT false,
    under_tvangsavvikling       boolean     NOT NULL DEFAULT false,

    antall_ansatte              integer,
    kapital_belop               bigint,

    er_i_konsern                boolean,
    overordnet_enhet            char(9),

    -- The company's own statement of what it does. This is the column worth
    -- embedding later for "find similar companies" — far more specific than
    -- the NACE code.
    vedtektsfestet_formaal      text,

    telefon                     text,
    mobil                       text,
    epostadresse                text,
    hjemmeside                  text,

    -- The untouched API response. Costs disk, saves a full re-import the day
    -- you need a field you did not think to extract.
    raw                         jsonb,

    -- sha256 of the fields this row is derived from. An import that sees an
    -- unchanged hash skips the row entirely.
    content_hash                char(64),

    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- Fuzzy and partial name search. GIN + trigram is what makes
-- `WHERE navn ILIKE '%nordvik%'` fast over 1.17M rows instead of a seq scan.
CREATE INDEX IF NOT EXISTS enheter_navn_trgm_idx ON enheter USING gin (navn gin_trgm_ops);

-- The filters a company search actually uses.
CREATE INDEX IF NOT EXISTS enheter_kommune_idx      ON enheter (kommunenummer);
CREATE INDEX IF NOT EXISTS enheter_naering_idx      ON enheter (naeringskode1);
CREATE INDEX IF NOT EXISTS enheter_orgform_idx      ON enheter (organisasjonsform);

-- Walking the group structure upwards. Partial, because most companies have no
-- parent and there is no point indexing 1.1M NULLs.
CREATE INDEX IF NOT EXISTS enheter_overordnet_idx   ON enheter (overordnet_enhet)
    WHERE overordnet_enhet IS NOT NULL;

-- "Show me active companies" is the common case, so index only those.
CREATE INDEX IF NOT EXISTS enheter_active_idx       ON enheter (kommunenummer, antall_ansatte)
    WHERE NOT konkurs AND NOT under_avvikling;
