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
          <NuxtLink to="/foretak">Foretak</NuxtLink>
          <NuxtLink to="/status">Status</NuxtLink>
        </nav>
        <ProviderBadge />
      </div>
    </header>

    <main class="shell">
      <NuxtPage />

      <!-- NLOD requires attribution. This is the licence condition for using
           Brønnøysundregistrenes data, not a courtesy. -->
      <footer class="kilde">
        Kilde: Enhetsregisteret og Regnskapsregisteret / Brønnøysundregistrene,
        gjengitt under <a href="https://data.norge.no/nlod/no/2.0" rel="noopener">NLOD 2.0</a>.
        Aksjonærdata fra Skatteetatens Aksjonærregister; personopplysninger vises ikke.
        Demoprosjekt — ikke tilknyttet noen kommersiell leverandør.
      </footer>
    </main>
  </div>
</template>
