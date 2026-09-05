<script setup lang="ts">
useHead({
  title: 'AI Demo — chat and retrieval-augmented search',
  meta: [{ name: 'description', content: 'A minimal, readable Nuxt 4 AI integration demo.' }]
})
</script>

<template>
  <div>
    <header class="top">
      <div class="top-inner">
        <span class="brand">AI Demo</span>
        <nav class="tabs">
          <NuxtLink to="/">Overview</NuxtLink>
          <NuxtLink to="/chat">1 · Chat</NuxtLink>
          <NuxtLink to="/search">2 · AI Search</NuxtLink>
        </nav>
        <ProviderBadge />
      </div>
    </header>

    <main class="shell">
      <NuxtPage />
    </main>
  </div>
</template>
