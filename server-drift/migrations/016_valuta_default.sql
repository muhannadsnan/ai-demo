-- Give historical accounting rows a currency.
--
-- The bulk source does not record currency, so historical rows were loaded with
-- valuta NULL. For a demo that is unhelpful: every chart and comparison has to
-- special-case a null.
--
-- Norwegian companies report in NOK with rare exceptions, so NOK is the right
-- default. But it is applied as a DEFAULT, not a fact: where the live API has
-- told us a company's actual currency, that wins. Equinor reports in USD, and
-- labelling those figures as kroner would silently corrupt every comparison
-- built on them.
--
-- `kilde` still distinguishes the two, so a reader can always tell an assumed
-- currency from a reported one.

-- 1. Where the API knows better, use what it said.
UPDATE regnskap h
SET valuta = a.valuta
FROM (SELECT DISTINCT ON (organisasjonsnummer) organisasjonsnummer, valuta
      FROM regnskap WHERE kilde = 'brreg-api' AND valuta IS NOT NULL
      ORDER BY organisasjonsnummer, periode_til DESC) a
WHERE h.organisasjonsnummer = a.organisasjonsnummer
  AND h.kilde = 'historikk'
  AND h.valuta IS DISTINCT FROM a.valuta;

-- 2. Everything else defaults to NOK.
UPDATE regnskap SET valuta = 'NOK' WHERE valuta IS NULL;

COMMENT ON COLUMN regnskap.valuta IS
  'Reported currency. On kilde=''brreg-api'' rows this is what Brreg stated. On kilde=''historikk'' rows it is NOK by assumption, except where an API row for the same company reported otherwise.';
