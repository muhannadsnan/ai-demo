# 01 · Architecture

## The one rule

```
  browser  ──►  YOUR SERVER  ──►  model vendor
                     ▲
                     └── API key, auth, rate limits, prompts, logging, cost control
```

The browser must never hold the API key and must never call the model vendor
directly. This is not an AI-specific rule; it is the same reason your MySQL
credentials are not in JavaScript. But it is worth stating explicitly because a
great many AI tutorials break it, and because an LLM key is unusually dangerous
to leak: it is a metered credential attached to a company credit card, and a
leaked one gets scraped and drained within hours.

Everything in `server/` exists to be that middle box.

## The request path, concretely

Take a chat message. It travels:

| # | Where | What happens | File |
|---|---|---|---|
| 1 | Browser | User submits; the whole conversation is POSTed | `app/pages/chat.vue` |
| 2 | Server | Rate limit and validation | `server/utils/guardrails.ts` |
| 3 | Server | Your system prompt is prepended | `server/api/chat.post.ts` |
| 4 | Server | The active provider is looked up | `server/utils/ai/provider.ts` |
| 5 | Provider | HTTP call to the vendor, response parsed | `server/utils/ai/openai.ts` |
| 6 | Server | Fragments forwarded to the browser as SSE | `server/api/chat.post.ts` |
| 7 | Browser | Fragments appended to the visible reply | `app/composables/useAiStream.ts` |

Steps 2, 3 and 6 are the ones that only exist because you own the middle box.
They are also the ones that make the difference between a demo and a product.

## Why a provider abstraction

`server/utils/ai/types.ts` defines a two-method interface: `streamChat` and
`embed`. Three implementations satisfy it (`mock`, `openai`, `ollama`), and
`getAiProvider()` picks one from an environment variable.

This is an ordinary Strategy pattern — the same shape you would use for a
payment gateway or an SMS sender. Nothing about it is AI-specific. But it earns
its keep faster here than almost anywhere else, because:

- **You will switch vendors.** Companies move to Azure OpenAI for data-residency
  reasons, or to a cheaper gateway, more often than they change databases.
- **You cannot test against the real thing.** Model output is non-deterministic
  and costs money per call. Every test you write needs a stand-in, and it has to
  slot in at exactly this boundary.
- **You need to work before you have a key.** Which, as it happens, is the
  situation this demo was built in.

The test of whether the boundary is in the right place: *the application code
above it must not be able to tell which implementation is running.* In this
project, `chat.post.ts` and `ask.post.ts` contain no vendor names, no model
names, no URLs and no keys. That is the property to preserve.

## Configuration and secrets

`nuxt.config.ts` declares `runtimeConfig`, and the split is the important part:

```ts
runtimeConfig: {
  openaiApiKey: '',        // SERVER ONLY — never sent to the browser
  public: { appName: '' }  // shipped to the browser in the HTML payload
}
```

Anything under `public` is embedded in the page and readable by anyone with
developer tools. Anything above it stays in the Node process. Each key is
overridable by environment variable: `openaiApiKey` ← `NUXT_OPENAI_API_KEY`.

`.env` is gitignored. `.env.example` is committed, with the keys present and the
values blank — so a new developer knows what to set without ever seeing a secret.

## Why Nuxt and not plain Vue

A plain Vue 3 SPA has no server. You would need a separate backend for the API
key anyway, which for you probably means a PHP endpoint in the existing project.
That is a perfectly legitimate architecture — see `docs/04`.

Nuxt gives you both halves in one project (`server/api/` is a real Node server),
which makes it a much better place to *learn* the shape, because the whole
request path is visible in one repository.

## What is deliberately missing

No database, no queue, no auth, no vector database. Each of those is a real
production requirement and each one is discussed in `docs/05`. They are left out
here because every one of them would obscure the roughly 300 lines that actually
constitute the AI integration.
