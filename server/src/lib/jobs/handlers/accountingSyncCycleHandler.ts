import logger from '@alga-psa/core/logger';
import { runWithTenant } from 'server/src/lib/db';
import { getConnection } from 'server/src/lib/db/db';
import type { BaseJobData } from '../interfaces';
import {
  runAccountingSyncCycle,
  AccountingAdapterRegistry
} from '@alga-psa/billing/services';
import { getStoredQboCredentialsMap } from '@alga-psa/integrations/lib/qbo/qboClientService';
import { getStoredXeroConnections } from '@alga-psa/integrations/lib/xero/xeroClientService';
import {
  isProviderDisconnectActive,
  PROVIDER_QBO,
  PROVIDER_XERO,
} from '@alga-psa/integrations/lib/providerDisconnect';

export interface AccountingSyncCycleJobData extends BaseJobData {
  tenantId: string;
}

function isEnterpriseEdition(): boolean {
  return (
    (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise'
  );
}

/**
 * One scheduled tick for a tenant: enumerate connected realms and run a sync
 * cycle per realm. A global Temporal schedule
 * (maintenance-fanout:accounting-sync-cycle, every 15 minutes) fans this out
 * across all tenants; a tenant with no connected realm is a cheap no-op, so
 * connect and disconnect take effect on the next tick without schedule
 * convergence.
 */
export async function accountingSyncCycleHandler(data: AccountingSyncCycleJobData): Promise<void> {
  const { tenantId } = data;

  if (!isEnterpriseEdition()) {
    return;
  }

  const knex = await getConnection(tenantId);

  // Explicit early guard (the credential tombstone is the backstop): while a
  // provider disconnect is pending, no sync cycle may start.
  const [qboBlocked, xeroBlocked] = await Promise.all([
    isProviderDisconnectActive(knex, tenantId, PROVIDER_QBO).catch(() => false),
    isProviderDisconnectActive(knex, tenantId, PROVIDER_XERO).catch(() => false),
  ]);
  if (qboBlocked || xeroBlocked) {
    logger.info('[accountingSync] Cycle skipped: provider disconnect in progress', {
      tenantId,
      qboBlocked,
      xeroBlocked,
    });
    return;
  }

  const registry = await AccountingAdapterRegistry.createDefault();

  // Scheduled cycles converge EVERY connected target across BOTH providers:
  // all QBO realms AND all Xero connections. The default resolver's single
  // selected provider is only a preference for interactive actions — a tenant
  // connected to both must not have one provider silently skipped.
  const [qboCredentials, xeroConnections] = await Promise.all([
    getStoredQboCredentialsMap(tenantId).catch(() => ({} as Record<string, any>)),
    getStoredXeroConnections(tenantId).catch(() => ({} as Record<string, any>)),
  ]);

  const targets: Array<{
    adapterType: string;
    targetRealm: string;
    refreshTokenExpiresAt: string | null;
  }> = [
    ...Object.entries(qboCredentials).map(([targetRealm, credentials]) => ({
      adapterType: 'quickbooks_online',
      targetRealm,
      refreshTokenExpiresAt: (credentials as any)?.refreshTokenExpiresAt ?? null,
    })),
    ...Object.entries(xeroConnections).map(([targetRealm, connection]) => ({
      adapterType: 'xero',
      targetRealm,
      refreshTokenExpiresAt: (connection as any)?.refreshTokenExpiresAt ?? null,
    })),
  ];

  if (targets.length === 0) {
    return;
  }

  await runWithTenant(tenantId, async () => {
    for (const target of targets) {
      const adapter = registry.get(target.adapterType);
      if (!adapter) {
        logger.warn('[accountingSync] No adapter registered for scheduled target', {
          tenantId,
          adapterType: target.adapterType,
          realm: target.targetRealm
        });
        continue;
      }
      try {
        const result = await runAccountingSyncCycle({
          knex,
          tenantId,
          adapterType: target.adapterType,
          targetRealm: target.targetRealm,
          adapter,
          refreshTokenExpiresAt: target.refreshTokenExpiresAt
        });
        if (result.ran) {
          logger.info('[accountingSync] Scheduled cycle finished', {
            tenantId,
            realm: target.targetRealm,
            status: result.status,
            stats: result.stats
          });
        }
      } catch (error) {
        logger.error('[accountingSync] Scheduled cycle crashed', {
          tenantId,
          realm: target.targetRealm,
          error: error instanceof Error ? error.message : error
        });
      }
    }
  });
}
