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
 * NOT for money. Accounting figures are shown in full, in thousands, because
 * the exact number is the entire point of an accounts table.
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
