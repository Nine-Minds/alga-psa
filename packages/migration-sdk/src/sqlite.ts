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

function loadNodeSqlite(): NodeSqliteModule {
  // `process.getBuiltinModule` (Node >= 22.3) resolves the builtin at runtime
  // without a static `require`/`import` specifier, so bundlers (Turbopack /
  // webpack) leave it alone instead of rewriting it into a broken external
  // reference when this seam is bundled into a Next.js server route.
  const sqlite = process.getBuiltinModule('node:sqlite');
  if (!sqlite) {
    throw new Error('node:sqlite is unavailable in this runtime (Node >= 22.3 required)');
  }
  return sqlite as unknown as NodeSqliteModule;
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
