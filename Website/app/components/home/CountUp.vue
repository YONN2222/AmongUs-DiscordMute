<script setup lang="ts">
const props = defineProps<{ value: number }>()

const el = ref<HTMLElement | null>(null)
const shown = ref(props.value)
let observer: IntersectionObserver | undefined
let frame = 0

watch(() => props.value, (value) => (shown.value = value))

function animate() {
  const start = performance.now()
  const target = props.value
  const step = (now: number) => {
    const k = Math.min(1, (now - start) / 1400)
    shown.value = Math.round(target * (1 - Math.pow(1 - k, 3)))
    if (k < 1) frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
}

onMounted(() => {
  if (!el.value || props.value <= 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  let first = true
  observer = new IntersectionObserver(([entry]) => {
    const inView = Boolean(entry?.isIntersecting)
    if (first) {
      first = false
      if (inView) return observer?.disconnect()
      shown.value = 0
      return
    }
    if (inView) {
      observer?.disconnect()
      animate()
    }
  }, { threshold: 0.4 })
  observer.observe(el.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  cancelAnimationFrame(frame)
})
</script>

<template>
  <span ref="el">{{ formatCount(Math.max(0, Math.floor(shown))) }}</span>
</template>
