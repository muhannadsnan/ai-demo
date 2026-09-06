-- Brreg Roller — board members, CEOs, auditors, accountants. ~3.4M rows.
--
-- One row per (company, role, holder). A person can hold roles in many
-- companies, which is what makes "what else does this person do?" answerable.

CREATE TABLE IF NOT EXISTS roller (
    id                      bigserial   PRIMARY KEY,
    organisasjonsnummer     char(9)     NOT NULL REFERENCES enheter(organisasjonsnummer) ON DELETE CASCADE,

    -- STYR (board), DAGL (CEO), KONT (contact), INNH (proprietor),
    -- REVI (auditor), REGN (accountant).
    rolletype               varchar(8)  NOT NULL,

    -- A role holder is either a person or another company, never both.
    person_fornavn          text,
    person_etternavn        text,
    person_fodselsdato      date,
    innehaver_orgnr         char(9),

    fratraadt               boolean     NOT NULL DEFAULT false,

    raw                     jsonb,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT roller_holder_is_person_or_company CHECK (
        (person_etternavn IS NOT NULL AND innehaver_orgnr IS NULL) OR
        (person_etternavn IS NULL     AND innehaver_orgnr IS NOT NULL)
    )
);

-- "Who runs this company" — the company profile page.
CREATE INDEX IF NOT EXISTS roller_orgnr_idx ON roller (organisasjonsnummer);

-- "What else does this person do" — name plus birth year is the practical
-- identity key, since Brreg does not publish personal ID numbers.
CREATE INDEX IF NOT EXISTS roller_person_idx ON roller (person_etternavn, person_fornavn, person_fodselsdato)
    WHERE person_etternavn IS NOT NULL;

-- Corporate role holders, for ownership and control questions.
CREATE INDEX IF NOT EXISTS roller_innehaver_idx ON roller (innehaver_orgnr)
    WHERE innehaver_orgnr IS NOT NULL;
