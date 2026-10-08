// The standard test config aliases `redis` to a no-op stub unless REAL_REDIS=1.
// This entry point guarantees the real node-redis client for Redis infrastructure suites.
process.env.REAL_REDIS = '1';
const { default: config } = await import('./vitest.config.ts');
export default config;
