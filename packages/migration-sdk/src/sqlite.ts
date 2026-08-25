import { createRequire } from 'node:module';

/**
 * Narrow seam over Node's built-in `node:sqlite`. Everything else in the SDK
 * and the server goes through this module so the runtime can be swapped
 * without touching the reader, validator, stager, or planner.
 *
 * `node:sqlite` is still experimental; only `DatabaseSync` with prepared
 * statements is used, and packages are always opened with
 * `readOnly: true, allowExtension: false`.
 */

export interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

interface NodeSqliteModule {
  DatabaseSync: new (
    path: string,
    options?: { readOnly?: boolean; allowExtension?: boolean }
  ) => SqliteDatabase;
}

const require = createRequire(import.meta.url);

function loadNodeSqlite(): NodeSqliteModule {
  return require('node:sqlite') as NodeSqliteModule;
}

/** Open an untrusted package: read-only, extensions disabled. */
export function openPackageDatabase(path: string): SqliteDatabase {
  const { DatabaseSync } = loadNodeSqlite();
  return new DatabaseSync(path, { readOnly: true, allowExtension: false });
}

/** Open a writable database for package *production* (trusted output path). */
export function openWritableDatabase(path: string): SqliteDatabase {
  const { DatabaseSync } = loadNodeSqlite();
  return new DatabaseSync(path, { allowExtension: false });
}
