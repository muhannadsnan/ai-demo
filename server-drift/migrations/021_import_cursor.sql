-- Where each incremental feed has been read to.
--
-- Brreg's oppdateringer endpoint is a SEQUENCE, not a time window: every event
-- carries an ever-increasing `oppdateringsid`, and you ask for everything after
-- the last one you handled.
--
-- That property is what makes gaps harmless. A "changed since yesterday" query
-- loses a night's changes permanently if a run is missed; a cursor just returns
-- a bigger batch next time. The importer can be off for a week, or fail, or be
-- deliberately paused, and it resumes exactly where it stopped.

CREATE TABLE IF NOT EXISTS import_cursor (
    kilde           text        PRIMARY KEY,
    siste_id        bigint      NOT NULL,
    siste_dato      timestamptz,
    oppdatert_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE import_cursor IS
  'Last processed oppdateringsid per feed. Resuming after a gap returns a larger batch, never a loss.';
