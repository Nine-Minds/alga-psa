// Next.js instrumentation hook - runs before the application starts
// This file is automatically loaded by Next.js 13.4+ when present
export async function register() {
  if (process.env.E2E_SKIP_APP_INIT === 'true') {
    return;
  }
  // Only initialize telemetry on the server side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { initializeTelemetry } = await import('./lib/telemetry/initialization');
      await initializeTelemetry();
    } catch (error) {
      // Don't break the application if observability fails to initialize
      console.error('Failed to initialize observability:', error);
    }

    try {
      const { initializeApp } = await import('./lib/initializeApp');
      await initializeApp();
    } catch (error) {
      console.error('Failed to initialize application:', error);
    }

    // Registering the co-managed capability resolvers is a side effect of this import. A failure
    // leaves the gate unregistered, which fails closed (admits/serves are false).
    try {
      await import('@alga-psa/co-managed/capability');
    } catch (error) {
      console.error('Failed to register the co-managed capability:', error);
    }

    // Shared-work providers (schedule, appointment, interaction, meeting seams). Registration is
    // best-effort: without it every seam answers { handled: false } and native behaviour is unchanged.
    try {
      await import('@alga-psa/co-managed/schedulingRegistration');
    } catch (error) {
      console.error('Failed to register the co-managed scheduling providers:', error);
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

    // CM L0c: install the co-managed write-admission resolver. Fails open: an image
    // whose co-managed packages do not resolve must still boot and write.
    try {
      const { installCoManagedWriteAdmission, installCoManagedReviewAdmission, devForcedStatesFromEnv } = await import('@alga-psa/licensing/co-managed-write-admission');
      // devForcedStatesFromEnv is undefined in production; the installer also ignores it there.
      if (globalThis.__algaCoManagedReviewReader) {
        installCoManagedReviewAdmission(globalThis.__algaCoManagedReviewReader);
      } else {
        installCoManagedWriteAdmission({ devForcedStates: devForcedStatesFromEnv() });
      }
    } catch (error) {
      console.error('Failed to install co-managed write admission:', error);
    }
  }
}
