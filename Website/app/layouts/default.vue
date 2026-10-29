<template>
  <div>
    <UButton href="#main" size="md" label="Skip to content" class="skip" />
    <SiteNav />
    <UMain id="main">
      <slot />
    </UMain>
    <SiteFooter />
  </div>
</template>

<style scoped>
.skip { position: absolute; left: 16px; top: -48px; z-index: 100; }
.skip:focus-visible { top: 16px; }
</style>
