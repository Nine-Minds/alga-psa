import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Per-tenant Intuit environment (sandbox or production).
 *
 * Stored under tenant_settings.settings.qbo as `{ environment: 'sandbox' |
 * 'production' }`. No dedicated table; the key is a sibling of
 * `qboAutomatedSalesTax` and the billing-owned `accountingSync` subtree, so the
 * same locked read-merge-write rules apply (see setQboAutomatedSalesTaxEnabled).
 *
 * Absent key means "use the deployment-wide value" — `QBO_ENVIRONMENT`, else
 * production when NODE_ENV=production — which is exactly what every tenant did
 * before this setting existed.
 */

const QBO_SETTINGS_KEY = 'qbo';

export type QboEnvironmentSetting = 'sandbox' | 'production';

function normalize(raw: unknown): QboEnvironmentSetting | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const environment = (raw as Record<string, unknown>).environment;
  if (typeof environment !== 'string') {
    return null;
  }
  const value = environment.trim().toLowerCase();
  return value === 'sandbox' || value === 'production' ? value : null;
}

export async function getTenantQboEnvironmentSetting(
  knexOrTrx: Knex | Knex.Transaction,
  tenantId: string
): Promise<QboEnvironmentSetting | null> {
  const row = await tenantDb(knexOrTrx, tenantId).table('tenant_settings')
    .select('settings')
    .first();

  // settings is jsonb; knex/pg hands it back already parsed.
  return normalize(row?.settings?.[QBO_SETTINGS_KEY]);
}

/**
 * Writes the tenant's Intuit environment.
 *
 * The whole `settings` blob is rewritten, so the read and the write run in one
 * transaction with the row locked FOR UPDATE — a concurrent writer to a sibling
 * key (`qboAutomatedSalesTax`, `accountingSync`, the onboarding subtree) would
 * otherwise read the same pre-image and clobber whichever write landed first.
 */
export async function setTenantQboEnvironmentSetting(
  knex: Knex,
  tenantId: string,
  environment: QboEnvironmentSetting
): Promise<QboEnvironmentSetting> {
  if (environment !== 'sandbox' && environment !== 'production') {
    throw new Error('The Intuit environment must be either "sandbox" or "production".');
  }

  return knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenantId);
    const row = await db.table('tenant_settings')
      .select('settings')
      .forUpdate()
      .first();

    const settings = {
      ...(row?.settings ?? {}),
      [QBO_SETTINGS_KEY]: {
        ...(row?.settings?.[QBO_SETTINGS_KEY] && typeof row.settings[QBO_SETTINGS_KEY] === 'object'
          ? row.settings[QBO_SETTINGS_KEY]
          : {}),
        environment
      }
    };

    if (row) {
      await db.table('tenant_settings').update({
        settings: JSON.stringify(settings),
        updated_at: trx.fn.now()
      });
    } else {
      // No row to lock, so two first-time writers could race here; the unique
      // tenant primary key turns the loser into a conflict we merge into.
      await trx.table('tenant_settings')
        .insert({ tenant: tenantId, settings: JSON.stringify(settings) })
        .onConflict('tenant')
        .merge(['settings']);
    }

    return environment;
  });
}
