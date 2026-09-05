<script setup lang="ts">
import { readAiStream, type StreamEvent } from '~/composables/useAiStream'

/**
 * Demo 2 — AI search over your own documents (RAG).
 *
 * Deliberately split into two modes, because they are two different systems:
 *
 *   Retrieve  — embed the query, cosine-rank the chunks, show the raw results.
 *               No language model runs at all.
 *   Ask       — the same retrieval, then hand the top passages to the model and
 *               have it write a grounded answer with citations.
 *
 * Run a query in Retrieve mode before you trust an answer in Ask mode. If the
 * right passage is not in the retrieved list, the answer cannot be correct —
 * and you have learned that the bug is in retrieval, not in the model.
 */

interface Hit {
  score: number; source: string; docTitle: string; heading: string; text: string
  marker?: string
}

const mode = ref<'retrieve' | 'ask'>('retrieve')
const query = ref('')
const busy = ref(false)
const errorMessage = ref('')

const hits = ref<Hit[]>([])
const answer = ref('')
const sources = ref<Hit[]>([])
const meta = ref<Record<string, unknown> | null>(null)
const searchMs = ref<number | null>(null)

const { data: knowledge } = await useFetch('/api/knowledge')

const examples = [
  'How many times does a failed message retry?',
  'What happens when an import rejects too many rows?',
  'Which tables must not be altered directly?',
  'Orders are stuck after validation, what do I check?',
  'When do the partner certificates expire?'
]

async function run() {
  const q = query.value.trim()
  if (!q || busy.value) return

  busy.value = true
  errorMessage.value = ''
  hits.value = []
  sources.value = []
  answer.value = ''
  meta.value = null
  searchMs.value = null

  try {
    if (mode.value === 'retrieve') {
      // Plain JSON request — retrieval is fast enough that streaming adds nothing.
      const res = await $fetch('/api/search', { method: 'POST', body: { query: q, topK: 6 } })
      hits.value = res.hits
      searchMs.value = res.searchMs
      meta.value = res.stats as unknown as Record<string, unknown>
    } else {
      // Streaming, because generation takes seconds and waiting in silence feels broken.
      await readAiStream('/api/ask', { question: q, topK: 4 }, (event: StreamEvent) => {
        if (event.type === 'sources') {
          sources.value = event.sources as Hit[]
          searchMs.value = event.searchMs as number
        } else if (event.type === 'delta') {
          answer.value += event.text as string
        } else if (event.type === 'done') {
          meta.value = event.meta as Record<string, unknown>
        } else if (event.type === 'error') {
          errorMessage.value = event.message as string
        }
      })
    }
  } catch (err) {
    errorMessage.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

function useExample(text: string) {
  query.value = text
  run()
}
</script>

<template>
  <div>
    <h1>2 · AI search over your own documents</h1>
    <p class="lede">
      The classic starter project for AI search — the todo-list of this field — is
      <strong>retrieval-augmented generation over a document set you own</strong>.
      The knowledge base here is a fictional internal systems handbook, indexed at
      startup. Every answer is grounded in it and cites which passage it came from.
    </p>

    <div class="row" style="margin-bottom:14px">
      <button
        :class="{ ghost: mode !== 'retrieve' }"
        @click="mode = 'retrieve'; answer = ''; sources = []"
      >Retrieve only</button>
      <button
        :class="{ ghost: mode !== 'ask' }"
        @click="mode = 'ask'; hits = []"
      >Ask (RAG)</button>
      <span class="muted">
        {{ mode === 'retrieve'
          ? 'Ranked passages, no language model involved.'
          : 'Retrieve, then have the model answer from those passages only.' }}
      </span>
    </div>

    <div class="composer">
      <input
        v-model="query"
        type="text"
        placeholder="Ask about the indexed systems documentation…"
        :disabled="busy"
        @keydown.enter="run"
      >
      <button :disabled="busy || !query.trim()" @click="run">
        {{ busy ? '…' : mode === 'retrieve' ? 'Search' : 'Ask' }}
      </button>
    </div>

    <div class="chips">
      <span v-for="e in examples" :key="e" class="chip" @click="useExample(e)">{{ e }}</span>
    </div>

    <div v-if="errorMessage" class="error-box">{{ errorMessage }}</div>

    <!-- ---- Ask mode: the generated answer ---- -->
    <template v-if="mode === 'ask' && (answer || busy)">
      <h2>Answer</h2>
      <div class="card">
        <div class="body" style="white-space:pre-wrap">{{ answer
          }}<span v-if="busy" class="caret" /></div>
      </div>
    </template>

    <!-- ---- Sources / hits ---- -->
    <template v-if="sources.length || hits.length">
      <h2>{{ mode === 'ask' ? 'Sources the answer was built from' : 'Ranked passages' }}</h2>
      <div
        v-for="(hit, i) in (mode === 'ask' ? sources : hits)"
        :key="i"
        class="hit"
        :class="{ top: i === 0 }"
      >
        <div class="hit-head">
          <span class="score">{{ hit.score.toFixed(3) }}</span>
          <span v-if="hit.marker">[{{ hit.marker }}]</span>
          <span>{{ hit.source }}</span>
          <span>›</span>
          <span>{{ hit.heading }}</span>
        </div>
        <div class="hit-text">{{ hit.text }}</div>
        <div class="bar"><span :style="{ width: Math.max(2, hit.score * 100) + '%' }" /></div>
      </div>
    </template>

    <!-- ---- What just happened ---- -->
    <template v-if="meta">
      <h2>What just happened</h2>
      <div class="card stats">
        <div v-if="searchMs !== null">retrieval: {{ searchMs }}ms</div>
        <div v-if="meta.ms">generation + retrieval: {{ meta.ms }}ms</div>
        <div v-if="meta.model">model: {{ meta.providerId }} / {{ meta.model }}</div>
        <div v-if="meta.retrieved !== undefined">passages sent to the model: {{ meta.retrieved }}</div>
        <div v-if="meta.promptChars">context size: {{ meta.promptChars }} characters
          (~{{ Math.round(Number(meta.promptChars) / 4) }} tokens)</div>
        <div v-if="meta.embeddingModel">embedding model: {{ meta.embeddingModel }}</div>
      </div>
    </template>

    <h2>The index</h2>
    <div class="card">
      <table class="meta" v-if="knowledge">
        <tbody>
          <tr><td>Documents</td><td>{{ knowledge.stats.documents }}</td></tr>
          <tr><td>Chunks</td><td>{{ knowledge.stats.chunks }}</td></tr>
          <tr><td>Vector dimensions</td><td>{{ knowledge.stats.dimensions }}</td></tr>
          <tr><td>Embedding model</td><td><code>{{ knowledge.stats.embeddingModel }}</code></td></tr>
          <tr><td>Index build time</td><td>{{ knowledge.stats.buildMs }}ms</td></tr>
      
        </tbody>
      </table>
      <p class="muted">
        Built once at first request from the markdown files in <code>knowledge/</code>.
        Add a file there and restart to index it.
      </p>
    </div>
  </div>
</template>
