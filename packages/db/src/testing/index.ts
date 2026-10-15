/**
 * Test doubles for the database layer, owned by the package that owns the
 * abstraction being doubled.
 *
 * Exported from source rather than `dist` (see the `./testing` entry in
 * package.json): test-only code is never loaded by the plain-Node workers, so
 * it must not acquire a build step that every CI lane then has to remember.
 */
export * from './fakeQueryBuilder';
export * from './fakeTenantDb';
export * from './coManagedLifecycle';
