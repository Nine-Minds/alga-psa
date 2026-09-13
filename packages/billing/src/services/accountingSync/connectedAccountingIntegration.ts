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

  // Explicit provider request. An explicit ORGANISATION that is no longer
  // connected fails closed: it must never silently resolve to a different
  // provider or organisation.
  if (selection.preferredAdapterType === 'xero') {
    if (selection.preferredTargetRealm) {
      return xeroConnections[selection.preferredTargetRealm]
        ? { adapterType: 'xero', targetRealm: selection.preferredTargetRealm }
        : null;
    }
    const connectionId = xeroConnectionIds[0];
    return connectionId ? { adapterType: 'xero', targetRealm: connectionId } : null;
  }

  if (selection.preferredAdapterType === 'quickbooks_online') {
    if (selection.preferredTargetRealm) {
      return qboRealms.has(selection.preferredTargetRealm)
        ? { adapterType: 'quickbooks_online', targetRealm: selection.preferredTargetRealm }
        : null;
    }
    return qboDefaultRealm ? { adapterType: 'quickbooks_online', targetRealm: qboDefaultRealm } : null;
  }

  // Explicit organisation request without a provider: match it to the owning
  // provider, or fail closed if it is gone.
  if (selection.preferredTargetRealm) {
    if (qboRealms.has(selection.preferredTargetRealm)) {
      return { adapterType: 'quickbooks_online', targetRealm: selection.preferredTargetRealm };
    }
    if (xeroConnections[selection.preferredTargetRealm]) {
      return { adapterType: 'xero', targetRealm: selection.preferredTargetRealm };
    }
    return null;
  }

  // Settings-selected default organisation (best effort: a removed default
  // falls back to another connected target).
  const settingsRealm = settings?.defaultRealm ?? null;
  if (settingsRealm) {
    if (qboRealms.has(settingsRealm)) {
      return { adapterType: 'quickbooks_online', targetRealm: settingsRealm };
    }
    if (xeroConnections[settingsRealm]) {
      return { adapterType: 'xero', targetRealm: settingsRealm };
    }
  }

  if (qboDefaultRealm) {
    return { adapterType: 'quickbooks_online', targetRealm: qboDefaultRealm };
  }

  const [connectionId] = xeroConnectionIds;
  if (!connectionId) {
    return null;
  }

  return { adapterType: 'xero', targetRealm: connectionId };
}
