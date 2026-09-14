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

/** One selectable organisation/company for a provider. */
export interface AccountingConnectionOption {
  realmId: string;
  isDefault: boolean;
}

/**
 * Why a provider has no auto-resolved default. `ambiguous` means the tenant
 * does have connections but no single one can be chosen automatically (e.g. a
 * saved Xero organisation owned by more than one connection) — callers must
 * require a deliberate selection instead of guessing. `none_connected` means
 * the provider has no stored connection at all.
 */
export type AccountingConnectionIssue = 'ambiguous' | 'none_connected' | null;

/**
 * The connection choices for one provider, suitable for an export picker.
 *
 * This is deliberately narrower than `getAccountingSyncHealth`: it returns only
 * the connected organisations and the resolved default, never settings, cycle
 * history, operation counts or exception data. Export operators hold
 * `exports_execute` but not necessarily `catalog_read`, so the export surface
 * must not read the broader health payload just to render its picker.
 */
export interface AccountingConnectionsView {
  adapterType: ConnectedAccountingAdapterType;
  /** True when a usable default target exists for this provider. */
  connected: boolean;
  realms: AccountingConnectionOption[];
  organisationName: string | null;
  issue: AccountingConnectionIssue;
}

/**
 * The already-loaded facts the selection rules operate on. Kept separate from
 * the I/O so the same rules can be applied to tolerant or strict reads without
 * a second, divergent implementation.
 */
export interface AccountingSelectionSnapshot {
  qboRealms: string[];
  xeroConnectionIds: string[];
  persistedXeroConnectionId: string | null;
  xeroSelectionAmbiguous: boolean;
  settingsDefaultRealm: string | null;
  qboDefaultRealm: string | null;
}

type XeroConnectionIdentity = {
  connectionId: string;
  xeroTenantId: string;
  tenantName?: string | null;
};

/**
 * Pure provider-selection rules. Shared by sync routing and the export picker
 * so they can never disagree.
 *
 * Selection order:
 *   1. an explicit preferred adapter type + target
 *   2. an explicit/settings-selected target realm, matched to its provider
 *   3. QBO when connected (preserves existing default behavior)
 *   4. otherwise the first connected Xero connection
 */
export function selectConnectedAccountingIntegration(
  snapshot: AccountingSelectionSnapshot,
  selection: AccountingIntegrationSelection = {}
): ConnectedAccountingIntegration | null {
  const qboRealms = new Set(snapshot.qboRealms);
  const xeroConnectionIds = new Set(snapshot.xeroConnectionIds);
  const { persistedXeroConnectionId, xeroSelectionAmbiguous, settingsDefaultRealm, qboDefaultRealm } =
    snapshot;

  // Explicit provider request. An explicit ORGANISATION that is no longer
  // connected fails closed: it must never silently resolve to a different
  // provider or organisation.
  if (selection.preferredAdapterType === 'xero') {
    if (selection.preferredTargetRealm) {
      return xeroConnectionIds.has(selection.preferredTargetRealm)
        ? { adapterType: 'xero', targetRealm: selection.preferredTargetRealm }
        : null;
    }
    if (xeroSelectionAmbiguous) {
      return null;
    }
    const connectionId = persistedXeroConnectionId ?? snapshot.xeroConnectionIds[0];
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
    if (xeroConnectionIds.has(selection.preferredTargetRealm)) {
      return { adapterType: 'xero', targetRealm: selection.preferredTargetRealm };
    }
    return null;
  }

  // Settings-selected default organisation. A QBO realm id is matched
  // verbatim; a Xero selection is normalized by the caller. An ambiguous Xero
  // selection fails closed so routing never falls through to QBO or another
  // connection; an absent/unknown value keeps the existing best-effort
  // fallback to a connected target.
  if (settingsDefaultRealm) {
    if (qboRealms.has(settingsDefaultRealm)) {
      return { adapterType: 'quickbooks_online', targetRealm: settingsDefaultRealm };
    }
    if (xeroSelectionAmbiguous) {
      return null;
    }
    if (persistedXeroConnectionId) {
      return { adapterType: 'xero', targetRealm: persistedXeroConnectionId };
    }
  }

  if (qboDefaultRealm) {
    return { adapterType: 'quickbooks_online', targetRealm: qboDefaultRealm };
  }

  const [connectionId] = snapshot.xeroConnectionIds;
  if (!connectionId) {
    return null;
  }

  return { adapterType: 'xero', targetRealm: connectionId };
}

/**
 * Resolve the tenant's connected accounting integration for outbound sync.
 *
 * Selection order matches {@link selectConnectedAccountingIntegration}. Credential
 * store failures are tolerated here (best-effort sync routing); the dedicated
 * export picker uses a strict read instead.
 */
export async function resolveConnectedAccountingIntegration(
  knex: Knex,
  tenantId: string,
  selection: AccountingIntegrationSelection = {}
): Promise<ConnectedAccountingIntegration | null> {
  const snapshot = await loadTolerantSelectionSnapshot(knex, tenantId);
  return selectConnectedAccountingIntegration(snapshot, selection);
}

async function loadTolerantSelectionSnapshot(
  knex: Knex,
  tenantId: string
): Promise<AccountingSelectionSnapshot> {
  const settings = await getAccountingSyncSettings(knex, tenantId).catch(() => null);

  const { getStoredQboCredentialsMap } = await import('@alga-psa/integrations/lib/qbo/qboClientService');
  const { getStoredXeroConnections } = await import('@alga-psa/integrations/lib/xero/xeroClientService');
  const { resolveXeroDefaultSelection } = await import('@alga-psa/integrations/lib/xero/xeroRealmIdentity');

  const [qboCredentials, xeroConnections, qboDefaultRealm] = await Promise.all([
    getStoredQboCredentialsMap(tenantId).catch(() => ({} as Record<string, unknown>)),
    getStoredXeroConnections(tenantId).catch(() => ({} as Record<string, unknown>)),
    resolveDefaultRealm(knex, tenantId).catch(() => null)
  ]);

  const xeroSelection = resolveXeroDefaultSelection(
    xeroConnections as Record<string, XeroConnectionIdentity>,
    settings?.defaultRealm ?? null
  );

  return {
    qboRealms: Object.keys(qboCredentials),
    xeroConnectionIds: Object.keys(xeroConnections),
    persistedXeroConnectionId:
      xeroSelection.status === 'resolved' ? xeroSelection.connectionId : null,
    xeroSelectionAmbiguous: xeroSelection.status === 'ambiguous',
    settingsDefaultRealm: settings?.defaultRealm ?? null,
    qboDefaultRealm
  };
}

/**
 * Resolve the export picker options for one provider without loading the
 * broader health payload.
 *
 * The selected provider's own connection store is read strictly so a
 * credential-store outage propagates to the caller (the dialog then shows an
 * actionable error with Retry) instead of being flattened into an empty list.
 * The options AND the resolved default come from that same snapshot, so they
 * can never disagree. The canonical shared selection is still consulted and
 * honored when its target is present in the strict snapshot; otherwise the
 * default is re-derived from the strict snapshot with the same shared rules.
 * When no default can be resolved the target is left unset and `issue`
 * explains why.
 */
export async function resolveAccountingConnections(
  knex: Knex,
  tenantId: string,
  adapterType: ConnectedAccountingAdapterType
): Promise<AccountingConnectionsView> {
  const settings = await getAccountingSyncSettings(knex, tenantId).catch(() => null);

  // Canonical selection, using the same rules as sync routing. Tolerant so the
  // shared routing behavior is unchanged; the strict provider read below is
  // authoritative for the picker.
  const canonical = await resolveConnectedAccountingIntegration(knex, tenantId, {
    preferredAdapterType: adapterType
  });
  const canonicalRealm =
    canonical && canonical.adapterType === adapterType ? canonical.targetRealm : null;

  const { getStoredQboCredentialsMap } = await import('@alga-psa/integrations/lib/qbo/qboClientService');
  const { getStoredXeroConnections } = await import('@alga-psa/integrations/lib/xero/xeroClientService');
  const { resolveXeroDefaultSelection } = await import('@alga-psa/integrations/lib/xero/xeroRealmIdentity');

  if (adapterType === 'xero') {
    const connections = (await getStoredXeroConnections(tenantId)) as Record<
      string,
      XeroConnectionIdentity
    >;
    const xeroSelection = resolveXeroDefaultSelection(connections, settings?.defaultRealm ?? null);
    const connectionIds = Object.keys(connections);
    const resolved =
      canonicalRealm && connections[canonicalRealm]
        ? { adapterType, targetRealm: canonicalRealm }
        : selectConnectedAccountingIntegration(
            {
              qboRealms: [],
              xeroConnectionIds: connectionIds,
              persistedXeroConnectionId:
                xeroSelection.status === 'resolved' ? xeroSelection.connectionId : null,
              xeroSelectionAmbiguous: xeroSelection.status === 'ambiguous',
              settingsDefaultRealm: settings?.defaultRealm ?? null,
              qboDefaultRealm: null
            },
            { preferredAdapterType: adapterType }
          );

    const realms = connectionIds.map((realmId) => ({
      realmId,
      isDefault: resolved?.targetRealm === realmId
    }));
    const selectedConnection = resolved ? connections[resolved.targetRealm] : undefined;

    return {
      adapterType,
      connected: Boolean(resolved),
      realms,
      organisationName:
        typeof selectedConnection?.tenantName === 'string' ? selectedConnection.tenantName : null,
      issue: resolved ? null : realms.length > 0 ? 'ambiguous' : 'none_connected'
    };
  }

  const credentials = (await getStoredQboCredentialsMap(tenantId)) as Record<string, unknown>;
  const realmIds = Object.keys(credentials);
  // Mirror resolveDefaultRealm: the saved realm wins when it is connected,
  // otherwise the first stored company. Derived from the strict snapshot so it
  // can never disagree with the options below.
  const qboDefaultRealm =
    settings?.defaultRealm && realmIds.includes(settings.defaultRealm)
      ? settings.defaultRealm
      : realmIds[0] ?? null;
  const resolved =
    canonicalRealm && realmIds.includes(canonicalRealm)
      ? { adapterType, targetRealm: canonicalRealm }
      : selectConnectedAccountingIntegration(
          {
            qboRealms: realmIds,
            xeroConnectionIds: [],
            persistedXeroConnectionId: null,
            xeroSelectionAmbiguous: false,
            settingsDefaultRealm: settings?.defaultRealm ?? null,
            qboDefaultRealm
          },
          { preferredAdapterType: adapterType }
        );

  const realms = realmIds.map((realmId) => ({
    realmId,
    isDefault: resolved?.targetRealm === realmId
  }));

  return {
    adapterType,
    connected: Boolean(resolved),
    realms,
    organisationName: resolved?.targetRealm ?? null,
    issue: resolved ? null : realms.length > 0 ? 'ambiguous' : 'none_connected'
  };
}
