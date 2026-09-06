-- Extensions this schema depends on.
--
-- pg_trgm gives trigram similarity, which is what makes fuzzy company-name
-- matching possible ("Nordvik Logistikk" vs "Nordvik Logistik AS"). It is also
-- what powers a GIN index on a text column for fast ILIKE '%...%'.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent folds Norwegian characters for search: a query for "Alesund"
-- should find "Ålesund".
CREATE EXTENSION IF NOT EXISTS unaccent;
