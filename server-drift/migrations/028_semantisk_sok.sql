-- Semantic search over what companies say they do.
--
-- Migration 027 gave keyword search over the same text. Keyword search finds a
-- company only if it wrote the word you typed: "undervannssveising" finds the
-- two companies that used that exact compound, and misses one that wrote
-- "sveising under vann" or "dykkertjenester med sveisekompetanse".
--
-- An embedding turns a description into 768 numbers positioned so that texts
-- meaning similar things land near each other, whatever words they used. The
-- search then embeds the question the same way and returns the nearest rows.
-- It is the same idea as the trigram index — compare by shape rather than by
-- exact match — one level up, at meaning rather than spelling.
--
-- halfvec, not vector: pgvector stores `vector` as 4-byte floats, so 940,807
-- rows would be 2.9 GB before the index. halfvec is 2 bytes and halves that.
-- The precision lost is far below the noise in "these two business
-- descriptions are similar", and HNSW indexes halfvec directly.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS enheter_embedding (
    organisasjonsnummer char(9)     PRIMARY KEY
        REFERENCES enheter (organisasjonsnummer) ON DELETE CASCADE,
    -- The exact text that was embedded, hashed. A company that rewrites its
    -- description gets re-embedded; the 99% that do not are skipped, the same
    -- content-hash trick the enheter import uses.
    tekst_hash  char(64)    NOT NULL,
    modell      text        NOT NULL,
    embedding   halfvec(768) NOT NULL,
    oppdatert_at timestamptz NOT NULL DEFAULT now()
);

-- Which companies still need embedding, without scanning the whole table.
CREATE INDEX IF NOT EXISTS enheter_embedding_hash_idx
    ON enheter_embedding (organisasjonsnummer, tekst_hash);
