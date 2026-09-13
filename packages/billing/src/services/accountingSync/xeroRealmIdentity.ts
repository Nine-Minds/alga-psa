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
 *
 * The pure alias/normalization logic lives beside the stored connections in
 * @alga-psa/integrations so settings, catalogs, manual exports, sync routing
 * and the mapping screen all share one implementation.
 */

export type {
  XeroConnectionIdentity
} from '@alga-psa/integrations/lib/xero/xeroRealmIdentity';

// eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- billing consumes the shared Xero connection-identity helpers
import type { XeroConnectionIdentity } from '@alga-psa/integrations/lib/xero/xeroRealmIdentity';
// eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- billing consumes the shared Xero connection-identity helpers
import { resolveXeroRealmAliasIds } from '@alga-psa/integrations/lib/xero/xeroRealmIdentity';

export type XeroConnectionsById = Record<string, XeroConnectionIdentity>;

/**
 * Ordered realm ids to accept when resolving `targetRealm`. Delegates to the
 * shared integrations resolver, which fails closed for unknown targets and for
 * organisations owned by more than one connection. `connectionsOverride` is a
 * test/DI seam; production callers let it load the tenant's stored connections.
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

  return resolveXeroRealmAliasIds(connections, targetRealm);
}
