/**
 * Compact number formatting: 5,2k · 1,5m · 1,2b
 *
 * For counts that are context, not figures — how many companies are in a
 * municipality, how many rows a list holds. At that size the exact number is
 * noise: "Bergen 57 231" and "Bergen 57,2k" tell you the same thing, and the
 * second one lines up in a narrow column.
 *
 * The separator is a comma, not a point, because everything else on this site
 * is nb-NO formatted and a Norwegian reader takes "1.2b" as one thousand two
 * hundred b. The k/m/b letters are kept as-is.
 *
 * NOT for money in an accounts table — see belop() below for the money case and
 * the line that separates them.
 */
export function kort(n: number | null | undefined): string {
  if (n == null) return '—'
  const a = Math.abs(n)
  if (a < 1000) return String(n)

  const [del, suffiks] = a >= 1e9 ? [1e9, 'b'] : a >= 1e6 ? [1e6, 'm'] : [1e3, 'k']
  const v = n / del
  // One decimal below ten, none above: 5,2k but 57k, so the column stays even.
  const tekst = Math.abs(v) < 10
    ? v.toFixed(1).replace('.', ',').replace(',0', '')
    : v.toFixed(0)
  return tekst + suffiks
}

/**
 * Money, compactly, from an amount in KRONER: 1b kr · 35,5b · 396m · −236m
 *
 * The accounts table still shows figures in full — the exact number is the
 * entire point there, and that rule has not changed. This is for the places
 * where an amount is a *magnitude* rather than a figure: a search result line
 * and a filter chip. In those, "35 471 086" forces you to count digits to learn
 * that it means thirty-five billion, and counting digits is the one thing the
 * reader should never have to do.
 *
 * It also makes a wrong filter visible. Typing 1000000 into a field labelled
 * "tusen kroner" means one billion kroner, not one million — a chip reading
 * "1 000 000k" hides that, and one reading "1b kr" gives it away immediately.
 *
 * Takes kroner, not thousands, so every caller converts at one boundary.
 */
export function belopKort(kroner: number | null | undefined, medEnhet = false): string {
  if (kroner == null) return '—'
  const tekst = kort(kroner)
  return medEnhet ? `${tekst} kr` : tekst
}
