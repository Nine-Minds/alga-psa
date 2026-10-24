// Entry point for DB + Redis acceptance suites (*.db.test.ts) in this package.
// The repo-root config aliases the bare `redis` specifier to a never-connecting stub unless
// REAL_REDIS=1, which would hand both the test and the EventBus a client with no stream commands.
// Setting it here, before the config is evaluated, guarantees the real node-redis client.
// DB_TEST_CONFIG tells the suites they were explicitly asked to run, so missing infrastructure
// must throw instead of skipping.
process.env.REAL_REDIS = '1';
process.env.DB_TEST_CONFIG = '1';
const { default: config } = await import('./vitest.config.ts');
export default config;
