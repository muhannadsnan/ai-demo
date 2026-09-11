/**
 * Download a bulk file, but only if theirs is newer than ours.
 *
 * WHY NOT JUST PICK A SAFER HOUR
 *
 * Brreg regenerates these files in the early morning — measured today, the
 * company file was stamped 04:27 and the roles file 04:03 — which is inside the
 * window these jobs run in. Shifting the schedule an hour later would make the
 * collision less likely without making it impossible: the generation time moves,
 * a run can be slow, a machine can wake late.
 *
 * Asking instead of guessing removes the question. `If-Modified-Since` with the
 * timestamp of the copy we already hold gets a 304 when nothing has changed and
 * the file when it has. Running at an awkward moment then costs nothing: we
 * either get the new file or keep the old one, and the next run picks up what
 * we missed. No window to be on the wrong side of.
 *
 * It also fixes something worse. These importers read a file somebody had
 * downloaded by hand, and a stale one is not merely useless — the deletion
 * reconciliation treats every company registered since that download as missing
 * and retires it once the grace period passes. A file that refreshes itself
 * cannot go stale enough to do that.
 */
import { createWriteStream, existsSync, statSync, renameSync, mkdirSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { dirname } from 'node:path'

/**
 * @returns {Promise<{sti: string, lastetNed: boolean, alder: string}>}
 */
export async function hentHvisNyere(url, sti) {
  mkdirSync(dirname(sti), { recursive: true })

  const headers = { 'accept-encoding': 'identity' }
  if (existsSync(sti)) {
    headers['if-modified-since'] = statSync(sti).mtime.toUTCString()
  }

  const svar = await fetch(url, { headers })

  if (svar.status === 304) {
    console.log(`  ${sti}: allerede nyeste versjon (304)`)
    return { sti, lastetNed: false, alder: statSync(sti).mtime.toISOString() }
  }
  if (!svar.ok) {
    // A download failure must not look like an empty register. Keeping the old
    // file and failing loudly is the safe direction.
    throw new Error(`nedlasting feilet: ${svar.status} ${svar.statusText}`)
  }

  const stemplet = svar.headers.get('last-modified')
  const forventet = Number(svar.headers.get('content-length') || 0)
  console.log(`  laster ned ${(forventet / 1e6).toFixed(0)} MB (publisert ${stemplet ?? 'ukjent'}) …`)

  // Written beside the target and renamed into place. An interrupted download
  // that overwrote the real file would leave a truncated archive, and the next
  // run would import a partial register — which the deletion logic would read
  // as thousands of companies disappearing at once.
  const midlertidig = `${sti}.lastes-ned`
  await pipeline(Readable.fromWeb(svar.body), createWriteStream(midlertidig))

  const faktisk = statSync(midlertidig).size
  if (forventet && faktisk !== forventet) {
    throw new Error(`ufullstendig nedlasting: fikk ${faktisk} av ${forventet} bytes`)
  }

  renameSync(midlertidig, sti)
  console.log(`  ${sti}: ${(faktisk / 1e6).toFixed(0)} MB lagret`)
  return { sti, lastetNed: true, alder: stemplet ?? new Date().toISOString() }
}
