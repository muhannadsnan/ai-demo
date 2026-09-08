-- Full-text search over what companies say they actually do.
--
-- `aktivitet` and `vedtektsfestet_formaal` are free prose written by the
-- company itself: 940,807 rows have a real description, 1,172,704 have one of
-- the two. This is the only genuinely unstructured text in the dataset, and it
-- holds things no code can express — "undervannssveising", "matlevering fra
-- butikker og restauranter" — because NACE has 738 leaf codes and Norwegian
-- business does not fit in 738 boxes.
--
-- Stored generated column rather than an expression index: the same tsvector is
-- wanted for ranking (ts_rank) as for matching, and computing it twice per
-- query to save 300 MB is the wrong trade at this size.
--
-- 'norwegian' is a real Postgres text search configuration — it stems Norwegian
-- and drops Norwegian stop words, so "sveising" also matches "sveiser".

ALTER TABLE enheter
  ADD COLUMN IF NOT EXISTS fritekst tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('norwegian'::regconfig, coalesce(navn, '')), 'A') ||
    setweight(to_tsvector('norwegian'::regconfig, coalesce(aktivitet, '')), 'B') ||
    setweight(to_tsvector('norwegian'::regconfig, coalesce(vedtektsfestet_formaal, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS enheter_fritekst_idx ON enheter USING gin (fritekst);
