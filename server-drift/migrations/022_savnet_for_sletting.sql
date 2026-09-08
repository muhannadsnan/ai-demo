-- Confirm a disappearance before calling it a deletion.
--
-- THE PROBLEM THIS FIXES
--
-- The full-file import marked any company absent from the download as deleted.
-- That assumed the download is complete. It is not: companies were found that
-- are live in Brreg's API — active, not bankrupt, registered in 2009 — and
-- simply missing from the bulk CSV.
--
-- Left alone, those companies flip-flop nightly: the full import marks them
-- deleted because they are not in the file, and the incremental import revives
-- them because the API says they exist. Both are behaving correctly; the
-- assumption underneath them was wrong.
--
-- THE FIX
--
-- Absence is now recorded, not acted on. A company missing from the file gets
-- `savnet_siden`. Only if it is still missing after a grace period does it
-- become `slettet_dato`. Anything the API confirms alive has both cleared.
--
-- This is the same discipline as any reconciliation: one source disagreeing
-- with another is a question, not a verdict.

ALTER TABLE enheter ADD COLUMN IF NOT EXISTS savnet_siden date;

COMMENT ON COLUMN enheter.savnet_siden IS
  'First date this company was absent from a bulk download. Becomes slettet_dato only if it stays absent past the grace period. Cleared when the API confirms the company exists.';

-- Companies previously marked deleted may have been marked wrongly, so give
-- them the benefit of the confirmation step rather than leaving a bad verdict.
UPDATE enheter SET savnet_siden = slettet_dato, slettet_dato = NULL
WHERE slettet_dato IS NOT NULL;

CREATE INDEX IF NOT EXISTS enheter_savnet_idx ON enheter (savnet_siden)
    WHERE savnet_siden IS NOT NULL;
