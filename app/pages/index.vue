<script setup lang="ts">
const { data: health } = await useFetch('/api/health')

const providerHelp = computed(() => {
  const id = health.value?.provider?.id
  if (id === 'mock') {
    return 'Running offline. Everything works, but replies come from a deterministic '
      + 'stand-in rather than a language model. Set NUXT_AI_PROVIDER in .env to change this.'
  }
  if (id === 'openai') return 'Connected to OpenAI. Requests cost money.'
  if (id === 'ollama') return 'Using a local Ollama model. Free and private.'
  return health.value?.error ?? ''
})
</script>

<template>
  <div>
    <h1>A small, readable AI integration</h1>
    <p class="lede">
      Two features, built the way you would build them in a real product: all AI
      calls on the server, one swappable provider, and no vendor SDK hiding the
      HTTP contract. Read the server code alongside the pages — every file is
      commented for someone doing this for the first time.
    </p>

    <div class="card">
      <div class="row" style="justify-content:space-between; margin-bottom:8px">
        <strong>Current backend</strong>
        <ProviderBadge />
      </div>
      <p class="muted" style="margin:0">{{ providerHelp }}</p>
      <table class="meta" style="margin-top:12px" v-if="health?.provider">
        <tbody>
          <tr><td>Chat model</td><td><code>{{ health.provider.chatModel }}</code></td></tr>
          <tr><td>Embedding model</td><td><code>{{ health.provider.embeddingModel }}</code></td></tr>
          <tr>
            <td>OpenAI key configured</td>
            <td><code>{{ health.configured.openaiKeyPresent ? 'yes' : 'no' }}</code></td>
          </tr>
        </tbody>
      </table>
      <div v-if="health && !health.ok" class="error-box" style="margin-bottom:0">
        {{ health.error }}
      </div>
    </div>

    <h2>The two demos</h2>
    <div class="card">
      <strong><NuxtLink to="/chat">1 · Streaming chat</NuxtLink></strong>
      <p class="muted" style="margin:6px 0 0">
        The minimum viable AI feature. Teaches the request shape, the system prompt,
        streaming over SSE, and why the model has no memory of its own.
        Server code: <code>server/api/chat.post.ts</code>
      </p>
    </div>
    <div class="card">
      <strong><NuxtLink to="/search">2 · AI search over your documents</NuxtLink></strong>
      <p class="muted" style="margin:6px 0 0">
        Retrieval-augmented generation: chunk, embed, cosine-rank, then answer from
        the retrieved passages with citations. This is the pattern behind almost
        every "chat with your data" product.
        Server code: <code>server/utils/rag/</code> and <code>server/api/ask.post.ts</code>
      </p>
    </div>

    <h2>Where to read next</h2>
    <div class="card">
      <table class="meta">
        <tbody>
          <tr>
            <td><code>docs/00-the-basics.md</code></td>
            <td><strong>Start here.</strong> The whole thing without jargon</td>
          </tr>
          <tr><td><code>docs/01-architecture.md</code></td><td>The request path and why it is shaped that way</td></tr>
          <tr><td><code>docs/02-how-chat-works.md</code></td><td>Prompts, tokens, streaming, cost</td></tr>
          <tr><td><code>docs/03-how-ai-search-works.md</code></td><td>Embeddings and RAG, end to end</td></tr>
          <tr><td><code>docs/04-porting-this-to-codeigniter-mysql.md</code></td><td>The same thing in PHP 8 and MySQL 8</td></tr>
          <tr><td><code>docs/05-production-checklist.md</code></td><td>What to fix before this touches customers</td></tr>
          <tr><td><code>docs/06-glossary.md</code></td><td>The vocabulary, defined plainly</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
