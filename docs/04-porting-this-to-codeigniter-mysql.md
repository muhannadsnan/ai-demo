# 04 · Porting this to CodeIgniter 3 and MySQL 8

The Nuxt demo exists so you can see the whole shape in one place. But your
system is PHP 8.1 / CodeIgniter 3 / MySQL 8.0, and none of what you have just
read requires Node. This is the same architecture in your stack.

Nothing here is exotic: an HTTP client, a table, and a loop that multiplies
floats.

---

## 1 · Configuration

`application/config/ai.php`

```php
<?php
defined('BASEPATH') OR exit('No direct script access allowed');

// Never commit the key. Read it from the environment, as you already do for
// database credentials — getenv() in CI3, or your existing config loader.
$config['ai_provider']         = getenv('AI_PROVIDER') ?: 'mock';
$config['ai_openai_key']       = getenv('OPENAI_API_KEY') ?: '';
$config['ai_openai_base']      = getenv('OPENAI_BASE_URL') ?: 'https://api.openai.com/v1';
$config['ai_chat_model']       = 'gpt-4o-mini';
$config['ai_embedding_model']  = 'text-embedding-3-small';
$config['ai_timeout']          = 30;   // seconds; see the note on timeouts below
```

---

## 2 · The provider library

Same abstraction as `server/utils/ai/`. One interface, several drivers, chosen
by config — the pattern CodeIgniter already uses for database, session and cache
drivers, so it will look entirely native in your codebase.

`application/libraries/Ai/Ai_openai.php`

```php
<?php
class Ai_openai
{
    private $key, $base, $chatModel, $embeddingModel, $timeout;

    public function __construct(array $config)
    {
        $this->key            = $config['ai_openai_key'];
        $this->base           = $config['ai_openai_base'];
        $this->chatModel      = $config['ai_chat_model'];
        $this->embeddingModel = $config['ai_embedding_model'];
        $this->timeout        = $config['ai_timeout'];

        if ($this->key === '') {
            throw new RuntimeException('OPENAI_API_KEY is not set');
        }
    }

    /**
     * @param array $messages [['role' => 'user', 'content' => '...'], ...]
     * @return string the assistant reply
     */
    public function chat(array $messages, array $options = [])
    {
        $payload = [
            'model'       => $this->chatModel,
            'messages'    => $messages,
            'temperature' => $options['temperature'] ?? 0.3,
            'max_tokens'  => $options['max_tokens'] ?? 800,
        ];

        $response = $this->request('/chat/completions', $payload);
        return $response['choices'][0]['message']['content'];
    }

    /**
     * Batch! One request for 50 texts costs the same as 50 requests for one,
     * and takes a fiftieth of the wall time.
     *
     * @param string[] $texts
     * @return array[] one float vector per input, in input order
     */
    public function embed(array $texts)
    {
        $response = $this->request('/embeddings', [
            'model' => $this->embeddingModel,
            'input' => array_values($texts),
        ]);

        $data = $response['data'];
        usort($data, function ($a, $b) { return $a['index'] <=> $b['index']; });

        return array_map(function ($row) { return $row['embedding']; }, $data);
    }

    private function request($path, array $payload)
    {
        $ch = curl_init($this->base . $path);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $this->timeout,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Bearer ' . $this->key,
                'Content-Type: application/json',
            ],
            CURLOPT_POSTFIELDS     => json_encode($payload),
        ]);

        $body   = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err    = curl_error($ch);
        curl_close($ch);

        if ($body === false) {
            throw new RuntimeException('AI request failed: ' . $err);
        }

        $decoded = json_decode($body, true);

        if ($status >= 400) {
            $message = $decoded['error']['message'] ?? substr($body, 0, 300);
            // 401 = bad key, 429 = rate limit or no credit, 5xx = retry later
            throw new RuntimeException("AI request failed ($status): $message");
        }

        return $decoded;
    }
}
```

Add `Ai_mock` alongside it — returning a canned string and deterministic vectors
— and you can write tests, and develop before the key arrives. That is not a
nicety; it is the difference between being blocked and not being blocked.

**On timeouts.** 30 seconds is a long time to hold a PHP-FPM worker. With 120
workers across three nodes, a vendor slowdown can consume your entire pool and
take the site down — an AI call is an outbound dependency with far worse tail
latency than any database query you have. Two mitigations, both familiar:
keep synchronous calls short and rare, and push anything batch-shaped into a
queued job.

---

## 3 · Storing embeddings in MySQL 8

You do not need a vector database to start. You need a table.

```sql
CREATE TABLE ai_document_chunks (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_type     VARCHAR(64)  NOT NULL,      -- 'handbook', 'ticket', 'invoice_note'
  source_id       BIGINT UNSIGNED NULL,       -- FK into whatever it came from
  heading         VARCHAR(255) NULL,
  chunk_index     INT UNSIGNED NOT NULL,
  content         MEDIUMTEXT   NOT NULL,
  content_hash    CHAR(64)     NOT NULL,      -- sha256, for skip-if-unchanged
  embedding       BLOB         NOT NULL,      -- packed float32 vector
  embedding_model VARCHAR(64)  NOT NULL,      -- CRITICAL: see below
  dimensions      SMALLINT UNSIGNED NOT NULL,
  created_at      DATETIME NOT NULL,
  updated_at      DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_chunk (source_type, source_id, chunk_index),
  KEY idx_model (embedding_model)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

Three columns deserve comment:

- **`embedding BLOB`** — store the vector as packed float32, not JSON. A
  1536-dimension vector is 6 KB packed and roughly 30 KB as a JSON array of
  decimal strings, and the packed form decodes far faster.

  ```php
  $blob   = pack('f*', ...$vector);        // array<float> -> binary
  $vector = array_values(unpack('f*', $blob));  // binary -> array<float>
  ```

- **`embedding_model`** — the mistake that will cost you a day if you skip it.
  Vectors from different models live in incompatible spaces; comparing them
  produces confident nonsense rather than an error. Store the model name, filter
  on it in every query, and re-embed everything when you change models.

- **`content_hash`** — so re-indexing skips unchanged chunks. This is an import
  routine like any other: idempotent, resumable, skip-if-unchanged. You have
  written this pattern many times.

### MySQL 9

MySQL 9 adds a native `VECTOR` type and vector functions. If you are on it, use
them. On 8.0 the BLOB approach above is the pragmatic path, and it will carry
you a long way — check your server's own documentation for the exact functions
available, as they have evolved across 9.x releases.

---

## 4 · Cosine similarity in PHP

```php
<?php
class Ai_vector
{
    /** Scale to length 1, so similarity becomes a plain dot product. */
    public static function normalize(array $v)
    {
        $sum = 0.0;
        foreach ($v as $x) { $sum += $x * $x; }
        $mag = sqrt($sum);
        if ($mag == 0.0) { return $v; }
        foreach ($v as $i => $x) { $v[$i] = $x / $mag; }
        return $v;
    }

    /** Both vectors pre-normalised => cosine similarity == dot product. */
    public static function dot(array $a, array $b)
    {
        $sum = 0.0;
        $n = count($a);
        for ($i = 0; $i < $n; $i++) { $sum += $a[$i] * $b[$i]; }
        return $sum;
    }
}
```

Normalise once on write. Then searching is:

```php
public function search($query, $sourceType, $topK = 5)
{
    $model = $this->config->item('ai_embedding_model');

    $queryVector = Ai_vector::normalize(
        $this->ai->embed([$query])[0]
    );

    $rows = $this->db
        ->select('id, heading, content, embedding')
        ->from('ai_document_chunks')
        ->where('source_type', $sourceType)
        ->where('embedding_model', $model)   // never mix models
        ->get()->result_array();

    foreach ($rows as $i => $row) {
        $vector = array_values(unpack('f*', $row['embedding']));
        $rows[$i]['score'] = Ai_vector::dot($queryVector, $vector);
        unset($rows[$i]['embedding']);
    }

    usort($rows, function ($a, $b) { return $b['score'] <=> $a['score']; });

    return array_slice($rows, 0, $topK);
}
```

**Is a full table scan really acceptable?** For a few thousand chunks, yes —
comfortably. 5,000 × 1536 dimensions is about 7.7 million multiplications, a few
tens of milliseconds in PHP, and the rows are ~30 MB. Beyond roughly 50,000
chunks it starts to hurt, and your options in order of effort are: cache the
vectors in APCu or Redis; narrow the candidate set with a `WHERE` clause on
metadata before scoring; or move to a store with a real ANN index.

Measure before you optimise. This is a linear scan over a numeric array — the
same thing your reconciliation report already does over larger data.

---

## 5 · Indexing as an import routine

This is the part you already know how to build. The embedding pipeline is
structurally identical to your partner file imports:

| Import routine | Embedding pipeline |
|---|---|
| Fetch file from SFTP | Read source rows / documents |
| Parse and validate rows | Chunk the text |
| Write to `staging_*` | Embed in batches of 64 |
| Skip if file hash seen | Skip if `content_hash` unchanged |
| Promote in a transaction | Upsert into `ai_document_chunks` |
| Reject log with reason codes | Log failed batches for retry |

Run it from cron as a CLI controller, exactly like `import:price-lists`:

```bash
php index.php ai_index run --source=handbook --batch=64
```

The same discipline applies, for the same reasons: it must be idempotent, it
must be resumable, it must not embed everything again because one batch failed,
and it must be safe to run twice. The only new failure mode is a vendor
returning 429, which you handle exactly like a partner rate limit — exponential
backoff, then park the batch for the next run.

---

## 6 · Streaming from PHP

Streaming needs cURL's write callback plus output flushing:

```php
header('Content-Type: text/event-stream');
header('Cache-Control: no-cache');
header('X-Accel-Buffering: no');   // stop nginx from buffering the stream

$ch = curl_init($this->base . '/chat/completions');
curl_setopt_array($ch, [
    CURLOPT_POST       => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . $this->key,
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => json_encode([
        'model'    => $this->chatModel,
        'messages' => $messages,
        'stream'   => true,
    ]),
    CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$buffer) {
        $buffer .= $chunk;
        // Same partial-line discipline as the JS version — a chunk can end
        // mid-line, so only process up to the last complete newline.
        $lines  = explode("\n", $buffer);
        $buffer = array_pop($lines);

        foreach ($lines as $line) {
            $line = trim($line);
            if (strpos($line, 'data:') !== 0) { continue; }
            $payload = trim(substr($line, 5));
            if ($payload === '[DONE]') { continue; }

            $delta = json_decode($payload, true)['choices'][0]['delta']['content'] ?? null;
            if ($delta !== null) {
                echo 'data: ' . json_encode(['type' => 'delta', 'text' => $delta]) . "\n\n";
                @ob_flush();
                flush();
            }
        }
        return strlen($chunk);   // must return the byte count, or cURL aborts
    },
]);
curl_exec($ch);
curl_close($ch);
```

Be aware of what this costs you: a streaming response **holds a PHP-FPM worker
for the entire generation**. Thirty concurrent chats is thirty occupied workers
out of your 120. Node handles this far more cheaply, which is a legitimate
architectural reason to put AI endpoints in a small separate service — and one
of the better arguments for the Nuxt-style setup your company is standardising
on for new projects.

If streaming is not worth that trade-off, do not stream. A non-streaming call
with a good loading state is a perfectly respectable first version, and it is
the one I would ship first inside the monolith.

---

## 7 · Where it fits in your architecture

Given your five systems, the natural placement:

- **A thin AI service, not a library in Core.** The reasons are the ones above:
  long-held connections, an outbound dependency with bad tail latency, and a key
  you want in exactly one place. It also gives you one chokepoint for rate
  limiting and cost logging across every system that wants AI.
- **Embedding generation belongs in Import Runner.** It is a scheduled batch job
  over source data, which is precisely what that host already does.
- **The vectors belong in MySQL** until they demonstrably do not. You already
  operate MySQL well; adding a new datastore has a real operational cost, and
  "we might need it later" is not a reason to pay it now.
- **Portal calls the AI service, never the vendor.** Same rule as always.

## 8 · The security checklist for your context

- The key lives in the environment, in one service. Not in Git, not in
  `application/config/` as a literal, not in the browser.
- **Retrieval must respect permissions.** If a user may not read a document, it
  must be filtered out *before* ranking. Anything that reaches the prompt can
  reach the answer — treat the retrieval query like any other query that needs a
  tenant or role predicate.
- Log every call: user, endpoint, token counts, latency, cost. You will need
  this the first time someone asks why the bill moved.
- Rate limit per user, not just per IP.
- Assume anything sent to a vendor may be retained. Check your contract, and
  keep personal data out of prompts unless you have established that you may
  send it. Under GDPR this is a processing decision that needs to be made
  deliberately, not discovered afterwards.
