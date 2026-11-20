// The entry is imported from shared auth and middleware modules. Keep its
// module graph inert: the EE implementation reaches auth-dependent modules,
// so load it only when a boundary operation is actually requested.
import type {
  BoundaryApiContext,
  BoundaryApiKeyRecord,
  BoundaryKeyGateOwner,
} from '../types';

export async function resolveServicePrincipalApiContext<TUser = unknown>(
  keyRecord: BoundaryApiKeyRecord,
  owner: TUser,
  req: Request,
): Promise<BoundaryApiContext<TUser> | null> {
  const boundary = await import('@ee/lib/service-principals/boundary');
  return boundary.resolveServicePrincipalApiContext(keyRecord, owner, req);
}

export async function servicePrincipalKeyGate(owner: BoundaryKeyGateOwner): Promise<boolean> {
  const boundary = await import('@ee/lib/service-principals/boundary');
  return boundary.servicePrincipalKeyGate(owner);
}

export async function stampTimeEntryAttribution(
  conn: import('knex').Knex | import('knex').Knex.Transaction,
  tenant: string,
  entryId: string,
  operation: 'create' | 'update',
  viaPrincipalUserId: string | null | undefined,
): Promise<Record<string, string | null>> {
  const attribution = await import('@ee/lib/service-principals/timeEntryAttribution');
  return attribution.stampTimeEntryAttribution(conn, tenant, entryId, operation, viaPrincipalUserId);
}

export { mapServicePrincipalError } from '@ee/lib/service-principals/errors';
export type * from '../types';
export { assertNoDelegationHeaders } from '../delegation';
