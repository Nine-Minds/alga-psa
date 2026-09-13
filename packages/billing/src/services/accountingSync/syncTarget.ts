/* eslint-disable custom-rules/no-feature-to-feature-imports -- provider resolution consults stored QBO/Xero connection state (same bridge as the adapters) */
import type { Knex } from 'knex';
import type { AccountingExportAdapter } from '@alga-psa/types';
import { getStoredQboCredentialsMap } from '@alga-psa/integrations/lib/qbo/qboClientService';
import { getStoredXeroConnections } from '@alga-psa/integrations/lib/xero/xeroClientService';
import { AccountingAdapterRegistry } from '../../adapters/accounting/registry';
import {
  resolveConnectedAccountingIntegration,
  type ConnectedAccountingIntegration
} from './connectedAccountingIntegration';

export interface ResolvedSyncTarget {
  integration: ConnectedAccountingIntegration;
  adapter: AccountingExportAdapter;
  refreshTokenExpiresAt: string | null;
}

/**
 * Resolve the tenant's connected accounting provider + organisation/connection
 * and the matching adapter for an outbound action. This is the single place
 * Sync Now, queueing, drift resolution and health/status lookups select a
 * provider — no shared path may assume QuickBooks.
 */
export async function resolveSyncTarget(
  knex: Knex,
  tenantId: string
): Promise<ResolvedSyncTarget | null> {
  const integration = await resolveConnectedAccountingIntegration(knex, tenantId);
  if (!integration) {
    return null;
  }

  const registry = await AccountingAdapterRegistry.createDefault();
  const adapter = registry.get(integration.adapterType);
  if (!adapter) {
    return null;
  }

  let refreshTokenExpiresAt: string | null = null;
  if (integration.adapterType === 'quickbooks_online') {
    const credentials = await getStoredQboCredentialsMap(tenantId).catch(() => ({} as Record<string, any>));
    refreshTokenExpiresAt = credentials[integration.targetRealm]?.refreshTokenExpiresAt ?? null;
  } else {
    const connections = await getStoredXeroConnections(tenantId).catch(() => ({} as Record<string, any>));
    refreshTokenExpiresAt = connections[integration.targetRealm]?.refreshTokenExpiresAt ?? null;
  }

  return { integration, adapter, refreshTokenExpiresAt };
}
