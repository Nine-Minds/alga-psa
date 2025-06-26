// Next.js instrumentation hook - runs before the application starts
// This file is automatically loaded by Next.js 13.4+ when present
export async function register() {
  // Only initialize telemetry on the server side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { initializeTelemetry } = await import('./lib/telemetry/initialization');
      initializeTelemetry();
    } catch (error) {
      // Don't break the application if telemetry fails to initialize
      console.error('Failed to initialize telemetry:', error);
    }
  }
}