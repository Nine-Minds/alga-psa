/**
 * Smart Knex initialization that only loads the required database dialect
 * This prevents Turbopack warnings about missing database drivers
 */

import type { Knex } from 'knex';
import { createRequire } from 'module';

// Extend globalThis type to support __knexDialectPatched
declare global {
  var __knexDialectPatched: boolean | undefined;
}

// Get the database client from environment or config
function getActiveDialect(): string {
  // Check environment variables for database type
  const dbType = process.env.DB_CLIENT || process.env.DB_TYPE || 'pg';
  return dbType.toLowerCase();
}

// Determine the active dialect
const activeDialect = getActiveDialect();

// Create a mock for unused database drivers
const createMockDriver = () => {
  return {
    Client: class MockClient {
      constructor() {
        throw new Error(`Database driver not available. Only ${activeDialect} is configured.`);
      }
    }
  };
};

// Override require for database drivers we don't use
if (typeof globalThis !== 'undefined' && !globalThis.__knexDialectPatched) {
  const nodeRequire = createRequire(import.meta.url);
  const Module = nodeRequire('module');
  const originalRequire = Module.prototype.require;
  
  Module.prototype.require = function patchedRequire(this: any, id: string, ...args: any[]) {
    // Intercept knex dialect requires
    if (id.includes('knex/lib/dialects/')) {
      const dialectName = id.split('/').pop();
      
      if (dialectName) {
        // Allow the active dialect and its base classes
        if (dialectName === activeDialect || 
            dialectName === 'postgres' && activeDialect === 'pg' ||
            dialectName === 'sqlite3' && activeDialect === 'better-sqlite3' ||
            dialectName === 'index') {
          return originalRequire.call(this, id, ...args);
        }
        
        // Mock all other dialects
        if (['better-sqlite3', 'sqlite3', 'mysql', 'mysql2', 'mssql', 'oracledb', 'oracle', 'pgnative', 'cockroachdb', 'redshift'].includes(dialectName)) {
          return createMockDriver();
        }
      }
    }
    
    // Intercept direct database driver requires
    const dbDrivers = ['better-sqlite3', 'sqlite3', 'mysql', 'mysql2', 'oracledb', 'tedious', 'pg-native'];
    if (dbDrivers.includes(id)) {
      // Only allow the drivers we actually need
      if ((activeDialect === 'pg' || activeDialect === 'postgres' || activeDialect === 'postgresql') && id === 'pg') {
        return originalRequire.call(this, id, ...args);
      }
      if (activeDialect === id) {
        return originalRequire.call(this, id, ...args);
      }
      // Return a mock for all others
      return {};
    }
    
    return originalRequire.call(this, id, ...args);
  };
  
  // Mark as patched to avoid re-patching
  globalThis.__knexDialectPatched = true;
  
  // Log which dialect we're using (only in development)
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Knex] Using database dialect: ${activeDialect}`);
  }
}

// Now we can safely import Knex
import knex from 'knex';

// Export the patched knex
export default knex;
export { Knex };
