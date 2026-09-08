<script setup lang="ts">
useHead({
  title: 'AI Demo — chat and retrieval-augmented search',
  meta: [{ name: 'description', content: 'A minimal, readable Nuxt 4 AI integration demo.' }]
})
</script>

<template>
  <div>
    <!-- Nuxt's own progress bar. It hooks the router's start/finish events, so
         every navigation gets a loading indicator without any page knowing
         about it. Route changes that need server data are not instant, and
         without this the app looks frozen while the next page is fetched. -->
    <NuxtLoadingIndicator color="var(--accent)" :height="2" />

    <header class="top">
      <div class="top-inner">
        <span class="brand">AI Demo</span>
        <nav class="tabs">
          <NuxtLink to="/">Overview</NuxtLink>
          <NuxtLink to="/chat">1 · Chat</NuxtLink>
          <NuxtLink to="/search">2 · AI Search</NuxtLink>
          <NuxtLink to="/foretak">Foretak</NuxtLink>
          <NuxtLink to="/topplister">Topplister</NuxtLink>
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
