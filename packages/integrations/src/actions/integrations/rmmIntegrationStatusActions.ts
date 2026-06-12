'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex } from '@alga-psa/db';
import type { RmmProvider } from '@alga-psa/types';

export interface RmmIntegrationStatus {
  provider: RmmProvider;
  isActive: boolean;
  syncStatus: string | null;
  syncError: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  deviceCount: number;
}

export const getRmmIntegrationStatuses = withAuth(async (user, { tenant }): Promise<{
  success: boolean;
  error?: string;
  statuses?: Record<string, RmmIntegrationStatus>;
}> => {
  const permitted = await hasPermission(user as any, 'system_settings', 'read');
  if (!permitted) return { success: false, error: 'Forbidden' };

  try {
    const { knex } = await createTenantKnex();
    const [integrations, deviceCounts] = await Promise.all([
      knex('rmm_integrations')
        .where({ tenant })
        .select(['provider', 'is_active', 'sync_status', 'sync_error', 'connected_at', 'last_sync_at']),
      knex('assets')
        .where({ tenant })
        .whereNotNull('rmm_provider')
        .select('rmm_provider')
        .count({ count: 'asset_id' })
        .groupBy('rmm_provider') as Promise<Array<{ rmm_provider: string; count: string | number }>>,
    ]);

    const countsByProvider = new Map(deviceCounts.map((row) => [row.rmm_provider, Number(row.count)]));

    const statuses: Record<string, RmmIntegrationStatus> = {};
    for (const row of integrations) {
      statuses[row.provider] = {
        provider: row.provider,
        isActive: Boolean(row.is_active),
        syncStatus: row.sync_status ?? null,
        syncError: row.sync_error ?? null,
        connectedAt: row.connected_at ? new Date(row.connected_at).toISOString() : null,
        lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at).toISOString() : null,
        deviceCount: countsByProvider.get(row.provider) ?? 0,
      };
    }

    return { success: true, statuses };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
