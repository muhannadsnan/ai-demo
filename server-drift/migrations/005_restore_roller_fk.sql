-- 004 dropped `enheter` with CASCADE, which silently took the foreign key on
-- `roller` with it. Postgres said so in a NOTICE, which is easy to miss in a
-- deploy log.
--
-- Worth remembering: DROP ... CASCADE removes dependent objects in other
-- tables. Whenever a migration uses it, check what else went. Re-adding the
-- constraint here rather than editing 004, because 004 has already run — an
-- applied migration is history and does not get rewritten.

ALTER TABLE roller
    ADD CONSTRAINT roller_organisasjonsnummer_fkey
    FOREIGN KEY (organisasjonsnummer)
    REFERENCES enheter(organisasjonsnummer)
    ON DELETE CASCADE;
