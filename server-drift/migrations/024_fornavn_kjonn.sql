-- First names by gender, from SSB.
--
-- Needed for any "women in business" view, and there is no gender field in
-- Brreg — roles carry a name and a birth date, nothing more. SSB's name
-- statistics (table 10501) code every name with a 1 or 2 prefix for girls' and
-- boys' names, which is an official mapping rather than a guess.
--
-- It is still an INFERENCE about a person, and the limits are real:
--   - a name in both lists is ambiguous and is stored as such, not forced
--   - a person's name does not determine their gender
--   - names outside SSB's 2,152 are simply unknown
--
-- So anything built on this says "based on first name" rather than asserting.

CREATE TABLE IF NOT EXISTS fornavn_kjonn (
    fornavn     text        PRIMARY KEY,      -- uppercase, for matching
    kjonn       char(1)     NOT NULL CHECK (kjonn IN ('K', 'M', '?')),
    oppdatert_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE fornavn_kjonn IS
  'Fornavn fra SSB tabell 10501. K = jentenavn, M = guttenavn, ? = navnet finnes i begge listene. Dette er en antakelse basert på fornavn, ikke en registrert opplysning.';
