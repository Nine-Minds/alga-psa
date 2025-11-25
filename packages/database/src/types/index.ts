import type { Knex } from 'knex';

/**
 * Database configuration options
 */
export interface DatabaseConfig {
  client: 'pg';
  connection: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  pool?: Knex.PoolConfig;
}

/**
 * Options for establishing a database connection
 */
export interface ConnectionOptions {
  /** Tenant ID for multi-tenant context */
  tenantId?: string | null;
  /** Whether to use admin credentials */
  useAdmin?: boolean;
}

/**
 * Tenant context information
 */
export interface TenantContext {
  tenantId: string;
  connection: Knex;
}

/**
 * Pool configuration with additional lifecycle hooks
 */
export interface PoolConfig extends Knex.PoolConfig {
  afterCreate?: (
    connection: unknown,
    done: (err: Error | null, connection: unknown) => void
  ) => void;
}

/**
 * Result of a database operation
 */
export interface DatabaseResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
}
