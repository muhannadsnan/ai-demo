# 06 · Glossary

The vocabulary, defined plainly, with the backend analogy where an honest one
exists. Roughly ordered by how soon you will meet each term.

**Token** — a word-piece; how models count text and how vendors bill it. English
averages ~4 characters per token. Input and output are priced separately, output
usually costing several times more.

**Context window** — the maximum tokens a model can consider at once, prompt and
reply together. Exceeding it is a hard error, so long conversations and large
retrieved contexts must be trimmed. Think of it as a hard row limit on a query.

**Prompt** — everything you send. Not just the user's question: system
instructions, conversation history and retrieved context are all part of it, and
all billed.

**System prompt** — the instructions that define the assistant's job, set by your
server on every request. Never accept one from the client.

**Temperature** — randomness, roughly 0 to 1. Low for factual and grounded work,
higher for creative. Even 0 is not perfectly reproducible.

**Streaming** — returning the reply in fragments as it is generated, over
Server-Sent Events. Purely a perceived-latency improvement; total time is
unchanged.

**Hallucination** — fluent, confident, wrong. The model's job is producing
plausible continuations, and plausible is not the same as true. RAG with
citations reduces it by giving the model the facts and a way to point at them;
nothing eliminates it.

**Embedding** — a function `text → vector of floats`, where similar meanings
produce vectors pointing in similar directions. The basis of semantic search.

**Vector / dimensions** — the array itself. Real models produce 384-3072 numbers.
Individual numbers mean nothing; only the geometry between vectors does.

**Cosine similarity** — the angle between two vectors, ignoring magnitude. The
standard way to score "how related is this text". Fifteen lines of arithmetic.

**Chunk** — one retrievable piece of a document. Chunking strategy is where RAG
quality is mostly won or lost.

**RAG (retrieval-augmented generation)** — find the relevant passages first, put
them in the prompt, then ask. The standard way to make a model answer from data
it was never trained on.

**Grounding** — constraining the answer to provided sources. "Answer only from
the context below" is grounding; the citations are how you verify it worked.

**Top-K** — how many passages you retrieve. Typically 3-8. More context is not
better: it costs more and dilutes attention.

**Recall@k** — whether the correct passage appears in the top K. The ceiling on
your answer quality, because a passage that is never retrieved can never be cited.

**Vector database** — a store with an index for fast approximate nearest-neighbour
search (pgvector, Qdrant, Milvus, MySQL 9's `VECTOR`). Useful at scale; an array
or a MySQL table is the right starting point.

**ANN (approximate nearest neighbour)** — index structures (HNSW, IVF) that find
*probably* the closest vectors without scanning everything. The trade is a small
amount of recall for a large amount of speed.

**Hybrid search** — combining embedding similarity with keyword/BM25 scoring.
Usually the largest single quality win available, because embeddings are weak
exactly where keywords are strong: identifiers, error codes, table names.

**Reranking** — retrieve many candidates cheaply, then rescore the top ones with
a slower, more accurate model. Big precision gain for modest cost.

**BM25** — the classic keyword ranking function. What MySQL `FULLTEXT` and
Elasticsearch are doing. Not obsolete; complementary.

**TF-IDF** — term frequency × inverse document frequency: weight a word by how
often it appears here and how rare it is everywhere. What the offline provider in
this project uses, and the ancestor of BM25.

**Fine-tuning** — further training to change a model's *behaviour*. The wrong
tool for teaching it *facts*; use retrieval for that.

**Prompt injection** — text in the input or in a retrieved document that tries to
override your instructions. No complete defence exists. The mitigation that
matters: never let model output cause a side effect without a deterministic check.

**Tool use / function calling** — letting the model request that your code run a
function (look up an order, query a table) and return the result. The bridge from
"chatbot" to "agent", and the point at which prompt injection becomes dangerous
rather than merely embarrassing.

**Structured output** — constraining the reply to a JSON schema, so it can be
parsed rather than scraped. What you want whenever output feeds code.

**Agent** — a loop where the model chooses tools, observes results and continues
until done. Powerful, harder to make reliable, and much easier to reason about
once the pieces in this demo are second nature. Not where to start.

**Guardrails** — validation, rate limits, quotas, output checks. The unglamorous
half, and the half that decides whether the feature survives contact with users.

**Evaluation ("evals")** — a test suite for AI behaviour: fixed inputs, expected
properties, a score. `npm run eval` is one. Without it you are guessing about
every change you make.

---

## Delivery and operations

These come up in `server-drift/`, not in the AI code. Included here because they
are project-wide vocabulary.

**SSR (server-side rendering)** — the server sends finished HTML instead of a
blank page plus JavaScript. Faster first paint, and search engines can read it.
Nuxt does this by default.

**SSE (Server-Sent Events)** — a one-way HTTP connection held open so the server
can push text as it is produced. It is why an AI answer appears word by word
instead of all at once after ten seconds. One direction only, server to browser;
for two-way you would need WebSockets.

**Image** — a read-only template containing an operating system, a runtime and
your compiled application. Built once. Like a class, or a `.iso`.

**Container** — a running instance of an image. Like an object. One image can
run many containers.

**Volume** — storage that lives outside the container, so data survives when the
container is replaced. Databases belong in volumes. Never in images.

**Compose file** — one YAML file describing several containers and how they
connect, so `docker compose up` starts the whole stack instead of you typing
five `docker run` commands by hand.

**Kubernetes** — a system for scheduling containers across a *fleet* of machines,
restarting and rescheduling them automatically. Useful when you have many
services on many servers, or a team that needs self-service deploys. For one
server running one application it is pure overhead.

**Caddy** — a web server and reverse proxy. Its distinguishing feature is that
it obtains and renews HTTPS certificates automatically with no configuration.
The nginx equivalent needs certbot, a cron job and a renewal hook.

**Reverse proxy** — the server that receives public traffic and forwards it to
your application. Terminates HTTPS, so the app itself never handles certificates.

**Ops (operations)** — everything after the code is written: deploying it,
watching it, backing it up, restoring it, and fixing it at 23:00. A separate
discipline from development, and the one `server-drift/` exists to demonstrate.

**Ingest** — fetching data from an external source, validating it and loading it
into your own database. The same thing as an import routine; just the word the
data-engineering world uses.

**Meilisearch** — a standalone search engine run as its own service. You push
documents into it and it returns typo-tolerant results instantly. An alternative
to PostgreSQL's built-in full-text search, at the cost of one more service to
operate.

**Runbook** — a document listing named failure modes and the exact command to
run for each, written to be usable by someone who did not build the system.

**Restore** — rebuilding a working database from a backup. Note that *making* a
backup and *restoring* one are different operations, and only the second proves
anything.

**Restore drill** — deliberately performing a restore as practice, and recording
how long it took. A backup nobody has ever restored is a hypothesis, not a
safety net.

**PITR (point-in-time recovery)** — rewinding a database to an exact moment
("10:42, just before the bad UPDATE") rather than only to last night's dump. It
requires continuously archiving the transaction log, not just periodic dumps.

