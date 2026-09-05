# 03 · How the AI search works (RAG)

Files: `server/utils/rag/`, `server/api/search.post.ts`, `server/api/ask.post.ts`

You asked what the "todo list app" of AI search is. This is it:
**retrieval-augmented generation over a set of documents you own** — commonly
sold as "chat with your docs". Nearly every AI product with a search box is
some elaboration of what follows.

## The problem it solves

The model was trained on public text up to some cutoff date. It has never seen
your internal handbook, your ticket history or last week's incident report. Ask
it about your Integration Bus retry policy and it will either say it does not
know, or — worse — produce a fluent, plausible, entirely invented answer.

There are two ways to fix that. Only one of them is a good idea for you:

| | Fine-tuning | **Retrieval (RAG)** |
|---|---|---|
| What it does | Adjusts the model's weights | Puts the relevant text in the prompt |
| Cost | Training runs, per model, per update | An embedding call per document, once |
| Updating a fact | Retrain | Edit the file, re-index |
| Can cite sources | No | **Yes** |
| Skills required | ML engineering | Backend engineering |
| Good at | Teaching *style, format, behaviour* | Teaching *facts* |

For "answer questions about our documents", retrieval wins on every row that
matters. Fine-tuning is for when you need the model to consistently *behave* a
certain way, not for when you need it to *know* something. Reach for RAG first;
you will rarely need the other.

## The idea in one line

> Before asking the question, go and find the relevant pages yourself, and paste
> them into the prompt.

That is genuinely the whole trick. The interesting engineering is entirely in
"find the relevant pages" — which is a search problem, not a machine-learning
problem, and one your instincts already apply to.

## Embeddings

An **embedding** is a function `text → array of floats`, with one useful
property: texts that mean similar things produce vectors that point in similar
directions.

```
"the retry policy backs off exponentially"  ->  [0.021, -0.114, 0.077, ...]
"how many times do failed messages retry?"  ->  [0.019, -0.108, 0.081, ...]   close
"the customs office closes at 16:00"        ->  [-0.201, 0.043, -0.150, ...]  far
```

Real models return 384 to 3072 numbers per text. The numbers individually mean
nothing; only the geometry between vectors carries information.

The comparison is **cosine similarity** — the angle between two vectors,
ignoring their length:

```
cos(a,b) = (a · b) / (|a| × |b|)
```

Fifteen lines of arithmetic in `server/utils/rag/vector.ts`. If both vectors are
pre-normalised to length 1 (which we do on write), it collapses to a plain dot
product. Every "AI-powered semantic search" you have read about is, at its core,
this function in a loop.

## The pipeline

### Indexing — once, ahead of time

```
knowledge/*.md
   │ 1. chunk        split into retrievable pieces      utils/rag/chunk.ts
   ▼
[ 33 chunks ]
   │ 2. embed        one batched API call               utils/ai/*.ts
   ▼
[ 33 vectors ]
   │ 3. store        kept in memory, normalised         utils/rag/store.ts
   ▼
the index
```

### Querying — per request

```
"how many times does a failed message retry?"
   │ 4. embed the question with the SAME model
   ▼
[ 1 vector ]
   │ 5. cosine against all 33, sort, take top K
   ▼
[ 4 candidate passages ]
   │ 6. filter by relevance score
   ▼
[ 1-3 passages worth using ]
   │ 7. paste into the prompt as <context>, ask the model
   ▼
a grounded answer, with [S1]-style citations
```

Steps 1-6 involve no language model at all. That is why `/api/search` exists as
its own endpoint and its own tab in the UI: **retrieval is a separate system and
it fails separately.** When a RAG answer is wrong, look at the retrieved
passages first. Nine times out of ten the answer was never in the prompt.

## Chunking is where quality is won or lost

Why not embed a whole document? Because one vector has to represent everything
the document says, and it ends up representing nothing in particular. A page
covering retries, authentication and throughput is not "close" to any of those
three questions.

The two failure modes:

- **Chunks too large** — the relevant sentence is diluted by surrounding text,
  the similarity score drops, and you pay to send a lot of irrelevant context.
- **Chunks too small** — the answer is split across two chunks and neither one
  alone looks relevant, so you retrieve neither.

`chunk.ts` uses the approach that holds up best in practice: split on the
document's own structure (headings) first, then cap by size (~900 characters),
with a small overlap so a sentence spanning a boundary survives intact somewhere.

One trick worth stealing: each chunk's embedded text is prefixed with
`DocTitle > Heading`. The heading words end up *inside* the vector, so a chunk
under `## Retry policy` is findable by the word "retry" even if its body never
repeats it. Cheap, and it measurably helps.

## The relevance threshold

Cosine ranking always returns your top K — even when nothing in the corpus is
relevant. It has no concept of "no good answer". Skip this step and an
off-topic question quietly gets answered from the three least-irrelevant
passages, complete with citations. That is how a RAG system starts making
things up while *looking* rigorous.

`ask.post.ts` applies two filters:

- an **absolute floor** (`0.07`) — below this, nothing is really about the question;
- a **relative floor** (`0.45 × top score`) — when one passage is clearly best,
  the tail behind it is padding that shrinks the prompt and drags the answer.

Those constants are **empirical, and specific to this corpus and this embedder**.
Measured here (`npm run eval`):

```
genuine matches   0.09 – 0.36
off-topic noise   0.05 – 0.064
```

That is an uncomfortably narrow gap, and it is an honest illustration of the
offline embedder's limits — a real embedding model separates the two far more
cleanly. **Re-measure whenever you change the model, the chunk size or the
corpus.** Never copy someone else's threshold.

## Evaluate it, don't eyeball it

`npm run eval` runs a golden set of question → expected-document pairs and
reports two numbers:

- **top-1** — was the best passage the right one?
- **recall@k** — was the right passage anywhere in the top K?

`recall@k` is the one that caps your quality: a passage that is never retrieved
can never be cited, however good the model is.

This file is the most under-appreciated part of the project. The moment you
change chunk size, stop words, the threshold or the embedding model, retrieval
quality moves — and without a measurement you will not know which direction.
Twelve golden questions will catch more real regressions than any amount of
manual poking. It is a regression test suite; treat it like one and put it in CI.

## What the offline embedder really is

With `NUXT_AI_PROVIDER=mock`, `embed()` produces a **TF-IDF vector** —
information-retrieval technology from the 1970s, described in `mock.ts`:

- tokenise, drop stop words, stem crudely (`retries` → `retri`, `validation` and
  `validated` → `validat`);
- weight each term by how *rare* it is across the corpus (IDF), so "order"
  counts for little and "certificate" counts for a lot;
- hash terms into 4096 slots and normalise.

This works genuinely well on a small corpus — 12/12 top-1 on the golden set. But
be clear about what it cannot do:

| | Lexical (mock) | Real embeddings |
|---|---|---|
| "invoicing" finds a chunk saying "billing" | no | yes |
| A question in Norwegian against English docs | no | yes |
| Paraphrase with no shared words | no | yes |
| Typos | no | mostly |
| Needs a stemmer and a stop-word list | yes | no |
| Cost | free | per token |

**Run the same query under both providers.** That comparison is the single most
instructive five minutes in this project, and it is exactly what you are buying
when you pay for an embedding model.

Also worth noticing: lexical search is *not* obsolete. Production systems
routinely run both and merge the results ("hybrid search"), because exact
matching on identifiers, error codes and table names is something embeddings are
genuinely bad at. Your MySQL `FULLTEXT` index is not a worse version of this —
it is the other half of it.

## When to stop using an array in memory

The index here is a JavaScript array, scanned linearly on every query. For 33
chunks that takes well under a millisecond, and it is the correct decision.

Three signals it is time for a real store — and you will hit them in this order:

1. **Re-embedding on every deploy is annoying or expensive.** This is the first
   one to bite, and it argues for persistence, not for a vector database.
   Storing vectors in a MySQL table is a completely valid answer. See `docs/04`.
2. **The corpus stops fitting comfortably in memory.** Roughly: 100k chunks ×
   1536 dimensions × 4 bytes ≈ 600 MB, plus the text.
3. **Linear scan gets slow.** Around the high hundreds of thousands of chunks,
   which is where approximate-nearest-neighbour indexes (HNSW, IVF) start
   earning their keep — pgvector, Qdrant, Milvus, MySQL 9's `VECTOR` type.

Most internal tools never reach any of these. Start with the array.

## What this demo deliberately leaves out

Real RAG systems layer on more, roughly in order of value per unit of effort:

- **Hybrid search** — combine embedding similarity with keyword/BM25 scoring.
  Usually the single largest quality win available, precisely because it fixes
  the identifier-matching weakness above.
- **Reranking** — retrieve 50 candidates cheaply, then have a small cross-encoder
  model rescore the top ones properly. Big precision gain for modest cost.
- **Query rewriting** — expand "and what about the second one?" into a
  standalone question before embedding it. Essential once search is
  conversational, because follow-up questions embed terribly.
- **Metadata filters** — restrict by document type, date or permissions *before*
  ranking. This is also where access control has to live: if a user may not read
  a document, it must be excluded at retrieval time, because anything reaching
  the prompt can reach the answer.
- **Freshness** — re-index on change rather than at boot.

Every one of them is a normal backend feature. None requires machine learning.
