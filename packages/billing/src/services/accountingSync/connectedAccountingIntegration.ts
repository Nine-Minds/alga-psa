import type { Knex } from 'knex';
import { resolveDefaultRealm } from './accountingSyncSettings';

export type ConnectedAccountingAdapterType = 'quickbooks_online' | 'xero';

export interface ConnectedAccountingIntegration {
  adapterType: ConnectedAccountingAdapterType;
  /**
   * QBO realm id, or Xero connection id. Xero uses the connection id because
   * XeroClientService.create expects that value from batch.target_realm today.
   */
  targetRealm: string;
}

/**
 * Resolve the tenant's connected accounting integration for outbound sync.
 * QBO wins when both QBO and Xero are connected, preserving existing tenant
 * behavior while allowing non-QBO tenants to be recognized.
 */
export async function resolveConnectedAccountingIntegration(
  knex: Knex,
  tenantId: string
): Promise<ConnectedAccountingIntegration | null> {
  const qboRealm = await resolveDefaultRealm(knex, tenantId);
  if (qboRealm) {
    return {
      adapterType: 'quickbooks_online',
      targetRealm: qboRealm
    };
  }

  // eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- billing→integrations is the allowed direction
  const { getStoredXeroConnections } = await import('@alga-psa/integrations/lib/xero/xeroClientService');
  const connections = await getStoredXeroConnections(tenantId).catch(() => ({}));
  const [connectionId] = Object.keys(connections);
  if (!connectionId) {
    return null;
  }

  return {
    adapterType: 'xero',
    targetRealm: connectionId
  };
}
