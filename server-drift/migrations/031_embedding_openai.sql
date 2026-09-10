-- Move the semantic index from nomic-embed-text to OpenAI text-embedding-3-small.
--
-- WHY THE VECTORS CANNOT SIMPLY BE TOPPED UP
--
-- Stored vectors and the query vector must come from the SAME model. nomic
-- returns 768 numbers, text-embedding-3-small returns 1536, so they do not even
-- fit the same column — and if the counts did match it would still be wrong,
-- because the two models place meaning in unrelated coordinate spaces. Cosine
-- similarity between them runs and returns a number that means nothing, like
-- measuring the distance between a point given in kilometres and one given in
-- degrees. So this is a full rebuild, not a migration of data.
--
-- WHY THE SWITCH AT ALL
--
-- The local pass wedged the GPU twice on a 4 GB card, at 36-48 texts/sec, with
-- ~5 hours still to run. Priced properly the hosted alternative is 92 million
-- characters, about 31M tokens, roughly 6 kroner at $0.02/1M — so the argument
-- in server-drift/README.md that a hosted embedder is "a real bill for a
-- portfolio project" was simply wrong, and is corrected there. What the switch
-- actually buys is that semantic search now works on any machine that can reach
-- the API, with no GPU and no five-hour warm-up before the feature exists.
--
-- The trade accepted here: descriptions now leave the network. They are public
-- register data, but sending a million of them to a third party is a decision,
-- and this file is where that decision is recorded.

-- The HNSW index is bound to the column type, so it goes first. embed-foretak
-- rebuilds it at the end of the pass, over finished data rather than
-- maintaining it through a million inserts.
DROP INDEX IF EXISTS enheter_embedding_hnsw;

-- Not a cast. Every stored vector is nomic output and is meaningless to the new
-- model, so the table is emptied rather than converted. TRUNCATE, not DELETE:
-- there is nothing to preserve and no dead rows worth vacuuming afterwards.
TRUNCATE enheter_embedding;

ALTER TABLE enheter_embedding
    ALTER COLUMN embedding TYPE halfvec(1536);

-- halfvec at 1536 for the same reason 028 chose it at 768: pgvector stores
-- `vector` as 4-byte floats, which would be ~6.8 GB over 1.11M rows before the
-- index; halfvec is 2 bytes and halves that. The precision lost sits far below
-- the noise in "are these two business descriptions similar", and HNSW indexes
-- halfvec directly.

COMMENT ON COLUMN enheter_embedding.embedding IS
  'text-embedding-3-small, 1536 dimensions. Query and document vectors must come from the model named in `modell` — mixing models is silently meaningless, not an error.';

COMMENT ON COLUMN enheter_embedding.modell IS
  'Which model produced this vector. embed-foretak re-embeds any row whose model differs from the configured one, so a model change is detected rather than assumed.';
