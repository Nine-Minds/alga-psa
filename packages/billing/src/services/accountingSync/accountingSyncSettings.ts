import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/** A reference to a named QBO entity (account, class, department, etc.). */
export interface QboRef {
  value: string;
  name: string;
}

/** @deprecated Use QboRef */
export type QboAccountRef = QboRef;

export interface AccountingSyncSettings {
  autoSyncEnabled: boolean;
  /** Invoices finalized before this ISO date are never auto-enqueued (set by the onboarding wizard). */
  autoSyncStartDate: string | null;
  /** QBO account to deposit payments into (Bank or Other Current Asset). Null = Undeposited Funds. */
  depositAccountRef: QboRef | null;
  /** Default QBO class applied to invoice lines when the item mapping has no classId. */
  defaultClassRef: QboRef | null;
  /** Default QBO department applied at the invoice header. */
  defaultDepartmentRef: QboRef | null;
  /** Default QBO expense account applied to vendor bill lines. */
  defaultExpenseAccountRef?: QboRef | null;
  /** The realm that sync operations target when no explicit realm is specified. */
  defaultRealm: string | null;
}

const DEFAULT_SETTINGS: AccountingSyncSettings = {
  autoSyncEnabled: false,
  autoSyncStartDate: null,
  depositAccountRef: null,
  defaultClassRef: null,
  defaultDepartmentRef: null,
  defaultExpenseAccountRef: null,
  defaultRealm: null
};

function normalizeQboRef(raw: unknown): QboRef | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.value !== 'string' || !record.value) {
    return null;
  }
  return {
    value: record.value,
    name: typeof record.name === 'string' ? record.name : record.value
  };
}

function normalize(raw: unknown): AccountingSyncSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SETTINGS };
  }
  const record = raw as Record<string, unknown>;
  return {
    autoSyncEnabled: Boolean(record.autoSyncEnabled),
    autoSyncStartDate: typeof record.autoSyncStartDate === 'string' ? record.autoSyncStartDate : null,
    depositAccountRef: normalizeQboRef(record.depositAccountRef),
    defaultClassRef: normalizeQboRef(record.defaultClassRef),
    defaultDepartmentRef: normalizeQboRef(record.defaultDepartmentRef),
    defaultExpenseAccountRef: normalizeQboRef(record.defaultExpenseAccountRef),
    defaultRealm: typeof record.defaultRealm === 'string' ? record.defaultRealm : null
  };
}

export async function getAccountingSyncSettings(knex: Knex, tenantId: string): Promise<AccountingSyncSettings> {
  const row = await tenantDb(knex, tenantId).table('tenant_settings')
    .select('settings')
    .first();

  return normalize(row?.settings?.accountingSync);
}

export async function updateAccountingSyncSettings(
  knex: Knex,
  tenantId: string,
  patch: Partial<AccountingSyncSettings>
): Promise<AccountingSyncSettings> {
  const db = tenantDb(knex, tenantId);
  const row = await db.table('tenant_settings')
    .select('settings')
    .first();

  const current = normalize(row?.settings?.accountingSync);
  const next: AccountingSyncSettings = { ...current, ...patch };

  if (row) {
    await db.table('tenant_settings')
      .update({
        settings: { ...(row.settings ?? {}), accountingSync: next },
        updated_at: knex.fn.now()
      });
  } else {
    await db.table('tenant_settings').insert({
      tenant: tenantId,
      settings: { accountingSync: next }
    });
  }

  return next;
}

/**
 * Returns the configured QBO deposit account ref from tenant settings, or null
 * when unset (QBO will default to Undeposited Funds at delivery time).
 */
export async function getDepositAccountRef(knex: Knex, tenantId: string): Promise<QboRef | null> {
  const settings = await getAccountingSyncSettings(knex, tenantId);
  return settings.depositAccountRef;
}

/**
 * Resolves the default QBO realm for a tenant.
 *
 * Priority:
 * 1. settings.accountingSync.defaultRealm when it exists in the stored credentials map
 * 2. getDefaultQboRealmId fallback (first-stored-key ordering)
 *
 * Import is deferred to break the circular dependency between billing and integrations.
 */
export async function resolveDefaultRealm(knex: Knex, tenantId: string): Promise<string | null> {
  const settings = await getAccountingSyncSettings(knex, tenantId);

  if (settings.defaultRealm) {
    // Validate the stored default realm is still in the credentials map
    // eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- billing→integrations is the allowed direction
    const { getStoredQboCredentialsMap } = await import('@alga-psa/integrations/lib/qbo/qboClientService');
    const credentialsMap = await getStoredQboCredentialsMap(tenantId).catch(() => ({}));
    if (settings.defaultRealm in credentialsMap) {
      return settings.defaultRealm;
    }
    // Configured realm no longer connected; fall through to system default
  }

  // eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- billing→integrations is the allowed direction
  const { getDefaultQboRealmId } = await import('@alga-psa/integrations/lib/qbo/qboClientService');
  return getDefaultQboRealmId(tenantId).catch(() => null);
}
