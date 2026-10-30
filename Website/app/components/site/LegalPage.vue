<script setup lang="ts">
import type { LegalSection } from '~/content/legal'

const props = defineProps<{ title: string; updatedAt: string; sections: readonly LegalSection[] }>()

const URL_PATTERN = /(https?:\/\/[^\s]+?)(?=[.,;:]?(?:\s|$))/g

type Part = { text: string; href?: string }

function parts(text: string): Part[] {
  const result: Part[] = []
  let last = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    if (start > last) result.push({ text: text.slice(last, start) })
    result.push({ text: match[1] ?? '', href: match[1] })
    last = start + match[0].length
  }
  if (last < text.length) result.push({ text: text.slice(last) })
  return result
}

const rendered = computed(() =>
  props.sections.map((section) => ({ ...section, body: section.body.map(parts) })),
)
const updatedLabel = computed(() =>
  new Date(`${props.updatedAt}T00:00:00Z`).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' }),
)
</script>

<template>
  <UContainer class="legal">
    <header class="legal-head">
      <h1 class="legal-title">{{ title }}</h1>
      <p class="legal-updated">
        <UIcon name="i-lucide-clock" class="size-4" />
        <span>Last updated <time :datetime="updatedAt">{{ updatedLabel }}</time></span>
      </p>
    </header>
    <div class="legal-grid">
      <nav class="legal-toc" aria-label="On this page">
        <ul>
          <li v-for="section in rendered" :key="section.id">
            <a :href="`#${section.id}`">{{ section.heading }}</a>
          </li>
        </ul>
      </nav>
      <div class="legal-body">
        <section v-for="section in rendered" :id="section.id" :key="section.id" :aria-labelledby="`${section.id}-heading`">
          <h2 :id="`${section.id}-heading`">{{ section.heading }}</h2>
          <p v-for="(paragraph, index) in section.body" :key="index">
            <template v-for="(part, partIndex) in paragraph" :key="partIndex">
              <a v-if="part.href" :href="part.href" rel="noopener">{{ part.text }}</a>
              <template v-else>{{ part.text }}</template>
            </template>
          </p>
        </section>
      </div>
    </div>
  </UContainer>
</template>

<style scoped>
.legal { max-width: 1040px; padding-top: 72px; padding-bottom: 112px; }
.legal-head { padding-bottom: 28px; border-bottom: 1px solid var(--line); }
.legal-title { margin: 0; font-size: clamp(38px, 6vw, 60px); line-height: 1.05; font-weight: 650; letter-spacing: -.03em; text-wrap: balance; }
.legal-updated { display: flex; align-items: center; gap: 8px; margin: 18px 0 0; color: var(--muted); font-size: 15px; }
.legal-grid { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 56px; margin-top: 40px; align-items: start; }
.legal-toc { position: sticky; top: var(--nav-offset); }
.legal-toc ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.legal-toc a { display: block; padding: 7px 12px; border-radius: 6px; color: var(--muted); font-size: 14px; font-weight: 500; text-decoration: none; transition: color .15s, background-color .15s; }
.legal-toc a:hover { color: var(--text); background: var(--surface); }
.legal-body section { scroll-margin-top: var(--nav-offset); }
.legal-body section + section { margin-top: 44px; }
.legal-body h2 { margin: 0 0 14px; font-size: 26px; line-height: 1.2; font-weight: 600; letter-spacing: -.015em; }
.legal-body p { margin: 0; max-width: 68ch; color: var(--muted); font-size: 16.5px; line-height: 1.7; text-wrap: pretty; overflow-wrap: anywhere; }
.legal-body p + p { margin-top: 14px; }
.legal-body a { color: var(--text); text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 3px; transition: text-decoration-color .15s; }
.legal-body a:hover { text-decoration-color: var(--accent-text); }

@media (max-width: 860px) {
  .legal { padding-top: 40px; padding-bottom: 80px; }
  .legal-grid { grid-template-columns: 1fr; gap: 32px; }
  .legal-toc { display: none; }
}
</style>
