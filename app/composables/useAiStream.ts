/**
 * Reading a Server-Sent Events stream in the browser.
 *
 * WHY NOT `EventSource`?
 * ---------------------
 * The built-in `EventSource` API only does GET requests and cannot set headers
 * or send a body. We need to POST a conversation, so we use `fetch` and read
 * the response body ourselves. This is the standard approach and it is what
 * every AI chat UI you have used is doing under the hood.
 *
 * The parsing mirrors the server side exactly: buffer, split on the blank line
 * that terminates an SSE message, and keep any incomplete tail for next time.
 */

export interface StreamEvent {
  type: 'delta' | 'sources' | 'done' | 'error'
  [key: string]: unknown
}

export async function readAiStream(
  url: string,
  payload: unknown,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  })

  // Validation and rate-limit errors happen BEFORE streaming starts, so they
  // arrive as an ordinary JSON error response with a real status code.
  if (!res.ok) {
    const detail = await res.json().catch(() => null) as { statusMessage?: string } | null
    throw new Error(detail?.statusMessage || `Request failed with HTTP ${res.status}`)
  }
  if (!res.body) throw new Error('The server returned no stream')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // An SSE message ends with a blank line. Everything after the last blank
    // line may be a half-received message, so it stays in the buffer.
    const messages = buffer.split('\n\n')
    buffer = messages.pop() ?? ''

    for (const message of messages) {
      for (const line of message.split('\n')) {
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (!raw) continue
        try {
          onEvent(JSON.parse(raw) as StreamEvent)
        } catch {
          // A frame we cannot parse is not worth aborting the stream over.
        }
      }
    }
  }
}
