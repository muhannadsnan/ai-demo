<script setup lang="ts">
/**
 * The outcome of an import run, as a mark rather than a word.
 *
 * Inline SVG, not an icon font. Font Awesome would be a whole font file — or a
 * JavaScript kit — downloaded on every page for three shapes, and the two
 * things these icons must do are things an icon font does badly: inherit the
 * colour of the state they describe, and animate while a job is running.
 * `currentColor` and a CSS rotation handle both in a few lines.
 *
 * The word is gone from the page but not from the markup: `title` gives the
 * hover text and `aria-label` keeps the meaning for a screen reader, which a
 * bare glyph would have thrown away.
 */
defineProps<{ status: string }>()

const TEKST: Record<string, string> = {
  ok: 'Fullført',
  feilet: 'Feilet',
  kjorer: 'Kjører nå'
}
</script>

<template>
  <span class="statusikon" :class="status" :title="TEKST[status] ?? status" :aria-label="TEKST[status] ?? status" role="img">
    <!-- Finished: a tick. -->
    <svg v-if="status === 'ok'" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".35" />
      <path d="M4.8 8.3l2.1 2.1 4.3-4.6" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>

    <!-- Running: a broken ring that turns. The gap is what makes the rotation
         visible; a full circle would spin invisibly. -->
    <svg v-else-if="status === 'kjorer'" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" class="snurrer">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"
              opacity=".25" />
      <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" />
    </svg>

    <!-- Failed: a cross. -->
    <svg v-else viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".35" />
      <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" />
    </svg>
  </span>
</template>
