-- Reference data: the small, slow-moving lookup tables everything else joins to.
--
-- Kept separate from the big datasets because they change on completely
-- different timescales — municipalities are redrawn every few years, industry
-- codes almost never, postcodes weekly.

-- Counties. 16 of them.
CREATE TABLE IF NOT EXISTS fylker (
    fylkesnummer    char(2)     PRIMARY KEY,
    navn            text        NOT NULL,
    gyldig_fra      date,
    gyldig_til      date,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Municipalities. 358 of them.
--
-- SSB's `codesAt` endpoint returns parentCode as null for kommuner, so the
-- county is derived from the first two digits of the municipality number —
-- which is how Norwegian municipality numbers are constructed (4601 Bergen is
-- in county 46, Vestland). Derived rather than stored, so the two can never
-- disagree.
CREATE TABLE IF NOT EXISTS kommuner (
    kommunenummer   char(4)     PRIMARY KEY,
    navn            text        NOT NULL,
    fylkesnummer    char(2)     GENERATED ALWAYS AS (left(kommunenummer, 2)) STORED
                                REFERENCES fylker(fylkesnummer),
    gyldig_fra      date,
    gyldig_til      date,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- NACE industry codes. 1,785 of them, hierarchical: "01" contains "01.1"
-- contains "01.11". `enheter.naeringskode1_kode` holds the most specific level.
CREATE TABLE IF NOT EXISTS naeringskoder (
    kode            varchar(10) PRIMARY KEY,
    navn            text        NOT NULL,
    niva            smallint,
    parent_kode     varchar(10),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS naeringskoder_parent_idx ON naeringskoder (parent_kode)
    WHERE parent_kode IS NOT NULL;

-- Postcodes. ~5,100, refreshed weekly by Bring.
--
-- kategori: P = PO boxes only, G = street addresses, B = both,
--           S = service numbers (a single large recipient).
CREATE TABLE IF NOT EXISTS postnummer (
    postnummer      char(4)     PRIMARY KEY,
    poststed        text        NOT NULL,
    kommunenummer   char(4),
    kommunenavn     text,
    kategori        char(1),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS postnummer_kommune_idx ON postnummer (kommunenummer);
