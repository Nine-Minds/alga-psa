/**
 * @alga-psa/db - Type definitions
 */

import type { Knex } from 'knex';

// Re-export Knex types
export type { Knex };

/**
 * Database connection configuration
 */
export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/**
 * Pool configuration
 */
export interface PoolConfig {
  min?: number;
  max?: number;
  idleTimeoutMillis?: number;
  reapIntervalMillis?: number;
  createTimeoutMillis?: number;
  acquireTimeoutMillis?: number;
  destroyTimeoutMillis?: number;
}
