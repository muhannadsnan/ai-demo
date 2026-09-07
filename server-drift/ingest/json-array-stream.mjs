/**
 * Emit the top-level objects of a huge JSON array, one at a time.
 *
 * WHY THIS EXISTS
 * The roles file is a 2.8 GB pretty-printed JSON array. `JSON.parse` needs the
 * whole thing in memory, and Node cannot even hold it in a string (the cap is
 * around 512 MB). `jq -c '.[]'` reads it all too.
 *
 * So: scan the byte stream and track nesting depth. Each time depth returns to
 * zero after a top-level `{`, one complete object has been seen — emit it and
 * drop it from the buffer. Memory stays proportional to the largest single
 * object, not to the file.
 *
 * Braces inside strings do not count, and a quote preceded by a backslash does
 * not end a string. That is the whole parser.
 *
 * THE BUG THIS ONCE HAD, because it is an easy one to write:
 * the first version re-scanned the buffer from index 0 every time a chunk
 * arrived. Characters already examined were examined again, which re-toggled
 * `inString` and re-incremented `depth` — the state machine corrupted itself
 * and no object ever completed. `pos` exists so every character is examined
 * exactly once.
 */
export async function* streamJsonArrayObjects(readable) {
  let buf = ''
  let pos = 0            // next index to examine; never goes backwards over data
  let depth = 0
  let inString = false
  let escaped = false
  let start = -1         // index of the `{` that opened the current object

  for await (const chunk of readable) {
    buf += chunk

    while (pos < buf.length) {
      const c = buf[pos]

      if (escaped) {
        escaped = false
      } else if (c === '\\') {
        if (inString) escaped = true
      } else if (c === '"') {
        inString = !inString
      } else if (!inString) {
        if (c === '{') {
          if (depth === 0) start = pos
          depth++
        } else if (c === '}') {
          depth--
          if (depth === 0 && start !== -1) {
            yield buf.slice(start, pos + 1)
            buf = buf.slice(pos + 1)   // discard everything consumed
            pos = 0
            start = -1
            continue                   // do not advance past the new buf[0]
          }
        }
      }
      pos++
    }

    // Mid-object: drop the prefix before it so the buffer holds one object at
    // most, and shift the scan position to match.
    if (start > 0) {
      buf = buf.slice(start)
      pos -= start
      start = 0
    }
  }
}
