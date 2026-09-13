/**
 * Canonical Xero mapping identity.
 *
 * The internal target is the Xero connection id: outbound export, the mapping
 * ledger and inbound reconciliation all address `external_realm_id` with it.
 * PostgreSQL stores the organisation id (`xeroTenantId`) as the API tenant
 * header. Mappings created before this identity was unified persist the
 * organisation id, so resolution must accept it as a historical alias — but
 * only when the organisation is verifiably owned by the requested connection
 * inside the same tenant. Ambiguous or foreign ownership aliases nothing, so a
 * lookup can never cross an organisation or tenant boundary.
 */

export interface XeroConnectionIdentity {
  connectionId: string;
  xeroTenantId: string;
}

export type XeroConnectionsById = Record<string, XeroConnectionIdentity>;

/**
 * Ordered realm ids to accept when resolving `targetRealm`:
 *   - the exact target first (the canonical connection id),
 *   - then the organisation id it uniquely owns, when targetRealm is a known
 *     connection key,
 *   - or, when targetRealm is itself an organisation id owned by exactly one
 *     connection (a legacy caller), that connection id and the organisation id.
 *
 * Unknown targets and organisations owned by more than one connection return
 * the exact target only: fail closed rather than guess.
 */
export async function resolveXeroRealmAliases(
  tenantId: string,
  targetRealm: string | null | undefined,
  connectionsOverride?: XeroConnectionsById
): Promise<string[]> {
  if (!targetRealm) {
    return [];
  }

  let connections: XeroConnectionsById;
  if (connectionsOverride !== undefined) {
    connections = connectionsOverride;
  } else {
    try {
      const mod = await import('@alga-psa/integrations/lib/xero/xeroClientService');
      const load = (mod as {
        getStoredXeroConnections?: (tenant: string) => Promise<XeroConnectionsById>;
      }).getStoredXeroConnections;
      connections = load ? await load(tenantId) : {};
    } catch {
      connections = {};
    }
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
