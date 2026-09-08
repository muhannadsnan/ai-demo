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

/**
 * This page is the teaching demo for streaming, not the product feature — the
 * model here has no access to the database. The suggestions say so by being
 * about the platform and its data model rather than pretending to query it;
 * the page that does query company data is /foretak.
 */
const suggestions = [
  'Hva betyr «tvangsavvikling», og hvordan skiller det seg fra konkurs?',
  'Hva er forskjellen på AS, ENK og NUF?',
  'Hvordan finner jeg byggefirmaer i Bergen med over 50 ansatte på denne siden?',
  'Hva står egentlig i et årsregnskap, og hva sier egenkapitalen meg?'
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
    <h1>Assistent</h1>
    <p class="lede">
      Spør om norsk foretaksregistrering, selskapsformer, roller, eierskap og
      regnskap — eller om hvordan du finner noe på denne siden.
      <strong>Assistenten har ikke tilgang til databasen herfra</strong>, så
      spørsmål om konkrete tall sender den videre til
      <NuxtLink to="/foretak">søket</NuxtLink>, som faktisk kan svare på dem.
    </p>

    <div class="thread" v-if="messages.length">
      <div v-for="(m, i) in messages" :key="i" class="melding" :class="m.role">
        <div class="avatar" :class="m.role">{{ m.role === 'user' ? 'Du' : 'AI' }}</div>
        <div class="boble" :class="{ skriver: streaming && i === messages.length - 1 && !m.content }">
          <template v-if="streaming && i === messages.length - 1 && !m.content">
            <span class="prikk" /><span class="prikk" /><span class="prikk" />
          </template>
          <template v-else-if="m.role === 'assistant'"><Markdown :text="m.content"
            /><span v-if="streaming && i === messages.length - 1" class="caret" /></template>
          <template v-else>{{ m.content }}</template>
        </div>
      </div>
    </div>

    <div v-else class="card">
      <p class="muted" style="margin-top:0">Ingen meldinger ennå. Prøv en av disse:</p>
      <div class="chips">
        <span v-for="s in suggestions" :key="s" class="chip" @click="draft = s">{{ s }}</span>
      </div>
    </div>

    <div v-if="errorMessage" class="error-box">{{ errorMessage }}</div>

    <div class="composer" style="margin-top:16px">
      <div class="skrivefelt">
        <textarea
          v-model="draft"
          rows="3"
          placeholder="Spør om noe… (Enter for å sende, Shift+Enter for ny linje)"
          :disabled="streaming"
          @keydown="onKeydown"
        />
        <!-- Stop sits inside the field, where the eye already is while the
             answer streams, rather than as a second button beside Send. -->
        <button
          v-if="streaming" class="stoppknapp" type="button"
          title="Stopp svaret" aria-label="Stopp svaret" @click="stop">
          <span class="firkant" />
        </button>
      </div>
      <button v-if="!streaming" :disabled="!draft.trim()" @click="send">Send</button>
    </div>

    <div class="row" style="margin-top:10px; justify-content:space-between">
      <span class="stats" v-if="lastMeta">
        {{ lastMeta.providerId }}/{{ lastMeta.model }} · {{ lastMeta.ms }}ms ·
        {{ lastMeta.characters }} chars
      </span>
      <span v-else class="stats">&nbsp;</span>
      <button v-if="messages.length" class="ghost" @click="reset">Tøm samtalen</button>
    </div>
  </div>
</template>
