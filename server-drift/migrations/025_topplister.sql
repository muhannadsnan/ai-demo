-- Precomputed top lists.
--
-- One table, keyed by list type, with the rows as jsonb.
--
-- WHY THIS SHAPE
--
-- The lists have genuinely different columns — "recent bankruptcies" carries a
-- date, "largest by revenue" carries an amount, "most board seats" carries a
-- person. Twenty typed tables would be twenty migrations for one feature, and a
-- single wide table would be mostly nulls. The rows are read as a block and
-- rendered, never joined or filtered, so jsonb costs nothing here.
--
-- Regeneration is an upsert on `type`, so a daily job replaces each list in
-- place and a failed list leaves yesterday's data rather than an empty page.
--
-- These queries scan millions of rows and sort them; running them per request
-- would put several seconds on every page view for numbers that change once a
-- day.

CREATE TABLE IF NOT EXISTS topplister (
    type            text        PRIMARY KEY,
    tittel          text        NOT NULL,
    beskrivelse     text,
    kategori        text        NOT NULL,
    kolonner        jsonb       NOT NULL,   -- [{felt, tittel, format}] for rendering
    data            jsonb       NOT NULL,
    antall          integer     NOT NULL DEFAULT 0,
    generert_at     timestamptz NOT NULL DEFAULT now(),
    varighet_ms     integer,
    feilmelding     text
);

CREATE INDEX IF NOT EXISTS topplister_kategori_idx ON topplister (kategori, type);

COMMENT ON TABLE topplister IS
  'Ferdigberegnede topplister, fornyet daglig. En rad per liste; radene ligger som jsonb fordi listene har ulike kolonner og alltid leses samlet.';
