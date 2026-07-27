import { createTenantKnex, runWithTenant } from '@/lib/db';
import { tenantDb } from '@alga-psa/db';

export interface ConfirmedEntraMapping {
  managedTenantId: string;
  entraTenantId: string;
  clientId: string;
  clientName: string | null;
  displayName: string | null;
  primaryDomain: string | null;
  sourceUserCount: number;
  lastSyncedAt: string | null;
  lastRunStatus: string | null;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Confirmed tenant-to-client mappings with the client's name and how its last
 * real sync went. Preflights are excluded from "last synced": a preview did not
 * sync anything, and showing it as the last run is exactly the kind of lie this
 * overhaul exists to remove.
 */
export async function listConfirmedEntraMappings(
  tenantId: string
): Promise<ConfirmedEntraMapping[]> {
  return runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenantId);

    const query = db.table('entra_client_tenant_mappings as m')
      .where({
        'm.is_active': true,
        'm.mapping_state': 'mapped',
      })
      .select({
        managed_tenant_id: 'm.managed_tenant_id',
        client_id: 'm.client_id',
        entra_tenant_id: 't.entra_tenant_id',
        display_name: 't.display_name',
        primary_domain: 't.primary_domain',
        source_user_count: 't.source_user_count',
        client_name: 'c.client_name',
      })
      .orderByRaw('coalesce(c.client_name, t.display_name, t.entra_tenant_id) asc');

    db.tenantJoin(query, 'entra_managed_tenants as t', 'm.managed_tenant_id', 't.managed_tenant_id');
    db.tenantJoin(query, 'clients as c', 'm.client_id', 'c.client_id');

    const rows = await query;

    const lastRuns = await db.table('entra_sync_run_tenants as rt')
      .select({
        managed_tenant_id: 'rt.managed_tenant_id',
        status: 'rt.status',
        completed_at: 'rt.completed_at',
      })
      .orderBy('rt.completed_at', 'desc');

    const latestByTenant = new Map<string, { status: string | null; completedAt: string | null }>();
    for (const run of lastRuns as Array<Record<string, unknown>>) {
      const key = String(run.managed_tenant_id);
      if (latestByTenant.has(key)) {
        continue;
      }
      latestByTenant.set(key, {
        status: run.status ? String(run.status) : null,
        completedAt: toIso(run.completed_at),
      });
    }

    return (rows as Array<Record<string, unknown>>)
      .filter((row) => row.managed_tenant_id && row.client_id)
      .map((row) => {
        const latest = latestByTenant.get(String(row.managed_tenant_id));
        return {
          managedTenantId: String(row.managed_tenant_id),
          entraTenantId: String(row.entra_tenant_id || ''),
          clientId: String(row.client_id),
          clientName: row.client_name ? String(row.client_name) : null,
          displayName: row.display_name ? String(row.display_name) : null,
          primaryDomain: row.primary_domain ? String(row.primary_domain) : null,
          sourceUserCount: Number(row.source_user_count || 0),
          lastSyncedAt: latest?.completedAt || null,
          lastRunStatus: latest?.status || null,
        };
      });
  });
}
