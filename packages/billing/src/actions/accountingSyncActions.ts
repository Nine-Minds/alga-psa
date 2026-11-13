'use server';

/* eslint-disable custom-rules/no-feature-to-feature-imports -- sync actions consult QBO connection state */
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb, writeAccountingAudit } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import logger from '@alga-psa/core/logger';
import { getStoredQboCredentialsMap, QboClientService, resolveTenantQboEnvironment } from '@alga-psa/integrations/lib/qbo/qboClientService';
import { getStoredXeroConnections } from '@alga-psa/integrations/lib/xero/xeroClientService';
import { isAccountingReconnectRequired } from '@alga-psa/integrations/lib/accountingReconnectHeuristic';
import { PROVIDER_XERO, type ProviderType } from '@alga-psa/integrations/lib/providerDisconnect';
import {
  getAccountingSyncSettings,
  updateAccountingSyncSettings,
  type AccountingSyncSettings
} from '../services/accountingSync/accountingSyncSettings';
import { runAccountingSyncCycle, type RunCycleResult } from '../services/accountingSync/accountingSyncCycleService';
import { SyncOperationsRepository } from '../services/accountingSync/syncOperationsRepository';
import { SyncCycleRepository } from '../services/accountingSync/syncCycleRepository';
import { SyncMappingLedger } from '../services/accountingSync/syncMappingLedger';
import { WorkflowTaskSyncExceptionService } from '../services/accountingSync/syncExceptionService';
import { isInvoiceSyncBlockedStatus } from '../lib/invoiceSyncEligibility';
import { MAPPING_SYNC_STATUS, type AccountingSyncCycleRecord } from '../services/accountingSync/accountingSync.types';

function isEnterpriseEdition(): boolean {
  return (
    (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise'
  );
}

function assertEnterpriseEdition(): void {
  if (!isEnterpriseEdition()) {
    throw new Error('Accounting sync is only available in Enterprise Edition.');
  }
}

async function checkCatalogReadAccess(user: IUserWithRoles): Promise<void> {
  const allowed = await hasPermission(user, 'accounting_integrations', 'catalog_read');
  if (!allowed) {
    throw new Error('Forbidden');
  }
}

async function checkConnectionsManageAccess(user: IUserWithRoles): Promise<void> {
  const allowed = await hasPermission(user, 'accounting_integrations', 'connections_manage');
  if (!allowed) {
    throw new Error('Forbidden');
  }
}

async function checkExportsExecuteAccess(user: IUserWithRoles): Promise<void> {
  const allowed = await hasPermission(user, 'accounting_integrations', 'exports_execute');
  if (!allowed) {
    throw new Error('Forbidden');
  }
}

async function checkMappingsManageAccess(user: IUserWithRoles): Promise<void> {
  const allowed = await hasPermission(user, 'accounting_integrations', 'mappings_manage');
  if (!allowed) {
    throw new Error('Forbidden');
  }
}

/** Actionable, provider-named error for a provider whose disconnect is not finalized. */
function providerDisconnectError(provider: ProviderType): Error {
  const name = provider === PROVIDER_XERO ? 'Xero' : 'QuickBooks';
  return new Error(`${name} is being disconnected. Sync and exports are paused until the disconnect completes.`);
}

import { resolveSyncTarget, resolveGuardedSyncTarget } from '../services/accountingSync/syncTarget';
export { resolveSyncTarget };
export type { ResolvedSyncTarget } from '../services/accountingSync/syncTarget';
import type { AccountingIntegrationSelection } from '../services/accountingSync/connectedAccountingIntegration';


export const getAccountingSyncSettingsAction = withAuth(async (
  user,
  { tenant }
): Promise<AccountingSyncSettings> => {
  assertEnterpriseEdition();
  await checkCatalogReadAccess(user);
  const { knex } = await createTenantKnex();
  return getAccountingSyncSettings(knex, tenant);
});

export const updateAccountingSyncSettingsAction = withAuth(async (
  user,
  { tenant },
  patch: Partial<AccountingSyncSettings>
): Promise<AccountingSyncSettings> => {
  assertEnterpriseEdition();
  // The settings object includes the default-realm selection, which is
  // connection administration, so the narrowest single gate is
  // `connections_manage`.
  await checkConnectionsManageAccess(user);
  const { knex } = await createTenantKnex();
  const updated = await updateAccountingSyncSettings(knex, tenant, {
    ...(patch.autoSyncEnabled !== undefined ? { autoSyncEnabled: Boolean(patch.autoSyncEnabled) } : {}),
    ...(patch.autoSyncStartDate !== undefined ? { autoSyncStartDate: patch.autoSyncStartDate } : {}),
    ...(patch.autoProvisionCustomers !== undefined ? { autoProvisionCustomers: Boolean(patch.autoProvisionCustomers) } : {}),
    ...(patch.depositAccountRef !== undefined ? { depositAccountRef: patch.depositAccountRef } : {}),
    ...(patch.defaultClassRef !== undefined ? { defaultClassRef: patch.defaultClassRef } : {}),
    ...(patch.defaultDepartmentRef !== undefined ? { defaultDepartmentRef: patch.defaultDepartmentRef } : {}),
    ...(patch.defaultRealm !== undefined ? { defaultRealm: patch.defaultRealm } : {})
  });

  // This action can carry the default-realm selection, so a realm change
  // through it is audited exactly like the dedicated `setDefaultQboRealm`
  // action — identifiers only, never secret material.
  if (patch.defaultRealm !== undefined) {
    await writeAccountingAudit(knex, tenant, 'accounting_default_realm_changed', {
      userId: user.user_id,
      provider: 'quickbooks_online',
      recordId: patch.defaultRealm ?? undefined,
      details: { realmId: patch.defaultRealm },
    }).catch((error) => {
      logger.warn('Failed to write default-realm audit entry', { tenantId: tenant, error });
    });
  }

  return updated;
});

/** Actionable error when the requested provider/organisation cannot be used. */
function selectionUnavailableError(selection?: AccountingIntegrationSelection): string {
  if (selection?.preferredTargetRealm || selection?.preferredAdapterType) {
    return 'The selected accounting organisation is no longer connected. Reconnect it or choose another organisation in the accounting settings.';
  }
  return 'No accounting provider is connected.';
}

/** Run an immediate sync cycle for the tenant's connected provider (Sync Now). */
export const runAccountingSyncNow = withAuth(async (
  user,
  { tenant },
  selection?: AccountingIntegrationSelection
): Promise<RunCycleResult> => {
  assertEnterpriseEdition();
  await checkExportsExecuteAccess(user);
  const { knex } = await createTenantKnex();

  const resolution = await resolveGuardedSyncTarget(knex, tenant, selection);
  if (resolution.status === 'blocked') {
    throw providerDisconnectError(resolution.provider);
  }
  if (resolution.status !== 'ready') {
    return { ran: false, status: 'skipped', error: selectionUnavailableError(selection) };
  }
  const target = resolution.target;

  const { integration, adapter, refreshTokenExpiresAt } = target;

  const result = await runAccountingSyncCycle({
    knex,
    tenantId: tenant,
    adapterType: integration.adapterType,
    targetRealm: integration.targetRealm,
    adapter,
    refreshTokenExpiresAt,
    force: true
  });

  await writeAccountingAudit(knex, tenant, 'accounting_sync_cycle_run', {
    userId: user.user_id,
    provider: integration.adapterType === 'xero' ? 'xero' : 'quickbooks_online',
    recordId: integration.targetRealm,
    details: {
      ran: result.ran,
      status: result.status,
      source: 'sync_now',
    },
  }).catch((error) => {
    logger.warn('Failed to write accounting sync-cycle audit entry', { tenantId: tenant, error });
  });

  return result;
});

export type InvoiceSyncRefusalReason = 'not_found' | 'paid' | 'cancelled';

/** Queue a single invoice for (re-)export on the next cycle. */
export const queueInvoiceSync = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
  selection?: AccountingIntegrationSelection
): Promise<{ queued: boolean; error?: string; reason?: InvoiceSyncRefusalReason; opId?: string }> => {
  assertEnterpriseEdition();
  await checkExportsExecuteAccess(user);
  const { knex } = await createTenantKnex();

  const resolution = await resolveGuardedSyncTarget(knex, tenant, selection);
  if (resolution.status === 'blocked') {
    throw providerDisconnectError(resolution.provider);
  }
  if (resolution.status !== 'ready') {
    return { queued: false, error: selectionUnavailableError(selection) };
  }
  const target = resolution.target;

  const invoice = await tenantDb(knex, tenant)
    .table('invoices')
    .where({ invoice_id: invoiceId })
    .first('status');
  if (!invoice) {
    return { queued: false, error: 'Invoice not found.', reason: 'not_found' };
  }
  if (isInvoiceSyncBlockedStatus(invoice.status)) {
    return {
      queued: false,
      reason: invoice.status === 'paid' ? 'paid' : 'cancelled',
      error: invoice.status === 'paid'
        ? 'Paid invoices are not synced to the accounting provider.'
        : 'Voided or cancelled invoices are not synced to the accounting provider.'
    };
  }

  const op = await new SyncOperationsRepository(knex).enqueue({
    tenant,
    adapterType: target.integration.adapterType,
    targetRealm: target.integration.targetRealm,
    operation: 'export_invoice',
    algaEntityType: 'invoice',
    algaEntityId: invoiceId
  });

  return { queued: true, opId: op.op_id };
});

/** Drift resolution: push Alga's version back to the provider (queues a re-export). */
export const resolveAccountingDriftReExport = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
  selection?: AccountingIntegrationSelection
): Promise<{ queued: boolean; error?: string }> => {
  assertEnterpriseEdition();
  await checkExportsExecuteAccess(user);
  const { knex } = await createTenantKnex();

  const resolution = await resolveGuardedSyncTarget(knex, tenant, selection);
  if (resolution.status === 'blocked') {
    throw providerDisconnectError(resolution.provider);
  }
  if (resolution.status !== 'ready') {
    return { queued: false, error: selectionUnavailableError(selection) };
  }
  const target = resolution.target;

  await new SyncOperationsRepository(knex).enqueue({
    tenant,
    adapterType: target.integration.adapterType,
    targetRealm: target.integration.targetRealm,
    operation: 'export_invoice',
    algaEntityType: 'invoice',
    algaEntityId: invoiceId,
    payload: { reason: 'drift_reexport' }
  });

  return { queued: true };
});

/** Drift resolution: accept QBO's version (refresh the snapshot, no Alga change). */
export const resolveAccountingDriftAccept = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
  selection?: AccountingIntegrationSelection
): Promise<{ resolved: boolean; error?: string }> => {
  assertEnterpriseEdition();
  // Accepting the external snapshot rewrites the mapping's reconciliation
  // state — a mapping/reconciliation operation.
  await checkMappingsManageAccess(user);
  const { knex } = await createTenantKnex();

  const target = await resolveSyncTarget(knex, tenant, selection);
  if (!target) {
    return { resolved: false, error: selectionUnavailableError(selection) };
  }
  const { integration } = target;

  const ledger = new SyncMappingLedger(knex, tenant, integration.adapterType);
  const mapping = await ledger.findByAlgaId('invoice', invoiceId, integration.targetRealm);
  if (!mapping) {
    return { resolved: false, error: 'Invoice has no mapping for the connected company.' };
  }

  const metadata = mapping.metadata ?? {};
  const observed = metadata.external_observed ?? {};

  await ledger.update(mapping.id, {
    syncStatus: MAPPING_SYNC_STATUS.synced,
    metadata: {
      ...metadata,
      exported_total: observed.total ?? metadata.exported_total ?? null,
      doc_number: observed.doc_number ?? metadata.doc_number ?? null,
      sync_token: observed.sync_token ?? metadata.sync_token ?? null,
      drift_accepted_at: new Date().toISOString()
    },
    touchSyncedAt: true
  });

  await new WorkflowTaskSyncExceptionService(knex, tenant).resolve(
    'accounting_sync_drift',
    'invoice',
    invoiceId
  );

  return { resolved: true };
});

export type InvoiceSyncState = 'not_synced' | 'queued' | 'synced' | 'drift' | 'error' | 'voided';

export interface InvoiceSyncStatus {
  invoiceId: string;
  state: InvoiceSyncState;
  externalId?: string | null;
  docNumber?: string | null;
  lastSyncedAt?: string | null;
  error?: string | null;
  /** Intuit environment of the connection — drives the View-in-QuickBooks deep link. */
  environment?: 'sandbox' | 'production';
  /** Accounting provider that owns this mapping; gates provider-specific links. */
  provider?: 'qbo' | 'xero';
  /** Human-readable organisation name when the provider exposes one. */
  organisationName?: string | null;
}

/** Batched per-invoice sync status for list views and the badge. */
export const getInvoiceSyncStatuses = withAuth(async (
  user,
  { tenant },
  invoiceIds: string[]
): Promise<Record<string, InvoiceSyncStatus>> => {
  // Invoice lists and details are shared by CE and EE. A capability probe on
  // those core screens must not turn normal CE browsing into a 500 response.
  if (!isEnterpriseEdition()) {
    return {};
  }
  await checkCatalogReadAccess(user);
  const { knex } = await createTenantKnex();

  const ids = Array.from(new Set(invoiceIds)).filter(Boolean);
  if (ids.length === 0) {
    return {};
  }

  const target = await resolveSyncTarget(knex, tenant).catch(() => null);
  if (!target) {
    return {};
  }
  const { integration } = target;
  const integrationType = integration.adapterType;
  const targetRealm = integration.targetRealm;

  const [mappings, ops] = await Promise.all([
    tenantDb(knex, tenant).table('tenant_external_entity_mappings')
      .where({ integration_type: integrationType, alga_entity_type: 'invoice' })
      .whereIn('alga_entity_id', ids)
      // Organisation-scoped and tombstones excluded: another company's or an
      // unlinked mapping must never determine the displayed status.
      .where('external_realm_id', targetRealm)
      .whereNull('deleted_at')
      .select('alga_entity_id', 'external_entity_id', 'sync_status', 'last_synced_at', 'metadata'),
    tenantDb(knex, tenant).table('accounting_sync_operations')
      .where({ adapter_type: integrationType, operation: 'export_invoice', alga_entity_type: 'invoice' })
      .whereIn('alga_entity_id', ids)
      .where('target_realm', targetRealm)
      .whereIn('status', ['pending', 'in_progress', 'skipped'])
      .select('alga_entity_id', 'status', 'last_error')
  ]);

  const mappingByInvoice = new Map(mappings.map((row: any) => [row.alga_entity_id, row]));
  const opByInvoice = new Map<string, any>();
  for (const op of ops) {
    // skipped (terminal failure) outranks queued for display purposes
    const existing = opByInvoice.get(op.alga_entity_id);
    if (!existing || op.status === 'skipped') {
      opByInvoice.set(op.alga_entity_id, op);
    }
  }

  // The Intuit environment only applies to the QBO deep link; Xero has none.
  // Resolved per realm: the environment stamped on the stored connection, else
  // the tenant setting, else the deployment default.
  let environment: 'sandbox' | 'production' | undefined;
  if (integrationType === 'quickbooks_online') {
    environment = target.qboEnvironment ?? (await resolveTenantQboEnvironment(tenant));
  }

  const result: Record<string, InvoiceSyncStatus> = {};
  for (const invoiceId of ids) {
    const mapping = mappingByInvoice.get(invoiceId);
    const op = opByInvoice.get(invoiceId);

    let state: InvoiceSyncState = 'not_synced';
    if (op?.status === 'skipped' && !mapping) {
      // A terminal skipped op only matters while the invoice has never been
      // exported — once a mapping exists, a later export succeeded and the
      // mapping is the live truth.
      state = 'error';
    } else if (op && op.status !== 'skipped') {
      state = 'queued';
    } else if (mapping?.sync_status === MAPPING_SYNC_STATUS.drift) {
      state = 'drift';
    } else if (
      mapping?.sync_status === MAPPING_SYNC_STATUS.externalVoided ||
      mapping?.sync_status === MAPPING_SYNC_STATUS.voided
    ) {
      state = 'voided';
    } else if (mapping) {
      state = 'synced';
    }

    result[invoiceId] = {
      invoiceId,
      state,
      externalId: mapping?.external_entity_id ?? null,
      docNumber: mapping?.metadata?.doc_number ?? null,
      lastSyncedAt: mapping?.last_synced_at ?? null,
      error: op?.last_error ?? null,
      environment,
      provider: integrationType === 'xero' ? 'xero' : 'qbo'
    };
  }

  return result;
});

export interface AccountingSyncRealmInfo {
  realmId: string;
  displayName?: string | null;
  isDefault: boolean;
}

export interface AccountingSyncHealth {
  connected: boolean;
  settings: AccountingSyncSettings;
  lastCycle: AccountingSyncCycleRecord | null;
  pendingOps: number;
  erroredOps: number;
  driftCount: number;
  openExceptions: number;
  refreshTokenExpiresAt: string | null;
  reconnectRequired: boolean;
  /** All connected realms. Length > 1 means the multi-realm UX should be shown. */
  realms: AccountingSyncRealmInfo[];
  /**
   * QBO company setting 'Automatically apply credits' (Preferences →
   * SalesFormsPrefs.AutoApplyCredit). When true, QBO races Alga-driven credit
   * application by grabbing exported CreditMemos for its oldest open invoices.
   * null = could not be read (disconnected, API error).
   */
  autoApplyCreditsEnabled: boolean | null;
  /** Connected accounting provider selected for this tenant. */
  adapterType?: string | null;
  /** Human-readable organisation name when the provider exposes one. */
  organisationName?: string | null;
}

/** Health panel data for the integration settings page. */
export const getAccountingSyncHealth = withAuth(async (
  user,
  { tenant },
  selection: AccountingIntegrationSelection = {}
): Promise<AccountingSyncHealth> => {
  assertEnterpriseEdition();
  await checkCatalogReadAccess(user);
  const { knex } = await createTenantKnex();

  const settings = await getAccountingSyncSettings(knex, tenant);
  const qboCredentials = await getStoredQboCredentialsMap(tenant).catch(() => ({} as Record<string, any>));
  const xeroConnections = await getStoredXeroConnections(tenant).catch(() => ({} as Record<string, any>));
  const target = await resolveSyncTarget(knex, tenant, selection);

  const adapterType = target?.integration.adapterType ?? selection.preferredAdapterType ?? null;
  const realm = target?.integration.targetRealm ?? null;

  let realms: AccountingSyncRealmInfo[];
  let organisationName: string | null = null;
  if (adapterType === 'xero') {
    realms = Object.keys(xeroConnections).map((r) => ({
      realmId: r,
      displayName: xeroConnections[r]?.tenantName ?? null,
      isDefault: r === realm
    }));
    organisationName = realm ? xeroConnections[realm]?.tenantName ?? null : null;
  } else {
    const realmIds = Object.keys(qboCredentials);
    realms = realmIds.map((r) => ({ realmId: r, isDefault: r === realm }));
    organisationName = realm ?? null;
  }

  if (!target || !realm || !adapterType) {
    return {
      connected: false,
      settings,
      lastCycle: null,
      pendingOps: 0,
      erroredOps: 0,
      driftCount: 0,
      openExceptions: 0,
      refreshTokenExpiresAt: null,
      reconnectRequired: false,
      realms,
      autoApplyCreditsEnabled: null,
      adapterType,
      organisationName
    };
  }

  const ledger = new SyncMappingLedger(knex, tenant, adapterType);
  const [lastCycle, opCounts, statusCounts, openExceptions, autoApplyCreditsEnabled] = await Promise.all([
    new SyncCycleRepository(knex).getLatestCycle(tenant, adapterType, realm),
    new SyncOperationsRepository(knex).countByStatus(tenant, adapterType, realm),
    ledger.countByStatus(realm),
    new WorkflowTaskSyncExceptionService(knex, tenant).countOpen(realm),
    adapterType === 'quickbooks_online' ? readAutoApplyCreditsPreference(tenant, realm) : Promise.resolve(null)
  ]);

  const currentXeroConnection = adapterType === 'xero' && realm ? xeroConnections[realm] : undefined;
  // Shared with the shell integration-health banner so the two surfaces cannot
  // disagree about whether this connection needs re-authorisation.
  const reconnectRequired = isAccountingReconnectRequired({
    adapterType,
    accessTokenExpiresAt: currentXeroConnection?.accessTokenExpiresAt ?? null,
    lastCycleError: lastCycle?.error ?? null
  });

  return {
    connected: true,
    settings,
    lastCycle,
    pendingOps: (opCounts['pending'] ?? 0) + (opCounts['in_progress'] ?? 0),
    // Terminal failures are both capped retries ('skipped') and capability-gated
    // or otherwise non-retryable operations ('failed'). Both are terminal and
    // must be visible; counts stay scoped to adapter type + target realm.
    erroredOps: (opCounts['skipped'] ?? 0) + (opCounts['failed'] ?? 0),
    driftCount:
      (statusCounts[MAPPING_SYNC_STATUS.drift] ?? 0) + (statusCounts[MAPPING_SYNC_STATUS.externalVoided] ?? 0),
    openExceptions,
    refreshTokenExpiresAt:
      adapterType === 'xero'
        ? xeroConnections[realm]?.refreshTokenExpiresAt ?? null
        : qboCredentials[realm]?.refreshTokenExpiresAt ?? null,
    reconnectRequired,
    realms,
    autoApplyCreditsEnabled,
    adapterType,
    organisationName
  };
});

export type InvoiceSyncOutcome =
  | { outcome: 'synced' }
  | { outcome: 'failed'; reason: string | null }
  | { outcome: 'skipped'; reason: string | null }
  | { outcome: 'pending' }
  | { outcome: 'unknown' };

/**
 * What actually happened to the export op queued for one invoice. `done` is the
 * only synced state. A pending op that already recorded an error was attempted
 * and failed (it is retried by a later cycle) — reported as failed, never as
 * success.
 */
export const getInvoiceSyncOutcome = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
  opId: string
): Promise<InvoiceSyncOutcome> => {
  assertEnterpriseEdition();
  await checkExportsExecuteAccess(user);
  const { knex } = await createTenantKnex();

  const op = await new SyncOperationsRepository(knex).getById(tenant, opId);
  if (!op || op.alga_entity_type !== 'invoice' || op.alga_entity_id !== invoiceId) {
    return { outcome: 'unknown' };
  }
  switch (op.status) {
    case 'done':
      return { outcome: 'synced' };
    case 'failed':
      return { outcome: 'failed', reason: op.last_error || null };
    case 'skipped':
      return { outcome: 'skipped', reason: op.last_error || null };
    default:
      return op.attempts > 0 && op.last_error
        ? { outcome: 'failed', reason: op.last_error }
        : { outcome: 'pending' };
  }
});

export type ErroredSyncEntityKind =
  | 'invoice'
  | 'credit_memo'
  | 'vendor_bill'
  /** record_payment op; displayName is the paid invoice's number. */
  | 'payment'
  /** apply_credit op; displayName is the invoice the credit was applied to. */
  | 'credit_application'
  | 'other';

export interface ErroredSyncOperationRow {
  opId: string;
  entityType: string;
  entityKind: ErroredSyncEntityKind;
  /** Resolved on the server; null when the entity was deleted or has no display field. Never an ID. */
  displayName: string | null;
  operation: string;
  status: 'failed' | 'skipped';
  attempts: number;
  lastError: string | null;
  timestamp: string;
  batchId: string | null;
  batchLabel: string | null;
  batchQueuedAt: string | null;
}

const ERRORED_OPS_LIMIT = 500;

/** Failed + skipped sync operations behind the "Errored ops" badge, same scope. */
export const getErroredSyncOperations = withAuth(async (
  user,
  { tenant },
  selection: AccountingIntegrationSelection = {}
): Promise<ErroredSyncOperationRow[]> => {
  assertEnterpriseEdition();
  await checkCatalogReadAccess(user);
  const { knex } = await createTenantKnex();

  const target = await resolveSyncTarget(knex, tenant, selection);
  const adapterType = target?.integration.adapterType ?? selection.preferredAdapterType ?? null;
  const realm = target?.integration.targetRealm ?? null;
  // Mirrors getAccountingSyncHealth: without a resolved adapter + realm the badge is 0.
  if (!target || !realm || !adapterType) return [];

  const ops = await new SyncOperationsRepository(knex).listErrored(tenant, adapterType, realm, {
    limit: ERRORED_OPS_LIMIT
  });
  if (ops.length === 0) return [];

  const idsOf = (type: string) => [...new Set(ops.filter((o) => o.alga_entity_type === type).map((o) => o.alga_entity_id))];
  const invoiceIds = idsOf('invoice');
  const billIds = idsOf('vendor_bill');
  const paymentIds = idsOf('invoice_payment');
  const allocationIds = idsOf('credit_allocation');
  const db = tenantDb(knex, tenant);

  // One batched query per entity type — never per row. Payments and credit
  // applications are named by the invoice they settle.
  const [invoiceRows, billRows, batchRows, paymentRows, allocationRows] = await Promise.all([
    invoiceIds.length
      ? db.table('invoices').whereIn('invoice_id', invoiceIds).select('invoice_id', 'invoice_number', 'invoice_type')
      : Promise.resolve([] as any[]),
    billIds.length
      // vendor_bills is not in the tenantDb table registry (vendorBillExportActions
      // also reads it through raw knex), so scope by tenant explicitly.
      ? knex('vendor_bills').where({ tenant }).whereIn('bill_id', billIds).select('bill_id', 'bill_number')
      : Promise.resolve([] as any[]),
    invoiceIds.length + billIds.length
      ? db.tenantJoin(db.table('accounting_export_lines as line'), 'accounting_export_batches as batch', 'line.batch_id', 'batch.batch_id')
          .where({ 'batch.adapter_type': adapterType, 'batch.target_realm': realm })
          // Lines reference documents generically (document_id); export_type keeps
          // invoice and vendor-bill documents apart.
          .where((q: any) =>
            q.where((inv: any) => inv.where('batch.export_type', 'invoice').whereIn('line.document_id', invoiceIds))
              .orWhere((bill: any) => bill.where('batch.export_type', 'vendor_bill').whereIn('line.document_id', billIds))
          )
          .orderBy('batch.created_at', 'desc')
          .select('line.document_id', 'batch.batch_id', 'batch.export_type', 'batch.queued_at')
      : Promise.resolve([] as any[]),
    paymentIds.length
      ? db.tenantJoin(db.table('invoice_payments as payment'), 'invoices as inv', 'payment.invoice_id', 'inv.invoice_id')
          .whereIn('payment.payment_id', paymentIds)
          .select('payment.payment_id', 'inv.invoice_number')
      : Promise.resolve([] as any[]),
    allocationIds.length
      ? db.tenantJoin(db.table('credit_allocations as allocation'), 'invoices as inv', 'allocation.invoice_id', 'inv.invoice_id')
          .whereIn('allocation.allocation_id', allocationIds)
          .select('allocation.allocation_id', 'inv.invoice_number')
      : Promise.resolve([] as any[])
  ]);

  const invoices = new Map<string, any>(invoiceRows.map((r: any) => [r.invoice_id, r]));
  const bills = new Map<string, any>(billRows.map((r: any) => [r.bill_id, r]));
  const paymentInvoiceNumbers = new Map<string, string>(paymentRows.map((r: any) => [r.payment_id, r.invoice_number]));
  const allocationInvoiceNumbers = new Map<string, string>(allocationRows.map((r: any) => [r.allocation_id, r.invoice_number]));
  const latestBatch = new Map<string, any>();
  for (const row of batchRows as any[]) {
    const key = `${row.export_type}:${row.document_id}`;
    if (!latestBatch.has(key)) latestBatch.set(key, row);
  }

  return ops.map((op): ErroredSyncOperationRow => {
    let entityKind: ErroredSyncEntityKind = 'other';
    let displayName: string | null = null;
    let batch: any = null;
    if (op.alga_entity_type === 'invoice') {
      const invoice = invoices.get(op.alga_entity_id);
      entityKind = invoice?.invoice_type === 'credit_note' || op.operation === 'export_credit_memo' ? 'credit_memo' : 'invoice';
      displayName = invoice?.invoice_number ?? null;
      batch = latestBatch.get(`invoice:${op.alga_entity_id}`) ?? null;
    } else if (op.alga_entity_type === 'vendor_bill') {
      entityKind = 'vendor_bill';
      displayName = bills.get(op.alga_entity_id)?.bill_number ?? null;
      batch = latestBatch.get(`vendor_bill:${op.alga_entity_id}`) ?? null;
    } else if (op.alga_entity_type === 'invoice_payment') {
      entityKind = 'payment';
      displayName = paymentInvoiceNumbers.get(op.alga_entity_id) ?? null;
    } else if (op.alga_entity_type === 'credit_allocation') {
      entityKind = 'credit_application';
      displayName = allocationInvoiceNumbers.get(op.alga_entity_id) ?? null;
    }
    // LEVERAGE: pattern sync-entity-display-name — the op entity types are a closed set (SyncOperationType);
    // a registry of per-entity-type resolvers would replace this chain. Unknown types render a placeholder, never the ID.
    return {
      opId: op.op_id,
      entityType: op.alga_entity_type,
      entityKind,
      displayName,
      operation: op.operation,
      status: op.status as 'failed' | 'skipped',
      attempts: op.attempts,
      lastError: op.last_error,
      timestamp: String(op.processed_at ?? op.created_at),
      batchId: batch?.batch_id ?? null,
      batchLabel: batch ? String(batch.export_type) : null,
      batchQueuedAt: batch?.queued_at ? String(batch.queued_at) : null
    };
  });
});

/** Best-effort read of QBO 'Automatically apply credits'; null when unreadable. */
async function readAutoApplyCreditsPreference(tenant: string, realm: string): Promise<boolean | null> {
  try {
    const qboClient = await QboClientService.create(tenant, realm);
    const prefs = await qboClient.getPreferences<any>();
    const value = prefs?.SalesFormsPrefs?.AutoApplyCredit;
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * Shared implementation for selecting the tenant's default accounting
 * organisation. Validates the exact provider + target is currently connected
 * (fail closed) before persisting settings.defaultRealm.
 */
async function setDefaultAccountingRealmImpl(
  user: IUserWithRoles,
  tenant: string,
  adapterType: 'quickbooks_online' | 'xero',
  realmId: string
): Promise<{ success: boolean; error?: string }> {
  assertEnterpriseEdition();
  await checkConnectionsManageAccess(user);

  const { knex } = await createTenantKnex();
  const resolved = await resolveSyncTarget(knex, tenant, {
    preferredAdapterType: adapterType,
    preferredTargetRealm: realmId
  });

  if (
    !resolved ||
    resolved.integration.adapterType !== adapterType ||
    resolved.integration.targetRealm !== realmId
  ) {
    const label = adapterType === 'xero' ? 'Xero organisation' : 'QuickBooks company';
    return {
      success: false,
      error: `The selected ${label} (${realmId}) is not connected for this tenant. Reconnect it or choose another.`
    };
  }

  await updateAccountingSyncSettings(knex, tenant, { defaultRealm: realmId });

  await writeAccountingAudit(knex, tenant, 'accounting_default_realm_changed', {
    userId: user.user_id,
    provider: adapterType === 'xero' ? 'xero' : 'quickbooks_online',
    recordId: realmId,
    details: { realmId, adapterType },
  }).catch((error) => {
    logger.warn('Failed to write default-realm audit entry', { tenantId: tenant, error });
  });

  return { success: true };
}

function mapDefaultRealmError(error: unknown, label: string): { success: false; error: string } {
  if (error instanceof Error && error.message === 'Accounting sync is only available in Enterprise Edition.') {
    return { success: false, error: 'Accounting sync is only available in Enterprise Edition.' };
  }
  if (error instanceof Error && error.message === 'Forbidden') {
    return { success: false, error: 'You do not have permission to update accounting sync settings.' };
  }
  console.error(`Failed to set default ${label}:`, error);
  return { success: false, error: `Failed to update the default ${label}. Please try again.` };
}

/**
 * Set the default organisation for either connected provider. Used by both
 * QuickBooks and Xero settings surfaces so the selected organisation is the one
 * interactive actions target.
 */
export const setDefaultAccountingRealm = withAuth(async (
  user,
  { tenant },
  adapterType: 'quickbooks_online' | 'xero',
  realmId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    return await setDefaultAccountingRealmImpl(user, tenant, adapterType, realmId);
  } catch (error) {
    return mapDefaultRealmError(error, adapterType === 'xero' ? 'Xero organisation' : 'QuickBooks company');
  }
});

/**
 * Set the default QBO realm for this tenant.
 * Retained for existing callers; delegates to the provider-neutral action.
 */
export const setDefaultQboRealm = withAuth(async (
  user,
  { tenant },
  realmId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    return await setDefaultAccountingRealmImpl(user, tenant, 'quickbooks_online', realmId);
  } catch (error) {
    return mapDefaultRealmError(error, 'QuickBooks company');
  }
});
