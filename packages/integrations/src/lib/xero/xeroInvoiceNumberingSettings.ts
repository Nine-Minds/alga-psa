import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Per-organisation "Let Xero assign invoice numbers" mode (alga-2026-0002746).
 *
 * Stored under tenant_settings.settings.xeroInvoiceNumbering as
 * `{ xeroAssignedRealms: string[] }` — the Xero tenant ids (the export batch
 * `target_realm`) whose organisations number invoices themselves. Sibling of
 * the billing-owned `accountingSync` subtree, so neither side's normalization
 * can drop the other's data.
 *
 * Default off: a missing key, a malformed value, or an unlisted realm all mean
 * Alga numbering. The mode is recorded per invoice at finalize
 * (invoices.invoice_number_source); this setting only decides it for invoices
 * finalized later.
 */

export const XERO_INVOICE_NUMBERING_SETTINGS_KEY = 'xeroInvoiceNumbering';

interface XeroInvoiceNumberingSettings {
  xeroAssignedRealms: string[];
}

function normalize(raw: unknown): XeroInvoiceNumberingSettings {
  if (!raw || typeof raw !== 'object') {
    return { xeroAssignedRealms: [] };
  }
  const realms = (raw as Record<string, unknown>).xeroAssignedRealms;
  if (!Array.isArray(realms)) {
    return { xeroAssignedRealms: [] };
  }
  return {
    xeroAssignedRealms: realms.filter(
      (realm): realm is string => typeof realm === 'string' && realm.length > 0
    )
  };
}

export async function getXeroAssignedNumberingRealms(
  knexOrTrx: Knex | Knex.Transaction,
  tenantId: string
): Promise<string[]> {
  const row = await tenantDb(knexOrTrx, tenantId).table('tenant_settings')
    .select('settings')
    .first();

  return normalize(row?.settings?.[XERO_INVOICE_NUMBERING_SETTINGS_KEY]).xeroAssignedRealms;
}

export async function isXeroAssignedNumberingEnabled(
  knexOrTrx: Knex | Knex.Transaction,
  tenantId: string,
  realmId: string | null | undefined
): Promise<boolean> {
  if (!realmId) {
    return false;
  }
  const realms = await getXeroAssignedNumberingRealms(knexOrTrx, tenantId);
  return realms.includes(realmId);
}

/**
 * Adds or removes a Xero organisation from the Xero-assigned list.
 *
 * Locked read-merge-write in one transaction: the whole `settings` blob is
 * rewritten, so without FOR UPDATE a concurrent writer to a sibling key would
 * be clobbered. Same shape as setTenantQboEnvironmentSetting.
 */
// LEVERAGE: pattern tenant-settings-subtree-realm-list — third copy of the locked read-merge-write of a tenant_settings subtree (qboTaxSettings, qboEnvironmentSettings, this)
export async function setXeroAssignedNumbering(
  knex: Knex,
  tenantId: string,
  realmId: string,
  enabled: boolean
): Promise<string[]> {
  if (!realmId) {
    throw new Error('A Xero organisation is required to change invoice numbering mode.');
  }

  return knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenantId);
    const row = await db.table('tenant_settings')
      .select('settings')
      .forUpdate()
      .first();

    const current = normalize(row?.settings?.[XERO_INVOICE_NUMBERING_SETTINGS_KEY]).xeroAssignedRealms;
    const next = enabled
      ? [...new Set([...current, realmId])]
      : current.filter((realm) => realm !== realmId);

    const settings = {
      ...(row?.settings ?? {}),
      [XERO_INVOICE_NUMBERING_SETTINGS_KEY]: { xeroAssignedRealms: next }
    };

    if (row) {
      await db.table('tenant_settings').update({
        settings: JSON.stringify(settings),
        updated_at: trx.fn.now()
      });
    } else {
      await trx.table('tenant_settings')
        .insert({ tenant: tenantId, settings: JSON.stringify(settings) })
        .onConflict('tenant')
        .merge(['settings']);
    }

    return next;
  });
}
