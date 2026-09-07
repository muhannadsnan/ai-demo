-- Close the gaps in referential integrity, after establishing that the data
-- can actually satisfy the constraints.
--
-- Four candidate foreign keys were tested against the loaded data first. Three
-- can be enforced once two data issues are fixed; the fourth cannot, and the
-- reason is recorded rather than the constraint quietly omitted.

-- ---------------------------------------------------------------------------
-- 1. "00.000" is not an industry code.
--
-- 60,155 companies carry naeringskode1_kode = '00.000' with the description
-- "Uoppgitt" — Brreg's placeholder for "no industry code assigned". It is not
-- in SSB's classification and never will be. Storing a magic value where the
-- meaning is "unknown" is what NULL is for: as a code it silently joins to
-- nothing, sorts oddly, and turns up in GROUP BY as though it were an industry.
UPDATE enheter SET naeringskode1_kode = NULL, naeringskode1_beskrivelse = NULL
WHERE naeringskode1_kode = '00.000';

-- ---------------------------------------------------------------------------
-- 2. Jan Mayen, like Svalbard, is absent from SSB's municipality list.
-- One postcode (8099 JAN MAYEN) references municipality 2211.
INSERT INTO fylker (fylkesnummer, navn) VALUES ('22', 'Jan Mayen')
ON CONFLICT (fylkesnummer) DO NOTHING;
INSERT INTO kommuner (kommunenummer, navn) VALUES ('2211', 'Jan Mayen')
ON CONFLICT (kommunenummer) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. The constraints themselves. NOT VALID would skip checking existing rows;
-- these are validated, because the point is to prove the data is clean.
ALTER TABLE enheter
    ADD CONSTRAINT enheter_kommune_fkey
    FOREIGN KEY (forretningsadresse_kommunenummer) REFERENCES kommuner(kommunenummer);

ALTER TABLE enheter
    ADD CONSTRAINT enheter_naeringskode1_fkey
    FOREIGN KEY (naeringskode1_kode) REFERENCES naeringskoder(kode);

ALTER TABLE postnummer
    ADD CONSTRAINT postnummer_kommune_fkey
    FOREIGN KEY (kommunenummer) REFERENCES kommuner(kommunenummer);

-- ---------------------------------------------------------------------------
-- 4. NOT added: enheter.overordnet_enhet -> enheter.
--
-- Two companies name a parent that is absent from the bulk download, although
-- both parents return HTTP 200 from Brreg's per-company API — they exist, they
-- are simply not in this file. Adding the constraint would abort a future
-- import over two rows out of 1.17 million, and the failure would arrive at
-- 01:15 in a cron log. The parent link is followed with a LEFT JOIN, which
-- handles a missing parent correctly anyway.
