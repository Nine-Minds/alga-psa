// Next.js instrumentation hook - runs before the application starts
// This file is automatically loaded by Next.js 13.4+ when present
export async function register() {
  // Only initialize on the server side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      // Use the tsconfig path mapping to access server workspace
      const { initializeApp } = await import('@/lib/initializeApp');
      await initializeApp();
    } catch (error) {
      console.error('Failed to initialize application:', error);
    }
  }
}
