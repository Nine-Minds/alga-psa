/**
 * Next.js instrumentation file
 * 
 * This file runs once when the Next.js server starts.
 * Despite the name "instrumentation", it's commonly used for
 * application initialization tasks.
 * 
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */

export async function register() {
  // Only run initialization in Node.js runtime (not Edge runtime)
  // and skip during build time
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    console.log('[Instrumentation] Starting application initialization...');
    
    try {
      // Import initializeApp dynamically to avoid issues with Edge runtime
      const { initializeApp } = await import('./lib/initializeApp');
      
      // Initialize the application (runs startup tasks, syncs templates, etc.)
      await initializeApp();
      
      console.log('[Instrumentation] Application initialization completed successfully');
    } catch (error) {
      console.error('[Instrumentation] Failed to initialize application:', error);
      // Note: We don't throw here to allow the server to start even if initialization fails
      // This is a decision point - you might want to fail fast in production
    }
  } else if (process.env.NEXT_PHASE === 'phase-production-build') {
    console.log('[Instrumentation] Skipping initialization during build phase');
  }
}