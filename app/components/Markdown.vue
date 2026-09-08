<script setup lang="ts">
import { marked } from 'marked'
import DOMPurify from 'dompurify'

/**
 * Render model output as Markdown.
 *
 * Models emit Markdown whether or not you ask them to — `**bold**`, numbered
 * lists, and fenced code blocks. Printing the raw characters is what makes an
 * answer look broken.
 *
 * Two things matter here:
 *
 * 1. SANITISE. Model output is untrusted input. It can be steered by anything
 *    in the conversation, including text pasted from elsewhere, so treating it
 *    as HTML without sanitising is a stored-XSS hole with extra steps. Same
 *    rule as echoing a database field into a page.
 *
 * 2. Render on the CLIENT only. DOMPurify needs a real DOM, and chat output
 *    exists only after the user has typed something, so there is nothing to
 *    server-render anyway.
 */
const props = defineProps<{ text: string }>()

marked.setOptions({ breaks: true, gfm: true })

const html = computed(() => {
  const raw = marked.parse(props.text ?? '', { async: false }) as string
  return import.meta.client ? DOMPurify.sanitize(raw) : ''
})
</script>

<template>
  <ClientOnly>
    <div class="md" v-html="html" />
    <template #fallback><div class="md" style="white-space:pre-wrap">{{ text }}</div></template>
  </ClientOnly>
</template>
