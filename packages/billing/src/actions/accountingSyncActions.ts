'use server';

/* eslint-disable custom-rules/no-feature-to-feature-imports -- sync actions consult QBO connection state */
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import { getStoredQboCredentialsMap, QboClientService } from '@alga-psa/integrations/lib/qbo/qboClientService';
import {
  getAccountingSyncSettings,
  updateAccountingSyncSettings,
  resolveDefaultRealm,
  type AccountingSyncSettings,
  type QboRef
} from '../services/accountingSync/accountingSyncSettings';
import { runAccountingSyncCycle, type RunCycleResult } from '../services/accountingSync/accountingSyncCycleService';
import { SyncOperationsRepository } from '../services/accountingSync/syncOperationsRepository';
import { SyncCycleRepository } from '../services/accountingSync/syncCycleRepository';
import { SyncMappingLedger } from '../services/accountingSync/syncMappingLedger';
import { WorkflowTaskSyncExceptionService } from '../services/accountingSync/syncExceptionService';
import { MAPPING_SYNC_STATUS, type AccountingSyncCycleRecord } from '../services/accountingSync/accountingSync.types';
import { AccountingAdapterRegistry } from '../adapters/accounting/registry';

const SYNC_ADAPTER_TYPE = 'quickbooks_online';

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

async function checkBillingReadAccess(user: IUserWithRoles): Promise<void> {
  const allowed = await hasPermission(user, 'billing_settings', 'read');
  if (!allowed) {
    throw new Error('Forbidden');
  }
}

async function checkBillingUpdateAccess(user: IUserWithRoles): Promise<void> {
  const allowed = await hasPermission(user, 'billing_settings', 'update');
  if (!allowed) {
    throw new Error('Forbidden');
  }
}

export const getAccountingSyncSettingsAction = withAuth(async (
  user,
  { tenant }
): Promise<AccountingSyncSettings> => {
  assertEnterpriseEdition();
  await checkBillingReadAccess(user);
  const { knex } = await createTenantKnex();
  return getAccountingSyncSettings(knex, tenant);
});

export const updateAccountingSyncSettingsAction = withAuth(async (
  user,
  { tenant },
  patch: Partial<AccountingSyncSettings>
): Promise<AccountingSyncSettings> => {
  assertEnterpriseEdition();
  await checkBillingUpdateAccess(user);
  const { knex } = await createTenantKnex();
  return updateAccountingSyncSettings(knex, tenant, {
    ...(patch.autoSyncEnabled !== undefined ? { autoSyncEnabled: Boolean(patch.autoSyncEnabled) } : {}),
    ...(patch.autoSyncStartDate !== undefined ? { autoSyncStartDate: patch.autoSyncStartDate } : {}),
    ...(patch.autoProvisionCustomers !== undefined ? { autoProvisionCustomers: Boolean(patch.autoProvisionCustomers) } : {}),
    ...(patch.depositAccountRef !== undefined ? { depositAccountRef: patch.depositAccountRef } : {}),
    ...(patch.defaultClassRef !== undefined ? { defaultClassRef: patch.defaultClassRef } : {}),
    ...(patch.defaultDepartmentRef !== undefined ? { defaultDepartmentRef: patch.defaultDepartmentRef } : {}),
    ...(patch.defaultRealm !== undefined ? { defaultRealm: patch.defaultRealm } : {})
  });
});

/** Run an immediate sync cycle for the tenant's default realm (Sync Now). */
export const runAccountingSyncNow = withAuth(async (
  user,
  { tenant }
): Promise<RunCycleResult> => {
  assertEnterpriseEdition();
  await checkBillingUpdateAccess(user);
  const { knex } = await createTenantKnex();

  const realm = await resolveDefaultRealm(knex, tenant);
  if (!realm) {
    return { ran: false, status: 'skipped', error: 'No QuickBooks company is connected.' };
  }

  const registry = await AccountingAdapterRegistry.createDefault();
  const adapter = registry.get(SYNC_ADAPTER_TYPE);
  if (!adapter) {
    return { ran: false, status: 'skipped', error: 'QuickBooks adapter unavailable.' };
  }

  const credentials = await getStoredQboCredentialsMap(tenant);

  return runAccountingSyncCycle({
    knex,
    tenantId: tenant,
    adapterType: SYNC_ADAPTER_TYPE,
    targetRealm: realm,
    adapter,
    refreshTokenExpiresAt: credentials[realm]?.refreshTokenExpiresAt ?? null,
    force: true
  });
});

/** Queue a single invoice for (re-)export on the next cycle. */
export const queueInvoiceSync = withAuth(async (
  user,
  { tenant },
  invoiceId: string
): Promise<{ queued: boolean; error?: string }> => {
  assertEnterpriseEdition();
  await checkBillingUpdateAccess(user);
  const { knex } = await createTenantKnex();

  const realm = await resolveDefaultRealm(knex, tenant);
  if (!realm) {
    return { queued: false, error: 'No QuickBooks company is connected.' };
  }

  await new SyncOperationsRepository(knex).enqueue({
    tenant,
    adapterType: SYNC_ADAPTER_TYPE,
    targetRealm: realm,
    operation: 'export_invoice',
    algaEntityType: 'invoice',
    algaEntityId: invoiceId
  });

  return { queued: true };
});

/** Drift resolution: push Alga's version back to QBO (queues a re-export). */
export const resolveAccountingDriftReExport = withAuth(async (
  user,
  { tenant },
  invoiceId: string
): Promise<{ queued: boolean; error?: string }> => {
  assertEnterpriseEdition();
  await checkBillingUpdateAccess(user);
  const { knex } = await createTenantKnex();

  const realm = await resolveDefaultRealm(knex, tenant);
  if (!realm) {
    return { queued: false, error: 'No QuickBooks company is connected.' };
  }

  await new SyncOperationsRepository(knex).enqueue({
    tenant,
    adapterType: SYNC_ADAPTER_TYPE,
    targetRealm: realm,
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
  invoiceId: string
): Promise<{ resolved: boolean; error?: string }> => {
  assertEnterpriseEdition();
  await checkBillingUpdateAccess(user);
  const { knex } = await createTenantKnex();

  const ledger = new SyncMappingLedger(knex, tenant, SYNC_ADAPTER_TYPE);
  const mapping = await ledger.findByAlgaId('invoice', invoiceId);
  if (!mapping) {
    return { resolved: false, error: 'Invoice has no QuickBooks mapping.' };
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
  await checkBillingReadAccess(user);
  const { knex } = await createTenantKnex();

  const ids = Array.from(new Set(invoiceIds)).filter(Boolean);
  if (ids.length === 0) {
    return {};
  }

  const [mappings, ops] = await Promise.all([
    tenantDb(knex, tenant).table('tenant_external_entity_mappings')
      .where({ integration_type: SYNC_ADAPTER_TYPE, alga_entity_type: 'invoice' })
      .whereIn('alga_entity_id', ids)
      .select('alga_entity_id', 'external_entity_id', 'sync_status', 'last_synced_at', 'metadata'),
    tenantDb(knex, tenant).table('accounting_sync_operations')
      .where({ adapter_type: SYNC_ADAPTER_TYPE, operation: 'export_invoice', alga_entity_type: 'invoice' })
      .whereIn('alga_entity_id', ids)
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

  const { getQboEnvironment } = await import('@alga-psa/integrations/lib/qbo/qboClientService');
  const environment = getQboEnvironment();

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
      environment
    };
  }

  return result;
});

export interface AccountingSyncRealmInfo {
  realmId: string;
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
  /** All connected realms. Length > 1 means the multi-realm UX should be shown. */
  realms: AccountingSyncRealmInfo[];
  /**
   * QBO company setting 'Automatically apply credits' (Preferences →
   * SalesFormsPrefs.AutoApplyCredit). When true, QBO races Alga-driven credit
   * application by grabbing exported CreditMemos for its oldest open invoices.
   * null = could not be read (disconnected, API error).
   */
  autoApplyCreditsEnabled: boolean | null;
}

/** Health panel data for the integration settings page. */
export const getAccountingSyncHealth = withAuth(async (
  user,
  { tenant }
): Promise<AccountingSyncHealth> => {
  assertEnterpriseEdition();
  await checkBillingReadAccess(user);
  const { knex } = await createTenantKnex();

  const settings = await getAccountingSyncSettings(knex, tenant);
  const realm = await resolveDefaultRealm(knex, tenant).catch(() => null);
  const credentials = await getStoredQboCredentialsMap(tenant).catch(() => ({} as Record<string, any>));

  const realmIds = Object.keys(credentials);
  const defaultRealm = settings.defaultRealm && realmIds.includes(settings.defaultRealm)
    ? settings.defaultRealm
    : (realm ?? realmIds[0] ?? null);

  const realms: AccountingSyncRealmInfo[] = realmIds.map((r) => ({
    realmId: r,
    isDefault: r === defaultRealm
  }));

  if (!realm) {
    return {
      connected: false,
      settings,
      lastCycle: null,
      pendingOps: 0,
      erroredOps: 0,
      driftCount: 0,
      openExceptions: 0,
      refreshTokenExpiresAt: null,
      realms,
      autoApplyCreditsEnabled: null
    };
  }

  const ledger = new SyncMappingLedger(knex, tenant, SYNC_ADAPTER_TYPE);
  const [lastCycle, opCounts, statusCounts, openExceptions, autoApplyCreditsEnabled] = await Promise.all([
    new SyncCycleRepository(knex).getLatestCycle(tenant, SYNC_ADAPTER_TYPE, realm),
    new SyncOperationsRepository(knex).countByStatus(tenant, SYNC_ADAPTER_TYPE),
    ledger.countByStatus(),
    new WorkflowTaskSyncExceptionService(knex, tenant).countOpen(),
    readAutoApplyCreditsPreference(tenant, realm)
  ]);

  return {
    connected: true,
    settings,
    lastCycle,
    pendingOps: (opCounts['pending'] ?? 0) + (opCounts['in_progress'] ?? 0),
    erroredOps: opCounts['skipped'] ?? 0,
    driftCount:
      (statusCounts[MAPPING_SYNC_STATUS.drift] ?? 0) + (statusCounts[MAPPING_SYNC_STATUS.externalVoided] ?? 0),
    openExceptions,
    refreshTokenExpiresAt: credentials[realm]?.refreshTokenExpiresAt ?? null,
    realms,
    autoApplyCreditsEnabled
  };
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
 * Set the default QBO realm for this tenant.
 * Validates that the realm exists in the stored credentials map before saving.
 */
export const setDefaultQboRealm = withAuth(async (
  user,
  { tenant },
  realmId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    assertEnterpriseEdition();
    await checkBillingUpdateAccess(user);

    const credentials = await getStoredQboCredentialsMap(tenant).catch(() => ({} as Record<string, any>));
    if (!(realmId in credentials)) {
      return { success: false, error: `Realm ${realmId} is not a connected QuickBooks company for this tenant.` };
    }

    const { knex } = await createTenantKnex();
    await updateAccountingSyncSettings(knex, tenant, { defaultRealm: realmId });
    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.message === 'Accounting sync is only available in Enterprise Edition.') {
      return { success: false, error: 'Accounting sync is only available in Enterprise Edition.' };
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return { success: false, error: 'You do not have permission to update accounting sync settings.' };
    }
    console.error('Failed to set default QuickBooks realm:', error);
    return { success: false, error: 'Failed to update the default QuickBooks company. Please try again.' };
  }
});
