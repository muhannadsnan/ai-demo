-- The corporate ownership graph, as edges.
--
-- The ownership network walks this graph recursively in both directions. Doing
-- that against `aksjonar` meant re-aggregating 3.09 million holdings into
-- edges on every request, inside the recursive term — 3.2 seconds for one
-- company page.
--
-- Summed per (owner, company) so a stake held through two share classes is one
-- edge and not two, and restricted to holdings where BOTH ends are companies:
-- an individual is never a node in this graph. 536,013 edges.
--
-- Refreshed by the nightly job, alongside regnskap_siste.

DROP MATERIALIZED VIEW IF EXISTS eierskap_kant;

CREATE MATERIALIZED VIEW eierskap_kant AS
SELECT eier_orgnr,
       organisasjonsnummer,
       round(sum(andel_prosent), 2) AS andel
FROM aksjonar
WHERE eier_orgnr IS NOT NULL
  AND regnskapsaar = (SELECT max(regnskapsaar) FROM aksjonar)
GROUP BY 1, 2;

-- Unique index: required for REFRESH ... CONCURRENTLY, which is what keeps the
-- site answering while the view rebuilds.
CREATE UNIQUE INDEX eierskap_kant_pkey ON eierskap_kant (eier_orgnr, organisasjonsnummer);

-- One index per direction of travel. The walk upwards looks up by the owned
-- company, the walk downwards by the owner, and a single index cannot serve
-- both as the leading column.
CREATE INDEX eierskap_kant_eier_idx ON eierskap_kant (eier_orgnr);
CREATE INDEX eierskap_kant_selskap_idx ON eierskap_kant (organisasjonsnummer);
