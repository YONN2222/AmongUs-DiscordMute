export default defineAppConfig({
  ui: {
    colors: { primary: 'red', neutral: 'zinc' },
    container: { base: 'w-full max-w-(--max) mx-auto px-5 sm:px-8 lg:px-10' },
    button: {
      slots: { base: 'rounded-(--radius-btn) font-semibold' },
      variants: {
        size: {
          md: { base: 'h-9 px-4 text-sm gap-2', leadingIcon: 'size-4', trailingIcon: 'size-4' },
          lg: { base: 'h-10 px-4 text-base gap-2', leadingIcon: 'size-[18px]', trailingIcon: 'size-[18px]' },
        },
      },
      compoundVariants: [
        { color: 'primary', variant: 'solid', class: 'bg-(--accent) text-white hover:bg-(--accent-hover) active:bg-(--accent-hover)' },
        { color: 'neutral', variant: 'link', class: 'px-2 text-highlighted hover:text-highlighted' },
      ],
    },
    badge: {
      slots: { base: 'rounded-full font-medium' },
      compoundVariants: [
        { color: 'neutral', variant: 'soft', class: 'bg-(--surface-2) text-muted' },
        { color: 'primary', variant: 'soft', class: 'bg-(--accent-soft) text-(--accent-text)' },
      ],
    },
    card: {
      slots: { root: 'rounded-(--radius-card)', body: 'p-6 sm:p-8' },
      variants: { variant: { soft: { root: 'bg-elevated' } } },
    },
    pageCard: {
      slots: {
        root: 'rounded-(--radius-card)',
        container: 'p-6 sm:p-7 gap-y-5',
        leading: 'mb-5',
        title: 'text-[22px] leading-tight font-semibold',
        description: 'mt-2 text-[15px] leading-relaxed text-muted',
      },
      variants: { variant: { soft: { root: 'bg-elevated', description: 'text-muted' } } },
    },
    pageFeature: {
      slots: {
        root: 'p-6',
        leading: 'mb-3.5',
        leadingIcon: 'size-[22px] text-(--indigo-text)',
        title: 'text-[17px]',
        description: 'mt-1.5 text-sm leading-normal',
      },
    },
    alert: {
      slots: { root: 'rounded-[10px]', description: 'text-sm leading-relaxed opacity-100' },
    },
  },
})
