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
