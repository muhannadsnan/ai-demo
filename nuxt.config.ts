export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],

  /**
   * runtimeConfig is the single most important thing to understand for AI work.
   *
   *  - Keys at the TOP level are SERVER-ONLY. They are never sent to the browser.
   *  - Keys under `public` ARE shipped to the browser. Never put a secret there.
   *
   * Each key can be overridden by an environment variable following the pattern
   * NUXT_<KEY> (or NUXT_PUBLIC_<KEY>), which is how you configure production.
   *   aiProvider     -> NUXT_AI_PROVIDER
   *   openaiApiKey   -> NUXT_OPENAI_API_KEY
   */
  runtimeConfig: {
    aiProvider: 'mock',              // 'mock' | 'openai' | 'ollama'
    openaiApiKey: '',                // SERVER ONLY. Never expose this.
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiChatModel: 'gpt-4o-mini',
    openaiEmbeddingModel: 'text-embedding-3-small',
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaChatModel: 'llama3.2',
    ollamaEmbeddingModel: 'nomic-embed-text',

    public: {
      // Safe to expose: used only so the UI can display which mode is active.
      appName: 'AI Demo'
    }
  }
})
