<script setup lang="ts">
const props = withDefaults(defineProps<{ stars?: number }>(), { stars: 150 })

const canvas = ref<HTMLCanvasElement | null>(null)
const TINTS = ['255,255,255', '255,255,255', '255,255,255', '255,255,255', '255,255,255', '255,255,255', '255,143,147', '146,149,255']

type Star = { x: number; y: number; z: number; r: number; a: number; tw: number; ph: number; c: string }

let cleanup: (() => void) | undefined

onMounted(() => {
  const el = canvas.value
  const ctx = el?.getContext('2d')
  if (!el || !ctx) return
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  let w = 0
  let h = 0
  let stars: Star[] = []
  let visible = true
  let frame = 0
  let last = performance.now()

  const seed = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2)
    w = el.clientWidth
    h = el.clientHeight
    el.width = Math.round(w * dpr)
    el.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const n = Math.round(props.stars * Math.min(1, w / 1280) + props.stars * 0.25)
    stars = Array.from({ length: n }, () => {
      const z = Math.pow(Math.random(), 2.2)
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        z,
        r: 0.45 + z * 1.25,
        a: 0.22 + z * 0.68,
        tw: Math.random() < 0.35 ? 1 + Math.random() * 2 : 0,
        ph: Math.random() * 6.28,
        c: TINTS[Math.floor(Math.random() * TINTS.length)]!,
      }
    })
  }

  const draw = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    ctx.clearRect(0, 0, w, h)
    for (const s of stars) {
      if (!reduce) {
        s.x -= (2 + s.z * 16) * dt
        if (s.x < -2) {
          s.x = w + 2
          s.y = Math.random() * h
        }
      }
      const a = s.tw ? s.a * (0.7 + 0.3 * Math.sin((now / 1000) * s.tw + s.ph)) : s.a
      ctx.fillStyle = `rgba(${s.c},${a})`
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.r, 0, 6.2832)
      ctx.fill()
    }
    if (!reduce && visible) frame = requestAnimationFrame(draw)
  }

  seed()
  draw(performance.now())

  const resize = new ResizeObserver(() => {
    seed()
    if (reduce || !visible) draw(performance.now())
  })
  resize.observe(el)
  const intersect = new IntersectionObserver(([entry]) => {
    const was = visible
    visible = Boolean(entry?.isIntersecting)
    if (visible && !was && !reduce) {
      last = performance.now()
      frame = requestAnimationFrame(draw)
    }
  })
  intersect.observe(el)

  cleanup = () => {
    cancelAnimationFrame(frame)
    resize.disconnect()
    intersect.disconnect()
  }
})

onBeforeUnmount(() => cleanup?.())
</script>

<template>
  <canvas ref="canvas" class="space" aria-hidden="true" />
</template>

<style scoped>
.space {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: -1;
  pointer-events: none;
  display: block;
}
</style>
