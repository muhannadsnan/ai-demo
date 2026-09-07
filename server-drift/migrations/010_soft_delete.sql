-- Detect and record deleted companies, without removing the rows.
--
-- Brreg does not flag deletions: a deleted company simply stops appearing in
-- the download. The upsert-based import never noticed, so deregistered
-- companies accumulated in the table forever, looking active.
--
-- WHY NOT ACTUALLY DELETE THEM
--
-- 1. `roller` references `enheter` ON DELETE CASCADE, so removing one company
--    silently destroys every board seat, directorship and auditor appointment
--    attached to it. The history disappears with no trace and no error.
-- 2. "This company was deregistered on 4 March" is a fact worth showing. It is
--    the single most interesting thing that ever happens to most companies.
-- 3. A deletion that turns out to be wrong — or a company that re-registers —
--    is recoverable when the row is still there.
--
-- HOW IT IS DETECTED
--
-- No feed needed: the full file is a complete snapshot, so anything in
-- `enheter` that is absent from staging is gone. One set difference per import.

ALTER TABLE enheter ADD COLUMN IF NOT EXISTS slettet_dato date;

COMMENT ON COLUMN enheter.slettet_dato IS
  'Date this company was first seen missing from the Brreg full download. NULL = still present.';

-- Every listing query should exclude deleted companies, so fold it into the
-- index that already serves them.
DROP INDEX IF EXISTS enheter_active_idx;
CREATE INDEX enheter_active_idx
    ON enheter (forretningsadresse_kommunenummer, antall_ansatte)
    WHERE slettet_dato IS NULL
      AND NOT konkurs AND NOT under_avvikling AND NOT under_tvangsavvikling;

-- Finding recently deregistered companies is its own useful query.
CREATE INDEX IF NOT EXISTS enheter_slettet_idx ON enheter (slettet_dato)
    WHERE slettet_dato IS NOT NULL;
