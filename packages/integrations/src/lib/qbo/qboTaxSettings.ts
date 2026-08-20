import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Per-realm QuickBooks Automated Sales Tax (AST) mode.
 *
 * Stored under tenant_settings.settings.qboAutomatedSalesTax as
 * `{ realms: string[] }` — the list of QBO realm IDs whose company files use
 * Intuit's Automated Sales Tax. No dedicated table; the key is a sibling of
 * the billing-owned `accountingSync` subtree so neither side's normalization
 * can drop the other's data.
 *
 * When a realm is in this list:
 * - The exporter keeps line-level TaxCodeRefs in tax-delegated exports
 *   (mapped value, else TAX/NON) so AST actually taxes the lines.
 * - The tax-code mapping dialog offers the TAX/NON pseudo codes.
 *
 * When a realm is not listed, behavior is identical to before AST mode existed.
 */

const QBO_AST_SETTINGS_KEY = 'qboAutomatedSalesTax';

interface QboAutomatedSalesTaxSettings {
  realms: string[];
}

function normalize(raw: unknown): QboAutomatedSalesTaxSettings {
  if (!raw || typeof raw !== 'object') {
    return { realms: [] };
  }
  const realms = (raw as Record<string, unknown>).realms;
  if (!Array.isArray(realms)) {
    return { realms: [] };
  }
  return {
    realms: realms.filter((realm): realm is string => typeof realm === 'string' && realm.length > 0)
  };
}

export async function getQboAutomatedSalesTaxRealms(
  knexOrTrx: Knex | Knex.Transaction,
  tenantId: string
): Promise<string[]> {
  const row = await tenantDb(knexOrTrx, tenantId).table('tenant_settings')
    .select('settings')
    .first();

  // settings is jsonb; knex/pg hands it back already parsed.
  return normalize(row?.settings?.[QBO_AST_SETTINGS_KEY]).realms;
}

export async function isQboAutomatedSalesTaxEnabled(
  knexOrTrx: Knex | Knex.Transaction,
  tenantId: string,
  realmId: string | null | undefined
): Promise<boolean> {
  if (!realmId) {
    return false;
  }
  const realms = await getQboAutomatedSalesTaxRealms(knexOrTrx, tenantId);
  return realms.includes(realmId);
}

/**
 * Adds or removes a realm from the AST list.
 *
 * The whole `settings` blob is rewritten, so the read and the write run in one
 * transaction with the row locked FOR UPDATE. Without the lock a concurrent
 * writer to a sibling key — `accountingSync`, `clientPortal`, the onboarding
 * subtree — would read the same pre-image and clobber whichever write landed
 * first.
 */
export async function setQboAutomatedSalesTaxEnabled(
  knex: Knex,
  tenantId: string,
  realmId: string,
  enabled: boolean
): Promise<string[]> {
  if (!realmId) {
    throw new Error('A QuickBooks realm ID is required to change Automated Sales Tax mode.');
  }

  return knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenantId);
    const row = await db.table('tenant_settings')
      .select('settings')
      .forUpdate()
      .first();

    const current = normalize(row?.settings?.[QBO_AST_SETTINGS_KEY]).realms;
    const next = enabled
      ? [...new Set([...current, realmId])]
      : current.filter((realm) => realm !== realmId);

    const settings = {
      ...(row?.settings ?? {}),
      [QBO_AST_SETTINGS_KEY]: { realms: next }
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

    return next;
  });
}
