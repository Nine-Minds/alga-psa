/**
 * @alga-psa/db - Knex Turbopack Shim
 *
 * Patches Node.js require to avoid loading unnecessary database dialects.
 * This improves build times and bundle sizes when using Turbopack.
 */

import type { Knex } from 'knex';
import { createRequire } from 'module';

declare global {
  // eslint-disable-next-line no-var
  var __knexDialectPatched: boolean | undefined;
}

function getActiveDialect(): string {
  const dbType = process.env.DB_CLIENT || process.env.DB_TYPE || 'pg';
  return dbType.toLowerCase();
}

const activeDialect = getActiveDialect();

const createMockDriver = () => ({
  Client: class MockClient {
    constructor() {
      throw new Error(`Database driver not available. Only ${activeDialect} is configured.`);
    }
  },
});

if (typeof globalThis !== 'undefined' && !globalThis.__knexDialectPatched) {
  const nodeRequire = createRequire(import.meta.url);
  const Module = nodeRequire('module');
  const originalRequire = Module.prototype.require;

  Module.prototype.require = function patchedRequire(this: any, id: string, ...args: any[]) {
    if (id.includes('knex/lib/dialects/')) {
      const dialectName = id.split('/').pop();

      if (dialectName) {
        if (
          dialectName === activeDialect ||
          (dialectName === 'postgres' && activeDialect === 'pg') ||
          (dialectName === 'sqlite3' && activeDialect === 'better-sqlite3') ||
          dialectName === 'index'
        ) {
          return originalRequire.call(this, id, ...args);
        }

        if (
          [
            'better-sqlite3',
            'sqlite3',
            'mysql',
            'mysql2',
            'mssql',
            'oracledb',
            'oracle',
            'pgnative',
            'cockroachdb',
            'redshift',
          ].includes(dialectName)
        ) {
          return createMockDriver();
        }
      }
    }

    const dbDrivers = ['better-sqlite3', 'sqlite3', 'mysql', 'mysql2', 'oracledb', 'tedious', 'pg-native'];
    if (dbDrivers.includes(id)) {
      if ((activeDialect === 'pg' || activeDialect === 'postgres' || activeDialect === 'postgresql') && id === 'pg') {
        return originalRequire.call(this, id, ...args);
      }
      if (activeDialect === id) {
        return originalRequire.call(this, id, ...args);
      }
      return {};
    }

    return originalRequire.call(this, id, ...args);
  };

  globalThis.__knexDialectPatched = true;

  if (process.env.NODE_ENV === 'development') {
    console.log(`[Knex] Using database dialect: ${activeDialect}`);
  }
}

import knex from 'knex';

export default knex;
export type { Knex };
