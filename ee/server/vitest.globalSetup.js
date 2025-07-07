/**
 * Global setup for Vitest tests in EE server
 * This runs once before all tests and handles global initialization
 */

export async function setup() {
  console.log('🚀 Starting EE server test global setup...');
  
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  
  // Validate required environment variables
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for tests');
  }
  
  console.log('✅ EE server test environment configured');
}

export async function teardown() {
  console.log('🧹 EE server test global teardown complete');
}