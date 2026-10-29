import type { Directive } from 'vue'

const PENDING = 'reveal-pending'
let observer: IntersectionObserver | undefined

function sharedObserver(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.remove(PENDING)
        observer?.unobserve(entry.target)
      }
    },
    { rootMargin: '100000px 0px -8% 0px', threshold: 0 },
  )
  return observer
}

const reveal: Directive<HTMLElement, number | undefined> = {
  getSSRProps: () => ({}),
  mounted(el, binding) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (el.getBoundingClientRect().top < window.innerHeight) return
    if (binding.value) el.style.setProperty('--reveal-delay', `${binding.value}ms`)
    el.classList.add('reveal', PENDING)
    sharedObserver().observe(el)
  },
  unmounted(el) {
    observer?.unobserve(el)
  },
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('reveal', reveal)
})
