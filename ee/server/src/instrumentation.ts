// Next.js instrumentation hook - runs before the application starts
// This file is automatically loaded by Next.js 13.4+ when present
export async function register() {
  if (process.env.E2E_SKIP_APP_INIT === 'true') {
    return;
  }
  // Only initialize on the server side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Register the billing catalog context loader with @alga-psa/licensing before anything can reach the
    // co-managed gate (pages, server actions, API routes). Import side effect; the CE alias registers nothing.
    // Kept ahead of initializeApp so a failure there cannot leave the gate on the env fallback.
    try {
      await import('@enterprise/lib/stripe/offerCatalog/surfaceProbe');
    } catch (error) {
      console.error('Failed to register the billing catalog context loader:', error);
    }

    try {
      const { initializeApp } = await import('@/lib/initializeApp');
      await initializeApp();
    } catch (error) {
      console.error('Failed to initialize application:', error);
    }

    // Wire the DB-prefs-aware locale resolver into @alga-psa/ui's server i18n.
    // Done here (instead of at the @alga-psa/ui level) to avoid a
    // ui→tenancy circular dependency; tenancy already depends on ui.
    try {
      const [{ registerServerLocaleResolver }, { getHierarchicalLocaleAction }] =
        await Promise.all([
          import('@alga-psa/ui/lib/i18n/serverOnly'),
          import('@alga-psa/tenancy/actions'),
        ]);
      registerServerLocaleResolver(() => getHierarchicalLocaleAction());
    } catch (error) {
      console.error('Failed to register server locale resolver:', error);
    }
  }
}
