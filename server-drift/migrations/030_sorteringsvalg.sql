-- Indexes for the sort options in the company search.
--
-- Sorting is not free in PostgreSQL any more than it is in MySQL. Without a
-- matching index, ORDER BY over 1,173,078 rows is a top-N heapsort: Postgres
-- still reads every candidate row, it just keeps only the best ten. Measured on
-- an unfiltered search:
--
--     ORDER BY navn                            318 ms
--     ORDER BY stiftelsesdato DESC             284 ms
--     ORDER BY registreringsdato DESC          281 ms
--     ORDER BY antall_ansatte DESC (indexed)  0.02 ms
--
-- An index whose order already matches the ORDER BY turns the sort into a walk:
-- Postgres reads the first ten entries and stops. That is the whole difference.
--
-- All partial on `slettet_dato IS NULL`, matching the search's own WHERE, so
-- deleted companies are not carried in the index at all.
--
-- `navn` is the tie-breaker on every one of them: without a total order,
-- pagination can show the same company on two pages, because rows that compare
-- equal may come back in a different order on the next query.

CREATE INDEX IF NOT EXISTS enheter_sort_navn_idx
    ON enheter (navn) WHERE slettet_dato IS NULL;

CREATE INDEX IF NOT EXISTS enheter_sort_registrert_idx
    ON enheter (registreringsdato_enhetsregisteret DESC NULLS LAST, navn)
    WHERE slettet_dato IS NULL;

CREATE INDEX IF NOT EXISTS enheter_sort_stiftet_idx
    ON enheter (stiftelsesdato ASC NULLS LAST, navn)
    WHERE slettet_dato IS NULL;
