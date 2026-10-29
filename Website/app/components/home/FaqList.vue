<script setup lang="ts">
import type { AccordionItem } from '@nuxt/ui'
import { GITHUB_URL } from '#shared/site'
import { FAQ } from '~/content/faq'

const items: AccordionItem[] = FAQ.map((entry) => ({ label: entry.question, content: entry.answer, value: entry.id }))
const half = Math.ceil(items.length / 2)
const columns = [items.slice(0, half), items.slice(half)]
const open = [[items[0]!.value as string], []]
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
      <ULink :to="`${GITHUB_URL}/issues`" rel="noopener" class="issue-link">Open an issue on GitHub</ULink>.
    </template>
    <div class="faq-list">
      <div v-for="(column, index) in columns" :key="index" v-reveal="index * 90">
        <UAccordion
          type="multiple"
          :items="column"
          :default-value="open[index]"
          :unmount-on-hide="false"
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
