# AI Demo — Nuxt 4 / Vue 3

A small, deliberately readable AI integration. Two features, built the way you
would build them in a product rather than the way tutorials build them:

1. **Streaming chat** — the minimum viable AI feature.
2. **AI search over your own documents (RAG)** — the "todo list" of AI search:
   chunk, embed, rank by cosine similarity, then answer from the retrieved
   passages with citations.

Everything AI-related happens on the server. The browser never sees an API key,
never talks to a model vendor, and cannot change the system prompt.

---

## Run it

```bash
npm install --legacy-peer-deps   # see "Known install issue" below
npm run dev                      # http://localhost:3000
```

It works immediately, with **no API key**. The default provider is an offline
stand-in (`mock`) that fakes the language model but does everything else for
real — the routing, the streaming, the retrieval and the ranking are all
genuine. See `docs/02` for exactly what is and is not simulated.

```bash
npm run eval    # retrieval quality regression suite (dev server must be running)
npm run build   # production build
```

---

## Choosing a backend

Edit `.env`, then restart the dev server.

| `NUXT_AI_PROVIDER` | Needs | Cost | What you get |
|---|---|---|---|
| `mock` *(default)* | nothing | free | Real retrieval; replies are extractive, not generated |
| `ollama` | [Ollama](https://ollama.com) installed locally | free | A real language model, running on your own machine |
| `openai` | an API key | paid | The real thing |

**No key yet?** Use `ollama`. It gives you genuinely working AI today without
waiting on anyone:

```bash
ollama pull llama3.2          # chat model, ~2 GB
ollama pull nomic-embed-text  # embedding model, ~275 MB
# then set NUXT_AI_PROVIDER=ollama in .env
```

When a key does arrive, put it in `.env` as `NUXT_OPENAI_API_KEY` and switch
`NUXT_AI_PROVIDER=openai`. **No application code changes.** That is the point of
the provider abstraction in `server/utils/ai/`.

---

## Where to read, in order

New to this? `docs/00-the-basics.md` is the only one you need to begin with.

| File | What it covers |
|---|---|
| **`docs/00-the-basics.md`** | **Start here.** The whole thing without jargon |
| `docs/01-architecture.md` | The request path, and why it must be shaped this way |
| `docs/02-how-chat-works.md` | Prompts, tokens, streaming, memory, cost |
| `docs/03-how-ai-search-works.md` | Embeddings and RAG, end to end |
| `docs/04-porting-this-to-codeigniter-mysql.md` | The same thing in PHP 8 + MySQL 8 |
| `docs/05-production-checklist.md` | What to fix before this touches customers |
| `docs/06-glossary.md` | The vocabulary, defined plainly |

Plus one companion doc, not part of the learning sequence:

| File | What it covers |
|---|---|
| `docs/ai-use-cases-company-data.md` | AI features for the Norwegian company-data project, and the order to build them |

The source files are commented for a first-time reader. Read them alongside the
running app — that pairing is the actual documentation.

---

## Layout

```
app/                      Vue 3 front end (Nuxt 4 keeps client code here)
  pages/chat.vue            Demo 1 — streaming chat UI
  pages/search.vue          Demo 2 — retrieval + RAG UI
  composables/useAiStream   Reading a Server-Sent Events stream in the browser

server/                   Everything with an API key near it
  api/chat.post.ts          Streaming chat endpoint
  api/search.post.ts        Retrieval only, no language model
  api/ask.post.ts           RAG: retrieve -> augment -> generate
  api/health.get.ts         Which backend is actually plugged in
  utils/ai/                 The provider abstraction (mock | openai | ollama)
  utils/rag/                Chunking, vector maths, the index
  utils/guardrails.ts       Rate limiting and input validation

knowledge/                The corpus that gets indexed — replace with your own
server-drift/             Docker image, compose stack, deploy runbook
scripts/eval-retrieval.mjs Retrieval regression suite
```

---

## Deliberate choices worth knowing about

- **No vendor SDK.** `server/utils/ai/openai.ts` uses plain `fetch`, because the
  transferable knowledge is the HTTP contract — which is what you will
  re-implement in PHP with cURL. An SDK hides exactly the part worth learning.
- **No UI framework.** Plain CSS, so nothing distracts from the integration.
- **No database.** The vector index is an array in memory, rebuilt at startup.
  For 33 chunks that is the correct engineering decision. `docs/03` explains
  when it stops being correct.
- **An offline provider that is honest about being offline.** It never pretends
  to be a language model, and the UI always shows which backend answered.

## Known install issue

npm 10.8.2 has an [arborist bug](https://github.com/npm/cli/issues) that fails
on this dependency tree with `Cannot read properties of null (reading 'edgesOut')`.
`npm install --legacy-peer-deps` works around it. Upgrading npm (`npm i -g npm@latest`)
also fixes it.

This project is pinned to `nuxt@^4.3` because Nuxt 4.5+ requires Node 22, and
this machine is on Node 20.19.6 (`.nvmrc`). Once you move to Node 22, `npm i nuxt@latest`
and the pin can go.
