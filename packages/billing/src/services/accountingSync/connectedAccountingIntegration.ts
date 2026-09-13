import type { Knex } from 'knex';
import { resolveDefaultRealm, getAccountingSyncSettings } from './accountingSyncSettings';

export type ConnectedAccountingAdapterType = 'quickbooks_online' | 'xero';

export interface ConnectedAccountingIntegration {
  adapterType: ConnectedAccountingAdapterType;
  /**
   * QBO realm id, or Xero connection id. Xero uses the connection id because
   * XeroClientService.create expects that value from batch.target_realm today;
   * the Xero organisation (xeroTenantId) is the API tenant header, not the
   * routing key.
   */
  targetRealm: string;
}

export interface AccountingIntegrationSelection {
  /** Force a provider when the caller knows which one it is acting for. */
  preferredAdapterType?: ConnectedAccountingAdapterType | null;
  /** Force a specific realm/connection (e.g. the one selected in the UI). */
  preferredTargetRealm?: string | null;
}

/**
 * Resolve the tenant's connected accounting integration for outbound sync.
 *
 * Selection order:
 *   1. an explicit preferred adapter type + target
 *   2. an explicit/settings-selected target realm, matched to its provider
 *   3. QBO when connected (preserves existing default behavior)
 *   4. otherwise the first connected Xero connection
 *
 * Callers that know the user's selected organisation pass it explicitly so a
 * multi-provider tenant is not silently pinned to QBO.
 */
export async function resolveConnectedAccountingIntegration(
  knex: Knex,
  tenantId: string,
  selection: AccountingIntegrationSelection = {}
): Promise<ConnectedAccountingIntegration | null> {
  const settings = await getAccountingSyncSettings(knex, tenantId).catch(() => null);

  // eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- billing→integrations is the allowed direction
  const { getStoredQboCredentialsMap } = await import('@alga-psa/integrations/lib/qbo/qboClientService');
  // eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- billing→integrations is the allowed direction
  const { getStoredXeroConnections } = await import('@alga-psa/integrations/lib/xero/xeroClientService');

  const [qboCredentials, xeroConnections, qboDefaultRealm] = await Promise.all([
    getStoredQboCredentialsMap(tenantId).catch(() => ({} as Record<string, unknown>)),
    getStoredXeroConnections(tenantId).catch(() => ({} as Record<string, unknown>)),
    resolveDefaultRealm(knex, tenantId).catch(() => null)
  ]);

  const qboRealms = new Set(Object.keys(qboCredentials));
  const xeroConnectionIds = Object.keys(xeroConnections);

  if (selection.preferredAdapterType === 'xero') {
    const connectionId =
      selection.preferredTargetRealm && xeroConnections[selection.preferredTargetRealm]
        ? selection.preferredTargetRealm
        : xeroConnectionIds[0];
    if (connectionId) {
      return { adapterType: 'xero', targetRealm: connectionId };
    }
  }

  if (selection.preferredAdapterType === 'quickbooks_online') {
    const realm =
      selection.preferredTargetRealm && qboRealms.has(selection.preferredTargetRealm)
        ? selection.preferredTargetRealm
        : qboDefaultRealm;
    if (realm) {
      return { adapterType: 'quickbooks_online', targetRealm: realm };
    }
  }

  const preferredRealm = selection.preferredTargetRealm ?? settings?.defaultRealm ?? null;
  if (preferredRealm) {
    if (qboRealms.has(preferredRealm)) {
      return { adapterType: 'quickbooks_online', targetRealm: preferredRealm };
    }
    if (xeroConnections[preferredRealm]) {
      return { adapterType: 'xero', targetRealm: preferredRealm };
    }
  }

  if (qboDefaultRealm) {
    return {
      adapterType: 'quickbooks_online',
      targetRealm: qboDefaultRealm
    };
  }

  const [connectionId] = xeroConnectionIds;
  if (!connectionId) {
    return null;
  }

  return {
    adapterType: 'xero',
    targetRealm: connectionId
  };
}
