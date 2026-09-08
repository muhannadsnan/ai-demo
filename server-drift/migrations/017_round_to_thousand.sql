-- Store all accounting figures rounded to the nearest thousand.
--
-- The bulk historical source arrives already rounded to tusen kroner; the live
-- API returns exact kroner. Keeping both meant two precisions in one column,
-- so a company's 2024 figure and its 2025 figure were not strictly comparable
-- and any aggregate silently mixed the two.
--
-- Rounding on write makes every row consistent, and the interface presents
-- everything as "tall i tusen" anyway. The trade is that exact kroner from the
-- API are not recoverable afterwards — the raw API response is still kept in
-- `regnskap.raw`, so nothing is truly lost, but the typed columns are now
-- uniformly thousand-grained.

UPDATE regnskap SET
    sum_driftsinntekter          = round(sum_driftsinntekter          / 1000) * 1000,
    sum_driftskostnad            = round(sum_driftskostnad            / 1000) * 1000,
    driftsresultat               = round(driftsresultat               / 1000) * 1000,
    sum_finansinntekter          = round(sum_finansinntekter          / 1000) * 1000,
    sum_finanskostnad            = round(sum_finanskostnad            / 1000) * 1000,
    netto_finans                 = round(netto_finans                 / 1000) * 1000,
    ordinaert_resultat_for_skatt = round(ordinaert_resultat_for_skatt / 1000) * 1000,
    aarsresultat                 = round(aarsresultat                 / 1000) * 1000,
    sum_eiendeler                = round(sum_eiendeler                / 1000) * 1000,
    sum_anleggsmidler            = round(sum_anleggsmidler            / 1000) * 1000,
    sum_omloepsmidler            = round(sum_omloepsmidler            / 1000) * 1000,
    sum_egenkapital              = round(sum_egenkapital              / 1000) * 1000,
    sum_innskutt_egenkapital     = round(sum_innskutt_egenkapital     / 1000) * 1000,
    sum_opptjent_egenkapital     = round(sum_opptjent_egenkapital     / 1000) * 1000,
    sum_gjeld                    = round(sum_gjeld                    / 1000) * 1000,
    sum_kortsiktig_gjeld         = round(sum_kortsiktig_gjeld         / 1000) * 1000,
    sum_langsiktig_gjeld         = round(sum_langsiktig_gjeld         / 1000) * 1000
WHERE kilde = 'brreg-api';

COMMENT ON TABLE regnskap IS
  'Annual accounts. All amounts are stored rounded to the nearest 1000, matching the bulk historical source, and are presented as "tall i tusen". The exact API response is preserved in `raw` on kilde=''brreg-api'' rows.';
