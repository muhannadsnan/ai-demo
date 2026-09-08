-- Index the default search ordering.
--
-- The company list sorts by headcount descending, and with no filters that was
-- a parallel sequential scan over 1.17M rows for the top 25 — 469 ms of pure
-- sorting to answer the most common page load in the application.
--
-- Partial on `slettet_dato IS NULL` because every search excludes deleted
-- companies, so the index covers exactly the rows any query will look at.
CREATE INDEX IF NOT EXISTS enheter_sok_sortering_idx
    ON enheter (antall_ansatte DESC NULLS LAST, navn)
    WHERE slettet_dato IS NULL;
