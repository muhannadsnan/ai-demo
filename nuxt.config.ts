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
    // Which provider produces EMBEDDINGS. Empty means "same as aiProvider".
    // Set separately because a stored vector is bound to the model that made
    // it: 1.11 million rows cannot be re-embedded because the chat model
    // changed. NUXT_EMBEDDING_PROVIDER.
    embeddingProvider: '',
    openaiApiKey: '',                // SERVER ONLY. Never expose this.
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiChatModel: 'gpt-4o-mini',
    openaiEmbeddingModel: 'text-embedding-3-small',
    ollamaBaseUrl: 'http://localhost:11434',
    // qwen2.5:7b, not llama3.2:3b. Measured on ten natural-language queries
    // against this database: 10/10 correct versus 7/10, for ~2.6x the latency.
    // The 3B model got operators backwards — reading "mer enn 10 millioner" as
    // "at most", which returns 431,845 companies instead of 7,121 and looks
    // entirely plausible. Fits in 6 GB VRAM at 4.7 GB.
    ollamaChatModel: 'qwen2.5:7b',
    ollamaEmbeddingModel: 'nomic-embed-text',

    // PostgreSQL holding the Norwegian company data. Server-only: the browser
    // never sees a connection string. Override with NUXT_DATABASE_URL.
    databaseUrl: 'postgres://app:devpassword@localhost:5432/nordata',

    public: {
      // Safe to expose: used only so the UI can display which mode is active.
      appName: 'AI Demo'
    }
  }
})
