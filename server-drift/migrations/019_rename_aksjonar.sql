-- Shorten the names.
--
--     aksjonar              the VIEW — what everything reads. No personal data.
--     aksjonar_persondata   the TABLE — restricted, written only by the importer.
--
-- `aksjeeie` matched the source filename; `aksjonar` matches what the data
-- actually is and what the register is called (Aksjonærregisteret). ASCII, like
-- every other table here.
--
-- The suffix on the table is kept deliberately: it is the one object that must
-- not be read casually, and a name that says so is worth more than brevity.
ALTER TABLE aksjeeie_persondata RENAME TO aksjonar_persondata;

DROP VIEW IF EXISTS aksjeeie;

CREATE VIEW aksjonar AS
SELECT
    id, regnskapsaar, organisasjonsnummer, selskap_navn, aksjeklasse,
    er_person,
    eier_orgnr,
    CASE WHEN er_person THEN NULL ELSE eier_navn END      AS eier_navn,
    CASE WHEN er_person THEN NULL ELSE eier_landkode END  AS eier_landkode,
    antall_aksjer, antall_aksjer_selskap, andel_prosent
FROM aksjonar_persondata;

COMMENT ON VIEW aksjonar IS
  'Aksjonærer uten personopplysninger. Foretak vises i sin helhet; privatpersoner vises kun med eierandel. Dette er objektet applikasjonen skal lese.';

COMMENT ON TABLE aksjonar_persondata IS
  'BEGRENSET. Inneholder navn, fødselsår og postnummer for 2,5 millioner privatpersoner, fra Skatteetatens Aksjonærregister, underlagt personopplysningsloven. Skal ikke publiseres. Les visningen `aksjonar` i stedet.';
