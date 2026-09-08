-- Record where each accounting row came from, and allow historical rows.
--
-- Brreg's API serves only the most recent accounting period — there is no year
-- parameter, and no way to ask for history. Verified by trying: `?år=2023`,
-- `?aar=2023` and `?regnskapstype=KONSERN` all return the same current period.
-- So multi-year trends cannot be built from the API alone.
--
-- History therefore comes from an earlier bulk collection, and the two sources
-- differ in precision, so rows must say which they are:
--
--   brreg-api    exact kroner, current period only
--   historikk    rounded to the nearest thousand, 1999 onwards
--
-- The historical figures were checked against the live API before being
-- trusted: fourteen fields across the resultatregnskap and balanse matched
-- exactly once scaled by 1000, for a company reporting in USD and for three
-- reporting in NOK.

ALTER TABLE regnskap ADD COLUMN IF NOT EXISTS kilde text NOT NULL DEFAULT 'brreg-api'
    CHECK (kilde IN ('brreg-api', 'historikk'));

COMMENT ON COLUMN regnskap.kilde IS
  'brreg-api = exact figures from the live API. historikk = bulk-collected, rounded to the nearest 1000.';

-- Currency is not recorded in the historical source. It is left NULL rather
-- than assumed to be NOK — Equinor reports in USD, and silently labelling a
-- dollar figure as kroner would corrupt every comparison built on it.
COMMENT ON COLUMN regnskap.valuta IS
  'NULL on historical rows: the bulk source did not record currency, and it is not always NOK.';

CREATE INDEX IF NOT EXISTS regnskap_kilde_idx ON regnskap (kilde);
