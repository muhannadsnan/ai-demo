<script setup lang="ts">
/**
 * Always show which backend is answering. When you are learning, "why did it
 * say that?" is very often "because it is still on the mock provider".
 */
const { data: health } = await useFetch('/api/health')

const state = computed(() => {
  if (!health.value) return { cls: '', label: 'checking…' }
  if (!health.value.ok) return { cls: 'error', label: 'config error' }
  const p = health.value.provider!
  return { cls: p.billable ? 'live' : 'mock', label: `${p.id} · ${p.chatModel}` }
})
</script>

<template>
  <span class="badge" :title="health?.error || 'Active AI provider (server-side)'">
    <span class="dot" :class="state.cls" />
    {{ state.label }}
  </span>
</template>
