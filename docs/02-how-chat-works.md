# 02 · How the chat works

Files: `server/api/chat.post.ts`, `app/pages/chat.vue`, `app/composables/useAiStream.ts`

## The whole API in one shape

Strip away the SDKs and a chat model is one HTTP endpoint that takes a list of
messages and returns another message:

```http
POST https://api.openai.com/v1/chat/completions
Authorization: Bearer sk-...
Content-Type: application/json

{
  "model": "gpt-4o-mini",
  "messages": [
    { "role": "system",    "content": "You are a helpful assistant." },
    { "role": "user",      "content": "What is an embedding?" },
    { "role": "assistant", "content": "A vector of numbers that..." },
    { "role": "user",      "content": "How long are they?" }
  ],
  "temperature": 0.3,
  "max_tokens": 800
}
```

That is it. That is the API you were blocked from for two years. Once you have
seen this, the rest is engineering you already know how to do.

## The three roles

- **`system`** — your instructions. Set by *your server*, on every request. This
  is where the assistant's job description, tone and constraints live.
- **`user`** — what the person typed.
- **`assistant`** — what the model said previously.

Note that `chat.post.ts` **rejects any `system` message sent by the browser**.
If the client can set the system prompt, the client can replace your careful
instructions with anything at all. Treat it exactly like a price field in a
shopping cart: it comes from the server, never the client.

## The model has no memory

This surprises everyone at first, and it explains a great deal of behaviour:

> The model is a pure function. Same messages in, same kind of answer out. It
> remembers nothing between calls.

A conversation feels continuous only because the client **resends the entire
history on every turn** — look at `chat.vue`, which posts `messages.value` in
full each time. The server forwards all of it.

Two consequences follow directly:

1. **Cost grows quadratically with conversation length.** Turn 20 pays for
   turns 1-19 all over again. A long chat is not linearly more expensive than a
   short one; it is dramatically more.
2. **You control the memory.** Truncating old turns, or summarising them into a
   single message, is *your* decision. `guardrails.ts` caps history at 20
   messages, which is the crudest possible version of this. Real products keep a
   rolling summary plus the last few verbatim turns.

## Tokens, and how to think about cost

Models bill per **token** — roughly a word-piece. English averages about **4
characters per token**, so a 1,000-character prompt is ~250 tokens. Input and
output are priced separately, and output is typically several times more
expensive than input.

The estimate you actually need:

```
cost ≈ (input_tokens × input_price + output_tokens × output_price) / 1,000,000
```

Concretely: check the current price per million tokens on your vendor's pricing
page, then multiply by your expected traffic. Do this *before* you build, not
after. The two numbers that dominate are (a) how much history you resend, and
(b) how long your answers are — which is exactly why `max_tokens` is set on every
call in this project.

Two habits worth forming immediately:

- **Set `max_tokens` on every request.** It is a hard ceiling on the expensive
  half. Without it a runaway generation can be 10× your expected cost.
- **Use the cheapest model that passes your evaluation.** The small models are
  many times cheaper than the large ones and are entirely adequate for
  summarising, classifying, extracting and answering from provided context —
  which is most of what production systems actually do.

## Temperature

`temperature` controls randomness. `0` is as close to deterministic as you get;
higher values produce more varied output.

- **Grounded answers, extraction, classification →** low (0-0.3). `ask.post.ts`
  uses 0.1, because you want the faithful reading of the retrieved passages, not
  a creative one.
- **Brainstorming, drafting, variation →** higher (0.7-1.0).

Note that even at `temperature: 0` output is not guaranteed identical across
calls. Do not design anything that depends on byte-exact reproducibility.

## Streaming

Without streaming, a ten-second answer is ten seconds of a spinner. With it, the
first words appear in a few hundred milliseconds. The generation takes exactly
as long either way — this is entirely a perceived-latency trick, and it is worth
the complexity because the perception gap is enormous.

Adding `"stream": true` changes the response from one JSON document into a
**Server-Sent Events** stream:

```
data: {"choices":[{"delta":{"content":"An"}}]}

data: {"choices":[{"delta":{"content":" embedding"}}]}

data: [DONE]
```

Three things about this bite people, and all three are handled in this code:

1. **Partial lines.** TCP splits wherever it likes; a chunk can end mid-JSON.
   Both `openai.ts` and `useAiStream.ts` keep a `buffer` and only process up to
   the last complete boundary. Skipping this works perfectly on localhost and
   corrupts intermittently in production — the worst possible failure mode.
2. **Errors arrive mid-stream.** Once the first byte is sent, the HTTP status is
   already 200 and you cannot switch to a 500. Errors have to travel *inside*
   the stream, which is why this project wraps every fragment in a typed
   envelope: `{type: 'delta'|'done'|'error'}`.
3. **Disconnects cost money.** If the user closes the tab, generation continues
   and you keep paying. `chat.post.ts` listens for `req.on('close')` and aborts.

## What the offline provider actually does

With `NUXT_AI_PROVIDER=mock`, `streamChat` returns a fixed template, word by
word, with a small delay. It is not a language model and it says so in its own
output.

Everything *else* is real: the routing, validation, rate limiting, the system
prompt assembly, the SSE encoding, the buffered client-side parsing, the abort
handling. So when you switch to a real provider, you are changing one file's
worth of behaviour, and any bug you hit is in the model interaction rather than
in the plumbing — because the plumbing has already been exercised.

For the search demo the mock does something more interesting; see `docs/03`.
