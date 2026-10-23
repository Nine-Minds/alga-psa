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
  const selection = resolveXeroDefaultSelection(connections, persistedRealm);
  return selection.status === 'resolved' ? selection.connectionId : null;
}

/**
 * The full outcome of resolving a persisted default. It distinguishes an
 * absent default (no selection was ever made) from an ambiguous one (the
 * organisation is owned by more than one connection, so no single connection
 * can be chosen) and from a stale/unknown value (e.g. a QBO realm id read by
 * the Xero surface).
 */
export type XeroDefaultSelection =
  | { status: 'resolved'; connectionId: string }
  | { status: 'absent' }
  | { status: 'ambiguous'; organisationId: string }
  | { status: 'unknown'; persistedRealm: string };

/**
 * Resolve a persisted selection without I/O. Ambiguity is its own state so
 * callers can fail closed with an actionable message instead of silently
 * falling back to another connection.
 */
export function resolveXeroDefaultSelection(
  connections: Record<string, XeroConnectionIdentity>,
  persistedRealm: string | null | undefined
): XeroDefaultSelection {
  if (!persistedRealm) {
    return { status: 'absent' };
  }
  if (connections?.[persistedRealm]) {
    return { status: 'resolved', connectionId: persistedRealm };
  }
  const owners = Object.values(connections ?? {}).filter(
    (connection) => connection.xeroTenantId === persistedRealm
  );
  if (owners.length === 1) {
    return { status: 'resolved', connectionId: owners[0].connectionId };
  }
  if (owners.length > 1) {
    return { status: 'ambiguous', organisationId: persistedRealm };
  }
  return { status: 'unknown', persistedRealm };
}
