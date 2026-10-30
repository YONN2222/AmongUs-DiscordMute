<template>
  <div class="groups">
    <section aria-labelledby="feature-group-game">
      <h3 id="feature-group-game" class="group-title"><UIcon name="i-lucide-gamepad-2" class="group-icon" />In the game</h3>
      <HomeFeaturesGame />
    </section>
    <section aria-labelledby="feature-group-server">
      <h3 id="feature-group-server" class="group-title"><UIcon name="i-lucide-server" class="group-icon" />For your server</h3>
      <HomeFeaturesServer />
    </section>
    <section aria-labelledby="feature-group-operators">
      <h3 id="feature-group-operators" class="group-title"><UIcon name="i-lucide-activity" class="group-icon" />For operators</h3>
      <HomeFeaturesOperators />
    </section>
  </div>
</template>

<style scoped>
.groups { display: grid; gap: 56px; margin-top: 72px; }
.group-title { display: flex; align-items: center; gap: 12px; margin: 0 0 20px; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
.group-title::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, var(--line), transparent); }
.group-icon { width: 22px; height: 22px; color: var(--accent-text); }

@media (max-width: 640px) {
  .groups { gap: 44px; margin-top: 48px; }
  .group-title { font-size: 20px; }
}
</style>
