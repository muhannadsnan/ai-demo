-- Svalbard is not in SSB's municipality classification.
--
-- 660 companies carry kommunenummer 2100 (SVALBARD), which does not appear in
-- classification 131 because Svalbard is not a municipality in the ordinary
-- sense and belongs to no county. Left alone, every join from `enheter` through
-- `kommuner` silently drops those 660 companies — an inner join quietly
-- becoming a filter is one of the easier ways to lose data without noticing.
--
-- Adding it explicitly, with codes that match Brreg's own usage, so the join is
-- total and the special case is visible in the data rather than remembered.
--
-- Jan Mayen (2200) was checked for and does not occur in the current dataset.

INSERT INTO fylker (fylkesnummer, navn)
VALUES ('21', 'Svalbard')
ON CONFLICT (fylkesnummer) DO NOTHING;

INSERT INTO kommuner (kommunenummer, navn)
VALUES ('2100', 'Svalbard')
ON CONFLICT (kommunenummer) DO NOTHING;
