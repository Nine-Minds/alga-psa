// Next.js instrumentation hook - runs before the application starts
// This file is automatically loaded by Next.js 13.4+ when present
export async function register() {
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
  }
}