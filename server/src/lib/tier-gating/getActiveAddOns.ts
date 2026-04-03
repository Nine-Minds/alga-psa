import { ADD_ONS, type AddOnKey } from '@alga-psa/types';
import { createTenantKnex } from 'server/src/lib/db';

interface TenantAddOnRow {
  addon_key: string;
  expires_at: string | Date | null;
}

const VALID_ADD_ONS = new Set<string>(Object.values(ADD_ONS));

/**
 * Returns the currently active add-ons for a tenant.
 * Expired rows are filtered out in memory to keep the query easy to reuse in tests.
 */
export async function getActiveAddOns(tenantId?: string): Promise<AddOnKey[]> {
  const { knex, tenant } = await createTenantKnex(tenantId);
  const effectiveTenantId = tenantId ?? tenant;

  if (!effectiveTenantId) {
    return [];
  }

  try {
    const rows = await knex('tenant_addons')
      .select('addon_key', 'expires_at')
      .where({ tenant: effectiveTenantId }) as TenantAddOnRow[];

    const now = Date.now();

    return rows
      .filter((row) => {
        if (!row.expires_at) {
          return true;
        }

        return new Date(row.expires_at).getTime() > now;
      })
      .map((row) => row.addon_key)
      .filter((addOn): addOn is AddOnKey => VALID_ADD_ONS.has(addOn));
  } catch {
    // CE or early environments may not have tenant_addons yet.
    return [];
  }
}
