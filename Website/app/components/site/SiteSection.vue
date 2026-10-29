<script setup lang="ts">
const props = defineProps<{ id: string; title: string; tight?: boolean }>()

const titleId = computed(() => `${props.id}-title`)
const ui = computed(() => ({
  container: ['max-w-[960px] gap-10 sm:gap-14 py-20 sm:py-28 lg:py-40', props.tight ? 'pt-0 sm:pt-0 lg:pt-0' : ''].join(' '),
  header: 'grid lg:grid-cols-[1.1fr_1fr] gap-x-12 gap-y-5 items-end pb-7 border-b border-default',
  title: 'text-[38px] sm:text-5xl lg:text-[56px] leading-[1.05] font-semibold tracking-[-0.02em] text-balance text-left',
  description: 'mt-0 text-[17px] leading-[26px] sm:text-[19px] sm:leading-7 text-muted text-pretty text-left lg:justify-self-end lg:max-w-[420px]',
  body: 'mt-0',
}))
</script>

<template>
  <UPageSection :id="id" :aria-labelledby="titleId" :ui="ui">
    <template #title>
      <span :id="titleId" v-reveal class="block">{{ title }}</span>
    </template>
    <template #description>
      <span v-reveal="80" class="block"><slot name="description" /></span>
    </template>
    <slot />
  </UPageSection>
</template>
