/**
 * @alga-psa/db
 *
 * Database infrastructure module for AlgaPSA.
 * Contains Knex configuration, tenant context management, and database utilities.
 */

// Knex Configuration
export { getKnexConfig, getFullConfig, getKnexConfigWithTenant, getPostgresConnection } from './lib/knexfile';
export type { CustomKnexConfig } from './lib/knexfile';
export { default as knexConfig } from './lib/knexfile';

// Knex Turbopack Shim (patched knex for turbopack compatibility)
export { default as Knex } from './lib/knex-turbopack';

// Admin Connection
export { getAdminConnection, destroyAdminConnection, refreshAdminConnection, withAdminTransactionRetryReadOnly, retryOnAdminReadOnly } from './lib/admin';

// Tenant Connection
export { getConnection, withTransaction, createTenantKnex, runWithTenant, runWithoutTenant, getTenantContext, setTenantContext, resetTenantConnectionPool, destroyTenantConnection, refreshTenantConnection, withTenantTransactionRetryReadOnly, retryOnTenantReadOnly, withSavepoint } from './lib/tenant';
export { isTenantScopedQuery } from './lib/tenantScopedQuery';
export type { TenantScopedQuery } from './lib/tenantScopedQuery';
export { tenantDb } from './lib/tenantDb';
export type { TenantDb, TenantJoinOptions } from './lib/tenantDb';
export { getTenantTableScope, parseTableExpression, requireTenantTableScope, tenantTableMetadata } from './lib/tenantTableMetadata';
export type { ParsedTableExpression, TenantTableScope } from './lib/tenantTableMetadata';
export {
  TENANT_TABLE_MANIFEST,
  TenantManifestCycleError,
  computeTenantDeletionOrder,
  deletionEdges,
  getTenantTableManifestEntry,
  placeTenantTable,
  tenantClientKeyedTables,
  tenantDeletionOrder,
  tenantExportOrder,
} from './lib/tenantTableManifest';
export type {
  TenantDeletionComputation,
  TenantDeletionViolation,
  TenantInsertionWindow,
  TenantTableEntry,
  TenantTableForeignKey,
  TenantTableReference,
} from './lib/tenantTableManifest';

// After-commit hooks (flushed by the transaction-owning withTransaction frame)
export { registerAfterCommit, registerAfterCommitWithConnection } from './lib/afterCommit';
export { admitWrite, registerWriteAdmissionProvider, resetWriteAdmissionProvider } from './lib/writeAdmission';
export type { WriteAdmissionContext, WriteAdmissionProvider } from './lib/writeAdmission';
export {
  CO_MANAGED_PRODUCT_CODE,
  WRITE_ADMISSION_TTL_MS,
  admitOperationalWrite,
  admitTenantWrite,
  noteTenantProductCode,
  hasWriteAdmissionResolver,
  invalidateWriteAdmission,
  isTenantWriteGuarded,
  registerWriteAdmissionResolver,
  resetWriteAdmissionResolver,
} from './lib/writeAdmission';
export type { TenantWriteContext, WriteAdmissionDecision, WriteAdmissionResolver } from './lib/writeAdmission';
export { OPERATIONAL_WRITE_TABLES, RETAINED_COMMAND_TABLES, isOperationalWriteTable } from './lib/operationalWriteTables';
export type { OperationalWriteTable } from './lib/operationalWriteTables';
export type { AfterCommitHook } from './lib/afterCommit';

// Read-only error helpers (for callers building their own retry strategies)
export { isReadOnlyError, READ_ONLY_ERROR_RE, retryOnReadOnly } from './lib/readOnlyRetry';
export { resolveTenantId, requireTenantId } from './lib/tenantId';

// Audit logging
export { auditLog } from './lib/auditLog';
export { writeAccountingAudit } from './lib/accountingAudit';
export type { AccountingAuditOperation, AccountingAuditProvider, AccountingAuditParams } from './lib/accountingAudit';
export { writeInvoiceAudit, listInvoiceAuditHistory, INVOICE_AUDIT_OPERATIONS } from './lib/invoiceAudit';
export type { InvoiceAuditOperation, InvoiceAuditParams, InvoiceAuditState, InvoiceHistoryEntry } from './lib/invoiceAudit';
export * from './lib/workDate';

// Shared invoice external-sync row lock (billing adapters + integrations
// mapping CRUD + invoice void serialize on the same invoice row lock)
export {
  lockInvoiceForExternalSync,
  lockInvoicesForExternalSync,
  ACCOUNTING_EXPORT_INVOICE_CANCELLED,
  ACCOUNTING_EXPORT_INVOICE_NOT_FOUND,
} from './lib/invoiceExternalSyncLock';

// Tenant Slug utilities
export { getTenantIdBySlug, getTenantDisplayNameBySlug, getTenantSlugForTenant, buildTenantPortalSlug, isValidTenantSlug, getSlugParts } from './lib/tenantSlug';

// Tenant suspension (reversible gate on background activity)
export { isTenantSuspended, suspendTenant, resumeTenant } from './lib/tenantSuspension';
export type { TenantSuspensionReason } from './lib/tenantSuspension';

// User with Roles utilities (session-independent)
export { getUserWithRoles, getUserWithRolesByEmail } from './lib/getUserWithRoles';

// DB models (tenant-scoped data access patterns)
export * from './models/index';

// Service infrastructure
export * from './services/BaseService';
export * from './services/SystemContext';
export * from './services/projectTaskActualHours';

// Connection Management
export { getConnection as getDbConnection, cleanupConnections } from './lib/connection';

// Transaction Helpers
import type { Knex as KnexType } from 'knex';
import { getAdminConnection } from './lib/admin';
import { flushAfterCommitHooks } from './lib/afterCommit';

async function runOwnedTransaction<T>(
  knex: KnexType,
  callback: (trx: KnexType.Transaction) => Promise<T>
): Promise<T> {
  let owned: KnexType.Transaction | undefined;
  const result = await knex.transaction((trx) => {
    owned = trx;
    return callback(trx);
  });
  if (owned) {
    await flushAfterCommitHooks(owned);
  }
  return result;
}

/**
 * Execute a function within a transaction
 */
export async function withKnexTransaction<T>(
  knex: KnexType,
  callback: (trx: KnexType.Transaction) => Promise<T>
): Promise<T> {
  return await runOwnedTransaction(knex, callback);
}

/**
 * Describe an error for logging without ever throwing.
 *
 * `error.stack` is a lazy getter: V8 formats the trace on first access (and
 * under vite-node a source-mapping `prepareStackTrace` runs then, consuming
 * stack), so the read can itself raise (e.g. `RangeError: Maximum call stack
 * size exceeded`). Inside a catch block that second error would replace the
 * original failure the caller must see. Any failure to read falls back to
 * `String(error)`; a hostile `toString` degrades to a fixed placeholder.
 */
function describeError(error: unknown): { error: string; stack: string | undefined } {
  try {
    return {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
  } catch {
    try {
      return { error: String(error), stack: undefined };
    } catch {
      return { error: '<unprintable error>', stack: undefined };
    }
  }
}

/**
 * Execute a function within an admin database transaction
 */
export async function withAdminTransaction<T>(
  callback: (trx: KnexType.Transaction) => Promise<T>,
  existingConnection?: KnexType | KnexType.Transaction
): Promise<T> {
  const transactionId = Math.random().toString(36).substring(7);
  console.log(`[withAdminTransaction:${transactionId}] Starting transaction wrapper`);

  try {
    // If we already have a transaction, use it directly
    if (existingConnection && 'commit' in existingConnection && 'rollback' in existingConnection) {
      console.log(`[withAdminTransaction:${transactionId}] Using existing transaction`);
      const result = await callback(existingConnection as KnexType.Transaction);
      console.log(`[withAdminTransaction:${transactionId}] Existing transaction callback completed successfully`);
      return result;
    }

    // If we have a connection but not a transaction, create one
    if (existingConnection) {
      console.log(`[withAdminTransaction:${transactionId}] Creating transaction on existing connection`);
      const result = await runOwnedTransaction(existingConnection as KnexType, callback);
      console.log(`[withAdminTransaction:${transactionId}] New transaction on existing connection completed successfully`);
      return result;
    }

    // Otherwise, get admin connection and create transaction
    console.log(`[withAdminTransaction:${transactionId}] Getting admin connection for new transaction`);
    const adminDb = await getAdminConnection();

    const result = await runOwnedTransaction(adminDb, callback);
    return result;
  } catch (error) {
    // Reporting must never replace the error it reports: describing the error
    // is guarded, the rethrow is not.
    console.error(`[withAdminTransaction:${transactionId}] Transaction failed:`, describeError(error));
    throw error;
  }
}

// Re-export Knex types (for consumers that need type-only imports)
export type { Knex as KnexInstance } from 'knex';

export { ensureMiscellaneousService } from './lib/ensureMiscellaneousService';

export {
  registerCommentEventContributor,
  publishCommentEvent,
  resetCommentEventContributors,
  type CommentEvent,
  type CommentEventContributor,
  type CommentEventEnvelope,
  type CommentEventSource,
  type CommentEventType,
  type CommentEventTypesBySource,
  type CommentEventsBySource,
  type ProjectTaskCommentEvent,
  type TicketCommentEvent,
} from './lib/commentEventRegistry';
