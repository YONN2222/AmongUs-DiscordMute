export function useActiveSection(ids: readonly string[]) {
  const active = ref<string | null>(null)
  let observer: IntersectionObserver | undefined
  const visible = new Set<string>()

  const route = useRoute()

  function observe() {
    observer?.disconnect()
    visible.clear()
    active.value = null
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        active.value = ids.find((id) => visible.has(id)) ?? null
      },
      { rootMargin: '-35% 0px -55% 0px' },
    )
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }
  }

  onMounted(observe)
  watch(() => route.path, () => nextTick(observe))
  onBeforeUnmount(() => observer?.disconnect())

  return active
}
