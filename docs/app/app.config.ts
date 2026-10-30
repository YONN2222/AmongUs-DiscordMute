export default defineAppConfig({
  header: {
    title: 'DiscordMute',
    logo: { favicon: '/brand/favicon-64.png' },
  },
  github: {
    url: 'https://github.com/YONN2222/AmongUs-DiscordMute',
    branch: 'master',
    rootDir: 'docs',
  },
  socials: {},
  ui: {
    colors: { primary: 'red', neutral: 'zinc' },
    button: {
      slots: { base: 'rounded-(--radius-btn) font-semibold' },
      compoundVariants: [
        { color: 'primary', variant: 'solid', class: 'bg-(--accent) text-white hover:bg-(--accent-hover) active:bg-(--accent-hover)' },
      ],
    },
    badge: {
      slots: { base: 'rounded-full font-medium' },
      compoundVariants: [
        { color: 'primary', variant: 'subtle', class: 'bg-(--accent-soft) text-(--accent-text) ring-0' },
      ],
    },
    pageCard: {
      slots: {
        root: 'rounded-(--radius-card)',
        container: 'p-6 sm:p-7 gap-y-5',
        title: 'text-[22px] leading-tight font-semibold',
        description: 'mt-2 text-[15px] leading-relaxed text-muted',
      },
      variants: { variant: { outline: { root: 'bg-elevated ring-(--line)' } } },
    },
    pageFeature: {
      slots: {
        root: 'rounded-2xl',
        leadingIcon: 'size-[22px] text-(--indigo-text)',
        title: 'text-[17px]',
        description: 'mt-1.5 text-sm leading-normal',
      },
    },
    prose: {
      a: {
        base: 'text-(--indigo-text) border-b border-transparent hover:border-(--indigo-text) font-medium transition-colors',
      },
    },
    alert: {
      slots: { root: 'rounded-2xl' },
    },
  },
})
