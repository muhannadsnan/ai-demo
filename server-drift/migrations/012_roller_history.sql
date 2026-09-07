-- Keep role history instead of destroying it every import.
--
-- The roles import replaced the table wholesale. That is correct for a
-- snapshot, and it means "Ola sat on this board until March 2024" was
-- unrecoverable — the row was simply gone the next morning.
--
-- This is a slowly-changing-dimension type 2: `roller` holds current state,
-- `roller_historikk` holds roles that have ended, and both carry the dates
-- between which the role was observed. It answers "who used to run this
-- company", which is one of the more interesting questions the dataset can
-- support and something the commercial products charge for.
--
-- Note "observed", not "held". Brreg publishes current state, so the best that
-- can be said is the date a role was first and last seen in a download. That
-- distinction matters and should be visible in the column names.

-- When each current role was first seen.
ALTER TABLE roller ADD COLUMN IF NOT EXISTS forst_sett date NOT NULL DEFAULT current_date;

-- A stable fingerprint for "the same role", so successive imports can tell an
-- unchanged role from a new one. Generated, so it cannot drift from the columns
-- it summarises.
ALTER TABLE roller ADD COLUMN IF NOT EXISTS rolle_nokkel text
    GENERATED ALWAYS AS (
        organisasjonsnummer || '|' || rollegruppe_kode || '|' || rolletype_kode || '|' ||
        coalesce(innehaver_orgnr, '') || '|' ||
        coalesce(person_etternavn, '') || '|' || coalesce(person_fornavn, '') || '|' ||
        -- `person_fodselsdato::text` looks obvious and is REJECTED: date-to-text
        -- depends on the DateStyle setting, so Postgres classes it as stable
        -- rather than immutable and refuses it in a generated column. Date
        -- minus date yields an integer, and integer-to-text is immutable.
        coalesce((person_fodselsdato - DATE '1970-01-01')::text, '') || '|' ||
        coalesce(rekkefolge::text, '')
    ) STORED;

CREATE INDEX IF NOT EXISTS roller_nokkel_idx ON roller (rolle_nokkel);

-- Ended roles.
CREATE TABLE IF NOT EXISTS roller_historikk (
    id                          bigserial   PRIMARY KEY,
    organisasjonsnummer         char(9)     NOT NULL,
    rollegruppe_kode            varchar(10) NOT NULL,
    rollegruppe_beskrivelse     text,
    rolletype_kode              varchar(10) NOT NULL,
    rolletype_beskrivelse       text,
    rekkefolge                  integer,
    valgt_av                    text,
    person_fornavn              text,
    person_mellomnavn           text,
    person_etternavn            text,
    person_fodselsdato          date,
    innehaver_orgnr             char(9),
    innehaver_navn              text,
    innehaver_organisasjonsform varchar(10),
    forst_sett                  date        NOT NULL,
    sist_sett                   date        NOT NULL,
    arkivert_at                 timestamptz NOT NULL DEFAULT now()
);

-- No foreign key to `enheter` on purpose: a role's history should survive the
-- company being deregistered. That is precisely when someone wants to look.
CREATE INDEX IF NOT EXISTS roller_historikk_orgnr_idx ON roller_historikk (organisasjonsnummer);
CREATE INDEX IF NOT EXISTS roller_historikk_person_idx ON roller_historikk
    (person_etternavn, person_fornavn, person_fodselsdato) WHERE person_etternavn IS NOT NULL;
CREATE INDEX IF NOT EXISTS roller_historikk_slutt_idx ON roller_historikk (sist_sett);
