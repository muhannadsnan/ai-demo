-- Rewrite `roller` to match the real Brreg structure.
--
-- 003_roller.sql was guessed from a field list. The actual data is nested two
-- levels deep and differs in four ways that matter:
--
--   * There is a role GROUP and a role TYPE, not one "rolletype". The board is
--     a group (STYR) containing roles (LEDE = chair, MEDL = member). Collapsing
--     them loses the distinction between the chair and an ordinary member.
--   * The "has left" flag is called `avregistrert`, not `fratraadt`.
--   * `rekkefolge` orders people within a group — board seat 0, 1, 2.
--   * A corporate role holder's `navn` is an ARRAY of strings, not a string.
--     Auditors and accountants are companies, so this is the common case.
--
-- Also new here: `erDoed` on people, `sistEndret` per group, and `valgtAv`.
--
-- Loading strategy differs from enheter, deliberately. The roles file is a
-- "totalbestand" — a complete snapshot of current state, not a delta — so the
-- table is replaced wholesale rather than upserted. There is no content hash
-- because there is nothing to compare against: every load is the whole truth.

DROP TABLE IF EXISTS roller CASCADE;

CREATE TABLE roller (
    id                          bigserial   PRIMARY KEY,
    organisasjonsnummer         char(9)     NOT NULL
        REFERENCES enheter(organisasjonsnummer) ON DELETE CASCADE,

    -- The group: STYR (board), DAGL (managing director), REVI (auditor),
    -- REGN (accountant), KONT (contact), INNH (proprietor).
    rollegruppe_kode            varchar(10) NOT NULL,
    rollegruppe_beskrivelse     text,
    rollegruppe_sist_endret     date,

    -- The role within that group: LEDE (chair), MEDL (member), NEST (deputy
    -- chair), VARA (alternate), and so on.
    rolletype_kode              varchar(10) NOT NULL,
    rolletype_beskrivelse       text,

    rekkefolge                  integer,
    avregistrert                boolean     NOT NULL DEFAULT false,
    valgt_av                    text,

    -- A holder is a person OR a company, never both.
    person_fornavn              text,
    person_mellomnavn           text,
    person_etternavn            text,
    person_fodselsdato          date,
    person_er_doed              boolean,

    innehaver_orgnr             char(9),
    innehaver_navn              text,
    innehaver_organisasjonsform varchar(10),
    innehaver_er_slettet        boolean,

    created_at                  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT roller_holder_is_person_or_company CHECK (
        (person_etternavn IS NOT NULL AND innehaver_orgnr IS NULL) OR
        (person_etternavn IS NULL     AND innehaver_orgnr IS NOT NULL) OR
        (person_etternavn IS NULL     AND innehaver_orgnr IS NULL)   -- neither: seen on some historic rows
    )
);

-- "Who runs this company" — the profile page.
CREATE INDEX roller_orgnr_idx ON roller (organisasjonsnummer);

-- "What else does this person do." Name plus birth date is the practical
-- identity key; Brreg does not publish personal ID numbers.
CREATE INDEX roller_person_idx ON roller (person_etternavn, person_fornavn, person_fodselsdato)
    WHERE person_etternavn IS NOT NULL;

-- Corporate holders — auditors, accountants, corporate board members.
CREATE INDEX roller_innehaver_idx ON roller (innehaver_orgnr)
    WHERE innehaver_orgnr IS NOT NULL;

-- "All current board chairs", "all auditors" — filtering by role.
CREATE INDEX roller_type_idx ON roller (rollegruppe_kode, rolletype_kode)
    WHERE NOT avregistrert;

-- Fuzzy person-name search, the same trigram treatment company names get.
CREATE INDEX roller_person_navn_trgm_idx ON roller
    USING gin ((coalesce(person_fornavn,'') || ' ' || coalesce(person_etternavn,'')) gin_trgm_ops)
    WHERE person_etternavn IS NOT NULL;
