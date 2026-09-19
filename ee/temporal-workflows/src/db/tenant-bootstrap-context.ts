import type { Knex } from 'knex';
import { withAdminTransactionRetryReadOnly } from '@alga-psa/db/admin.js';

export interface TenantBootstrapLog {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}
export interface TenantBootstrapContext {
  transaction?: Knex.Transaction;
  log?: TenantBootstrapLog;
}

/** Reuse the provisioning transaction so workspace changes and durable progress
 * commit together. Ordinary onboarding keeps its existing admin retry behavior. */
export function runTenantBootstrapTransaction<T>(transaction: Knex.Transaction | undefined,
  work: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  return transaction ? work(transaction) : withAdminTransactionRetryReadOnly(work);
}
