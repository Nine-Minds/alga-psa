import { Knex } from 'knex';

export interface AccountingSyncSettings {
  autoSyncEnabled: boolean;
  /** Invoices finalized before this ISO date are never auto-enqueued (set by the onboarding wizard). */
  autoSyncStartDate: string | null;
}

const DEFAULT_SETTINGS: AccountingSyncSettings = {
  autoSyncEnabled: false,
  autoSyncStartDate: null
};

function normalize(raw: unknown): AccountingSyncSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SETTINGS };
  }
  const record = raw as Record<string, unknown>;
  return {
    autoSyncEnabled: Boolean(record.autoSyncEnabled),
    autoSyncStartDate: typeof record.autoSyncStartDate === 'string' ? record.autoSyncStartDate : null
  };
}

export async function getAccountingSyncSettings(knex: Knex, tenantId: string): Promise<AccountingSyncSettings> {
  const row = await knex('tenant_settings')
    .where({ tenant: tenantId })
    .select('settings')
    .first();

  return normalize(row?.settings?.accountingSync);
}

export async function updateAccountingSyncSettings(
  knex: Knex,
  tenantId: string,
  patch: Partial<AccountingSyncSettings>
): Promise<AccountingSyncSettings> {
  const row = await knex('tenant_settings')
    .where({ tenant: tenantId })
    .select('settings')
    .first();

  const current = normalize(row?.settings?.accountingSync);
  const next: AccountingSyncSettings = { ...current, ...patch };

  if (row) {
    await knex('tenant_settings')
      .where({ tenant: tenantId })
      .update({
        settings: { ...(row.settings ?? {}), accountingSync: next },
        updated_at: knex.fn.now()
      });
  } else {
    await knex('tenant_settings').insert({
      tenant: tenantId,
      settings: { accountingSync: next }
    });
  }

  return next;
}
