-- A record of every import run, so the status page can say what happened and
-- when, rather than guessing from row counts.
--
-- This is the difference between a demo that holds data and one that visibly
-- keeps itself current: "enheter last refreshed 04:12 today, 1,173,013 rows,
-- 312 changed" is a claim about a running system. A row count alone is not.

CREATE TABLE IF NOT EXISTS import_logg (
    id              bigserial   PRIMARY KEY,
    kilde           text        NOT NULL,   -- 'enheter', 'roller', 'aksjonar', ...
    startet_at      timestamptz NOT NULL DEFAULT now(),
    ferdig_at       timestamptz,
    status          text        NOT NULL DEFAULT 'kjorer'
                    CHECK (status IN ('kjorer','ok','feilet')),
    rader_lest      bigint,
    rader_nye       bigint,
    rader_endret    bigint,
    rader_uendret   bigint,
    rader_slettet   bigint,
    varighet_ms     integer,
    feilmelding     text,
    detaljer        jsonb
);

CREATE INDEX IF NOT EXISTS import_logg_kilde_idx ON import_logg (kilde, startet_at DESC);

-- The most recent run per source, which is what a status page actually asks for.
CREATE OR REPLACE VIEW import_status AS
SELECT DISTINCT ON (kilde)
    kilde, startet_at, ferdig_at, status,
    rader_lest, rader_nye, rader_endret, rader_uendret, rader_slettet,
    varighet_ms, feilmelding,
    now() - startet_at AS alder
FROM import_logg
ORDER BY kilde, startet_at DESC;
