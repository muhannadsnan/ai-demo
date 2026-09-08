-- The latest annual accounts per company, as one indexed row.
--
-- Two things need this. The search filters on ranges ("companies with revenue
-- between 10 and 50 million"), and every accounts toplist ranks on the same
-- figures. Both were computing "the newest row per company" over 4.96 million
-- rows on every call: 8.4 seconds per toplist, and hopeless for a search filter.
--
-- A materialised view is the right shape because the underlying data changes
-- once a day at most. It is refreshed by the same nightly job that rebuilds the
-- toplists.
--
-- `rimelig` carries the plausibility check that used to live in the toplist
-- queries. A small number of filings each year are reported in kroner where the
-- file is in thousands, making the figure 1000x too large. Measured: 19 of
-- 232,531 companies jumped over 500x from 2024 to 2025, and 16 of 231,525 did
-- the same from 2023 to 2024 — the same rate in both years, so it is noise in
-- the source rather than something the import introduced. Harmless in
-- aggregate, fatal to a ranking, so it is flagged here once instead of being
-- re-derived by every query that cares.

DROP MATERIALIZED VIEW IF EXISTS regnskap_siste;

CREATE MATERIALIZED VIEW regnskap_siste AS
WITH siste AS (
    SELECT DISTINCT ON (organisasjonsnummer) *
    FROM regnskap
    WHERE valuta = 'NOK'
    ORDER BY organisasjonsnummer, periode_til DESC
),
forrige AS (
    SELECT DISTINCT ON (r.organisasjonsnummer)
           r.organisasjonsnummer,
           r.sum_driftsinntekter AS forrige_inntekter,
           r.periode_til        AS forrige_periode
    FROM regnskap r
    JOIN siste s USING (organisasjonsnummer)
    WHERE r.periode_til < s.periode_til AND r.valuta = 'NOK'
    ORDER BY r.organisasjonsnummer, r.periode_til DESC
)
SELECT s.organisasjonsnummer,
       s.periode_til,
       extract(year FROM s.periode_til)::int AS aar,
       s.sum_driftsinntekter,
       s.sum_driftskostnad,
       s.driftsresultat,
       s.aarsresultat,
       s.sum_eiendeler,
       s.sum_egenkapital,
       s.sum_gjeld,
       f.forrige_inntekter,
       f.forrige_periode,
       -- Year-on-year change, precomputed so the growth lists do not divide.
       CASE WHEN f.forrige_inntekter > 0
            THEN round(100.0 * (s.sum_driftsinntekter - f.forrige_inntekter) / f.forrige_inntekter, 1)
       END AS vekst_prosent,
       (f.forrige_inntekter IS NULL
        OR f.forrige_inntekter <= 0
        OR s.sum_driftsinntekter <= f.forrige_inntekter * 50) AS rimelig
FROM siste s
LEFT JOIN forrige f USING (organisasjonsnummer);

-- Unique index is what REFRESH MATERIALIZED VIEW CONCURRENTLY requires: without
-- it the refresh takes an exclusive lock and the site stops answering while it
-- runs.
CREATE UNIQUE INDEX regnskap_siste_pkey ON regnskap_siste (organisasjonsnummer);

-- One index per field the search can filter a range on.
CREATE INDEX regnskap_siste_inntekter_idx ON regnskap_siste (sum_driftsinntekter) WHERE rimelig;
CREATE INDEX regnskap_siste_resultat_idx  ON regnskap_siste (aarsresultat)        WHERE rimelig;
CREATE INDEX regnskap_siste_drift_idx     ON regnskap_siste (driftsresultat)      WHERE rimelig;
CREATE INDEX regnskap_siste_ek_idx        ON regnskap_siste (sum_egenkapital)     WHERE rimelig;
CREATE INDEX regnskap_siste_eiendeler_idx ON regnskap_siste (sum_eiendeler)       WHERE rimelig;
CREATE INDEX regnskap_siste_vekst_idx     ON regnskap_siste (vekst_prosent)       WHERE rimelig;
