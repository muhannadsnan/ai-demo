<script setup lang="ts">
import { readAiStream, type StreamEvent } from '~/composables/useAiStream'

/**
 * Demo 1 — streaming chat.
 *
 * The important detail is what this component does NOT do: it has no API key,
 * no model name, no vendor SDK. It POSTs to our own `/api/chat` and renders
 * text as it arrives. Swapping OpenAI for a local Llama changes nothing here.
 */

interface Message { role: 'user' | 'assistant'; content: string }

const messages = ref<Message[]>([])
const draft = ref('')
const streaming = ref(false)
const errorMessage = ref('')
const lastMeta = ref<Record<string, unknown> | null>(null)
let controller: AbortController | null = null

const suggestions = [
  'Explain what an embedding is, for a backend developer.',
  'What is the difference between RAG and fine-tuning?',
  'How should I handle API failures when calling an LLM from PHP?'
]

async function send() {
  const text = draft.value.trim()
  if (!text || streaming.value) return

  errorMessage.value = ''
  lastMeta.value = null
  draft.value = ''

  messages.value.push({ role: 'user', content: text })
  // The empty assistant message is the placeholder we append deltas into.
  messages.value.push({ role: 'assistant', content: '' })
  const replyIndex = messages.value.length - 1
  streaming.value = true
  controller = new AbortController()

  try {
    await readAiStream(
      '/api/chat',
      // The whole history goes up every turn — that is what creates the
      // illusion of memory, and what makes long chats expensive.
      { messages: messages.value.slice(0, -1) },
      (event: StreamEvent) => {
        if (event.type === 'delta') {
          messages.value[replyIndex]!.content += event.text as string
        } else if (event.type === 'done') {
          lastMeta.value = event.meta as Record<string, unknown>
        } else if (event.type === 'error') {
          errorMessage.value = event.message as string
        }
      },
      controller.signal
    )
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      errorMessage.value = (err as Error).message
    }
  } finally {
    streaming.value = false
    controller = null
    // Drop the placeholder if nothing ever arrived, so the thread stays clean.
    if (!messages.value[replyIndex]!.content) messages.value.splice(replyIndex, 1)
  }
}

function stop() {
  controller?.abort()
}

function reset() {
  messages.value = []
  errorMessage.value = ''
  lastMeta.value = null
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}
</script>

<template>
  <div>
    <h1>1 · Streaming chat</h1>
    <p class="lede">
      The smallest complete AI feature: a message goes to your own server, your
      server adds a system prompt and calls the model, and the reply streams back
      token by token. Open <code>server/api/chat.post.ts</code> alongside this page.
    </p>

    <div class="thread" v-if="messages.length">
      <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
        <div class="who">{{ m.role === 'user' ? 'You' : 'AI' }}</div>
        <div class="body">{{ m.content
          }}<span v-if="streaming && i === messages.length - 1" class="caret" /></div>
      </div>
    </div>

    <div v-else class="card">
      <p class="muted" style="margin-top:0">No messages yet. Try one of these:</p>
      <div class="chips">
        <span v-for="s in suggestions" :key="s" class="chip" @click="draft = s">{{ s }}</span>
      </div>
    </div>

    <div v-if="errorMessage" class="error-box">{{ errorMessage }}</div>

    <div class="composer" style="margin-top:16px">
      <textarea
        v-model="draft"
        rows="3"
        placeholder="Ask something… (Enter to send, Shift+Enter for a new line)"
        :disabled="streaming"
        @keydown="onKeydown"
      />
      <button v-if="streaming" class="ghost" @click="stop">Stop</button>
      <button v-else :disabled="!draft.trim()" @click="send">Send</button>
    </div>

    <div class="row" style="margin-top:10px; justify-content:space-between">
      <span class="stats" v-if="lastMeta">
        {{ lastMeta.providerId }}/{{ lastMeta.model }} · {{ lastMeta.ms }}ms ·
        {{ lastMeta.characters }} chars
      </span>
      <span v-else class="stats">&nbsp;</span>
      <button v-if="messages.length" class="ghost" @click="reset">Clear conversation</button>
    </div>
  </div>
</template>
