/**
 * @alga-psa/database
 *
 * Centralized database access layer for Alga PSA.
 * This package provides a unified interface for database operations
 * across all feature packages in the monorepo.
 *
 * Key features:
 * - Tenant-aware connection management
 * - Admin connection for migrations
 * - Transaction helpers
 * - Connection pooling with automatic cleanup
 */

// Re-export connection management
export {
  getConnection,
  withTransaction,
  setTenantContext,
  resetTenantConnectionPool,
} from './tenant.js';

// Re-export admin connection
export {
  getAdminConnection,
  destroyAdminConnection,
  withAdminTransaction,
} from './admin.js';

// Re-export types
export type { DatabaseConfig, ConnectionOptions, TenantContext } from './types/index.js';

// Re-export Knex types for convenience
export type { Knex } from 'knex';
