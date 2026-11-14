/* eslint-disable custom-rules/no-feature-to-feature-imports -- provider resolution consults stored QBO/Xero connection state (same bridge as the adapters) */
import type { Knex } from 'knex';
import type { AccountingExportAdapter } from '@alga-psa/types';
import { getStoredQboCredentialsMap } from '@alga-psa/integrations/lib/qbo/qboClientService';
import { getStoredXeroConnections } from '@alga-psa/integrations/lib/xero/xeroClientService';
import {
  getDisconnectRecord,
  isProviderDisconnectActive,
  PROVIDER_TYPES,
  type ProviderType
} from '@alga-psa/integrations/lib/providerDisconnect';
import { AccountingAdapterRegistry } from '../../adapters/accounting/registry';
import {
  resolveConnectedAccountingIntegration,
  type AccountingIntegrationSelection,
  type ConnectedAccountingIntegration
} from './connectedAccountingIntegration';

export interface ResolvedSyncTarget {
  integration: ConnectedAccountingIntegration;
  adapter: AccountingExportAdapter;
  refreshTokenExpiresAt: string | null;
  /**
   * The Intuit environment stamped on this QBO connection when it was
   * authorized, or null for a connection predating the stamp (and always for
   * Xero). Callers that need a decision fall back to the tenant setting, then
   * the deployment default. Carried here because resolving the target already
   * reads the stored credentials.
   */
  qboEnvironment: 'sandbox' | 'production' | null;
}

/**
 * Resolve the tenant's connected accounting provider + organisation/connection
 * and the matching adapter for an outbound action. This is the single place
 * Sync Now, queueing, drift resolution and health/status lookups select a
 * provider — no shared path may assume QuickBooks. Callers pass a selection
 * when the user has chosen a specific organisation.
 */
export async function resolveSyncTarget(
  knex: Knex,
  tenantId: string,
  selection: AccountingIntegrationSelection = {}
): Promise<ResolvedSyncTarget | null> {
  const integration = await resolveConnectedAccountingIntegration(knex, tenantId, selection);
  if (!integration) {
    return null;
  }

  const registry = await AccountingAdapterRegistry.createDefault();
  const adapter = registry.get(integration.adapterType);
  if (!adapter) {
    return null;
  }

  let refreshTokenExpiresAt: string | null = null;
  let qboEnvironment: 'sandbox' | 'production' | null = null;
  if (integration.adapterType === 'quickbooks_online') {
    const credentials = await getStoredQboCredentialsMap(tenantId).catch(() => ({} as Record<string, any>));
    refreshTokenExpiresAt = credentials[integration.targetRealm]?.refreshTokenExpiresAt ?? null;
    qboEnvironment = credentials[integration.targetRealm]?.environment ?? null;
  } else {
    const connections = await getStoredXeroConnections(tenantId).catch(() => ({} as Record<string, any>));
    refreshTokenExpiresAt = connections[integration.targetRealm]?.refreshTokenExpiresAt ?? null;
  }

  return { integration, adapter, refreshTokenExpiresAt, qboEnvironment };
}

export type GuardedSyncTargetResolution =
  | { status: 'ready'; target: ResolvedSyncTarget }
  | { status: 'blocked'; provider: ProviderType }
  | { status: 'unavailable' };

const isBlocked = (knex: Knex, tenantId: string, provider: ProviderType): Promise<boolean> =>
  isProviderDisconnectActive(knex, tenantId, provider).catch(() => false);

/**
 * Work out which provider the caller is acting for, BEFORE any disconnect guard
 * is applied. Order: explicit provider; the provider the ordinary resolution
 * picks; for an explicit organisation whose credentials are tombstoned (so
 * ordinary resolution finds nothing), the provider whose disconnect record
 * lists that organisation. Never switches provider or organisation.
 */
async function resolveIntendedProvider(
  knex: Knex,
  tenantId: string,
  selection: AccountingIntegrationSelection
): Promise<ProviderType | null> {
  if (selection.preferredAdapterType) {
    return selection.preferredAdapterType;
  }
  const integration = await resolveConnectedAccountingIntegration(knex, tenantId, selection);
  if (integration) {
    return integration.adapterType;
  }
  if (selection.preferredTargetRealm) {
    for (const provider of PROVIDER_TYPES) {
      const record = await getDisconnectRecord(knex, tenantId, provider).catch(() => null);
      if (record?.targets.some((entry) => entry.targetId === selection.preferredTargetRealm)) {
        return provider;
      }
    }
  }
  return null;
}

/**
 * Provider-scoped counterpart of {@link resolveSyncTarget} for mutating
 * actions. A non-finalized disconnect blocks only the intended provider; the
 * blocked result names that provider so callers can give an actionable error
 * even when its tombstoned credentials make ordinary resolution return null.
 */
export async function resolveGuardedSyncTarget(
  knex: Knex,
  tenantId: string,
  selection: AccountingIntegrationSelection = {}
): Promise<GuardedSyncTargetResolution> {
  const intended = await resolveIntendedProvider(knex, tenantId, selection);
  if (intended) {
    if (await isBlocked(knex, tenantId, intended)) {
      return { status: 'blocked', provider: intended };
    }
  } else if (!selection.preferredTargetRealm) {
    // Nothing connected and no explicit organisation: if a provider's
    // disconnect explains why, report it rather than "not connected".
    for (const provider of PROVIDER_TYPES) {
      if (await isBlocked(knex, tenantId, provider)) {
        return { status: 'blocked', provider };
      }
    }
  }

  const target = await resolveSyncTarget(knex, tenantId, selection);
  return target ? { status: 'ready', target } : { status: 'unavailable' };
}
