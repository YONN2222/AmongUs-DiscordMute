<script setup lang="ts">
import type { AccordionItem } from '@nuxt/ui'
import { ANALYTICS_EVENTS, trackAttrs, trackEvent } from '#shared/analytics'
import { GITHUB_URL } from '#shared/site'
import { faqFor } from '~/content/faq'

const hosted = useHostedView()
const items = computed<AccordionItem[]>(() =>
  faqFor(hosted.value).map((entry) => ({ label: entry.question, content: entry.answer, value: entry.id })),
)
const half = computed(() => Math.ceil(items.value.length / 2))
const columns = computed(() => [items.value.slice(0, half.value), items.value.slice(half.value)])
const open = computed(() => [[items.value[0]!.value as string], []])
const openByColumn = ref(open.value.map((ids) => [...ids]))

function trackFaqOpen(column: number, openIds: string[]) {
  const before = openByColumn.value[column] ?? []
  openByColumn.value[column] = openIds
  for (const question of openIds.filter((id) => !before.includes(id))) trackEvent(ANALYTICS_EVENTS.faqOpen, { question })
}

const ui = {
  root: 'faq-col',
  item: 'faq-item',
  trigger: 'faq-trigger',
  trailingIcon: 'faq-icon',
  content: 'faq-content',
  body: 'faq-answer',
}
</script>

<template>
  <SiteSection id="faq" title="Questions" tight>
    <template #description>
      Short answers to what people ask most. Still stuck?
      <ULink :to="`${GITHUB_URL}/issues`" rel="noopener" class="issue-link" v-bind="trackAttrs(ANALYTICS_EVENTS.github, { location: 'faq' })">Open an issue on GitHub</ULink>.
    </template>
    <div class="faq-list">
      <div v-for="(column, index) in columns" :key="index" v-reveal="index * 90">
        <UAccordion
          type="multiple"
          :items="column"
          :default-value="open[index]"
          :unmount-on-hide="false"
          @update:model-value="(ids) => trackFaqOpen(index, ids as string[])"
          trailing-icon="i-lucide-plus"
          :ui="ui"
        />
      </div>
    </div>
  </SiteSection>
</template>

<style scoped>
.issue-link { color: var(--text); text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 3px; transition: text-decoration-color .15s; }
.issue-link:hover { text-decoration-color: var(--accent-text); }
.faq-list { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
.faq-list :deep(.faq-col) { display: grid; gap: 12px; }
.faq-list :deep(.faq-item) {
  background: var(--surface);
  border-radius: 12px;
  border: 1px solid transparent;
  transition: border-color .25s, background-color .25s, translate .25s;
}
.faq-list :deep(.faq-item:hover) { translate: 0 -2px; }
.faq-list :deep(.faq-item[data-state="open"]) { border-color: var(--line); background: #1d1d27; translate: none; }
.faq-list :deep(.faq-trigger) { gap: 16px; padding: 18px 20px; font-size: 17px; font-weight: 600; line-height: 1.35; color: var(--text); border-radius: 12px; cursor: pointer; transition: color .15s; }
.faq-list :deep(.faq-trigger:hover) { color: #fff; }
.faq-list :deep(.faq-icon) { width: 18px; height: 18px; color: var(--muted); rotate: 0deg; transition: rotate .3s cubic-bezier(.2, .7, .2, 1), color .2s; }
.faq-list :deep(.faq-item[data-state="open"] .faq-icon) { rotate: 135deg; color: var(--accent-text); }
.faq-list :deep(.faq-content[data-state="open"]) { animation: faq-open .32s cubic-bezier(.2, .7, .2, 1); }
.faq-list :deep(.faq-content[data-state="closed"]) { animation: faq-close .22s ease-in; overflow: hidden; }
.faq-list :deep(.faq-answer) { padding: 0 20px 20px; color: var(--muted); font-size: 15.5px; line-height: 1.65; }
.faq-list :deep(.faq-content[data-state="open"] .faq-answer) { animation: faq-text .4s .06s cubic-bezier(.2, .7, .2, 1) backwards; }
@keyframes faq-open { from { height: 0; } to { height: var(--reka-accordion-content-height); } }
@keyframes faq-close { from { height: var(--reka-accordion-content-height); } to { height: 0; } }
@keyframes faq-text { from { opacity: 0; translate: 0 -6px; } }

@media (max-width: 1023px) {
  .faq-list { grid-template-columns: 1fr; }
}

@media (max-width: 760px) {
  .faq-list :deep(.faq-trigger) { font-size: 16px; padding: 16px; }
  .faq-list :deep(.faq-answer) { padding: 0 16px 18px; }
}
</style>
