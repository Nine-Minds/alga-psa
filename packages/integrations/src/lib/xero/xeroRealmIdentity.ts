/**
 * Pure Xero connection-identity helpers.
 *
 * The internal target is the connection id; `xeroTenantId` is the organisation
 * id Xero uses as its API tenant header. These helpers are deliberately free of
 * I/O and live in their own module (not `xeroClientService`) so every caller —
 * settings, catalogs, manual exports, sync routing and the mapping screen — can
 * share one normalization without pulling the client's transport boundary.
 */

export interface XeroConnectionIdentity {
  connectionId: string;
  xeroTenantId: string;
}

/**
 * Ordered realm ids accepted when resolving `targetRealm` against stored
 * connections: the exact target first (the canonical connection id), then the
 * organisation id it uniquely owns. A legacy target that is itself an
 * organisation id owned by exactly one connection resolves to that connection
 * id plus the organisation id. Unknown targets and organisations owned by more
 * than one connection return the exact target only — fail closed, never alias
 * another organisation.
 */
export function resolveXeroRealmAliasIds(
  connections: Record<string, XeroConnectionIdentity>,
  targetRealm: string | null | undefined
): string[] {
  if (!targetRealm) {
    return [];
  }
  const entries = Object.values(connections ?? {});
  const canonical = connections?.[targetRealm];

  if (canonical) {
    const organisation = canonical.xeroTenantId;
    if (!organisation || organisation === targetRealm) {
      return [targetRealm];
    }
    const owners = entries.filter((connection) => connection.xeroTenantId === organisation);
    return owners.length === 1 ? [targetRealm, organisation] : [targetRealm];
  }

  const owners = entries.filter((connection) => connection.xeroTenantId === targetRealm);
  if (owners.length === 1) {
    return [owners[0].connectionId, targetRealm];
  }

  return [targetRealm];
}

/**
 * Normalize a persisted selection (a connection id or a historical
 * organisation id) to the owning connection id. Returns null when the value
 * names no stored connection or an organisation owned by more than one
 * connection: ambiguous ownership is rejected, never guessed, so settings,
 * catalog, export and sync routing share one normalization.
 */
export function normalizeXeroConnectionSelection(
  connections: Record<string, XeroConnectionIdentity>,
  persistedRealm: string | null | undefined
): string | null {
  if (!persistedRealm) {
    return null;
  }
  if (connections?.[persistedRealm]) {
    return persistedRealm;
  }
  const owners = Object.values(connections ?? {}).filter(
    (connection) => connection.xeroTenantId === persistedRealm
  );
  return owners.length === 1 ? owners[0].connectionId : null;
}
