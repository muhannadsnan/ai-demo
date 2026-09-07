-- Make the person-name trigram index unconditional.
--
-- 006 created it as a partial index (`WHERE person_etternavn IS NOT NULL`),
-- which is space-efficient and a trap. Postgres can only use a partial index
-- when it can prove the query implies the index predicate, so this query:
--
--   WHERE (fornavn || ' ' || etternavn) ILIKE '%aarrestad%'
--
-- silently fell back to a sequential scan, while the same query with
-- `AND person_etternavn IS NOT NULL` used the index. Measured on 3.4M roles:
--
--   without the predicate    535 ms   Parallel Seq Scan
--   with the predicate         5.7 ms Bitmap Index Scan
--
-- A 93x regression, and nothing warns you — the query still returns the right
-- answer. The partial version saved roughly 25 MB out of 123 MB.
--
-- Rule of thumb this illustrates: partial indexes are fine for queries your own
-- code issues, where the predicate is guaranteed. For a column people will
-- query ad hoc — in DBeaver, in a report, in a query the AI layer writes — the
-- index should not depend on remembering an incantation.

DROP INDEX IF EXISTS roller_person_navn_trgm_idx;

CREATE INDEX roller_person_navn_trgm_idx ON roller
    USING gin ((coalesce(person_fornavn,'') || ' ' || coalesce(person_etternavn,'')) gin_trgm_ops);
