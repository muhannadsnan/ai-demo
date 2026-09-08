-- Make the safe name the obvious name.
--
-- Until now `aksjeeie` was the table containing personal data and
-- `aksjeeie_offentlig` was the filtered view. That is the wrong way round:
-- someone writing the obvious query
--
--     SELECT * FROM aksjeeie
--
-- got 2.5 million names, birth years and postcodes. Safety depended on
-- remembering a second, longer name — and anything that depends on remembering
-- eventually fails.
--
-- After this migration:
--
--     aksjeeie              the VIEW. No personal data. What the application reads.
--     aksjeeie_persondata   the TABLE. Restricted. What the importer writes.
--
-- The obvious query is now the safe one, and reading the personal data requires
-- deliberately typing a name that says what it is.

ALTER TABLE aksjeeie RENAME TO aksjeeie_persondata;

-- The old view still points at the renamed table (Postgres tracks the object,
-- not the name), so drop it and recreate under the plain name.
DROP VIEW IF EXISTS aksjeeie_offentlig;

CREATE VIEW aksjeeie AS
SELECT
    id, regnskapsaar, organisasjonsnummer, selskap_navn, aksjeklasse,
    er_person,
    eier_orgnr,
    CASE WHEN er_person THEN NULL ELSE eier_navn END      AS eier_navn,
    CASE WHEN er_person THEN NULL ELSE eier_landkode END  AS eier_landkode,
    antall_aksjer, antall_aksjer_selskap, andel_prosent
FROM aksjeeie_persondata;

COMMENT ON VIEW aksjeeie IS
  'Share ownership without personal data. Corporate holders in full; individuals appear as an anonymous row carrying only their percentage. This is what application code should read.';

COMMENT ON TABLE aksjeeie_persondata IS
  'RESTRICTED. Contains names, birth years and postcodes of 2.5M private individuals, from Skatteetatens Aksjonærregister, subject to personopplysningsloven. Not for publication. Read the `aksjeeie` view instead. See docs/data-provenance-and-licensing.md.';
