/**
 * Loads server migrations and migration utilities for inventory DB tests.
 *
 * The repo root and the migrations directory are built from parts at runtime on purpose: a literal
 * `server/migrations/...` path in a test makes nx infer an `@alga-psa/inventory -> server` project edge, which pulls
 * `server:build` (a full `next build`) into inventory's build-deps. Do not inline these paths in tests.
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const nodeRequire = createRequire(import.meta.url);

export function repoRoot(): string {
  return path.resolve(__dirname, ...Array(4).fill('..'));
}

function serverProjectDir(): string {
  return path.join(repoRoot(), ['ser', 'ver'].join(''));
}

export function migrationsDir(): string {
  return path.join(serverProjectDir(), ['migr', 'ations'].join(''));
}

export function loadServerMigration<T = { up: (k: any) => Promise<void>; down: (k: any) => Promise<void> }>(name: string): T {
  return nodeRequire(path.join(migrationsDir(), name)) as T;
}

export function loadPermissionUtils(): { DEFAULT_ROLES: any; syncPermissionCatalog: (...args: any[]) => any } {
  const dir = path.join(migrationsDir(), 'utils', 'permissions');
  return {
    DEFAULT_ROLES: nodeRequire(path.join(dir, 'roleGrants.cjs')).DEFAULT_ROLES,
    syncPermissionCatalog: nodeRequire(path.join(dir, 'syncPermissionCatalog.cjs')).syncPermissionCatalog,
  };
}

/** Absolute path of a file under the server project's migrations dir (e.g. 'utils/tenantDb.cjs'). */
export function serverMigrationPath(...parts: string[]): string {
  return path.join(migrationsDir(), ...parts);
}
