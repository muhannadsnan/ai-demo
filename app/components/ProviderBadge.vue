<script setup lang="ts">
/**
 * Which backends are answering, chat and embeddings separately.
 *
 * Reported separately because they can be different vendors. They were one
 * badge until the semantic index moved to OpenAI while chat was still local —
 * at which point the badge was true and incomplete, and the half it left out
 * was the half that cost money.
 */
const { data: health } = await useFetch('/api/health')

const tilstand = computed(() => {
  if (!health.value) return { cls: '', tekst: 'sjekker …', tittel: '' }
  if (!health.value.ok) return { cls: 'error', tekst: 'konfigurasjonsfeil', tittel: health.value.error ?? '' }

  const chat = health.value.provider
  const emb = health.value.embedder
  const deler: string[] = []
  if (chat) deler.push(`${chat.chatModel}`)
  if (emb && emb.id !== chat?.id) deler.push(`${emb.embeddingModel}`)

  return {
    // Local means free; anything billable is worth showing in a different
    // colour, since that is the one a stray loop would cost money on.
    cls: chat?.billable || emb?.billable ? 'live' : 'mock',
    tekst: deler.join(' + '),
    tittel: [
      chat ? `Chat: ${chat.id} / ${chat.chatModel}` : null,
      emb ? `Embedding: ${emb.id} / ${emb.embeddingModel}` : null
    ].filter(Boolean).join('\n')
  }
})
</script>

<template>
  <span class="badge" :title="tilstand.tittel">
    <span class="dot" :class="tilstand.cls" />
    {{ tilstand.tekst }}
  </span>
</template>
