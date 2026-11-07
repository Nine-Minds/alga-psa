// CE stub for the service-principal boundary. Every hook is inert: no owner
// other than an internal user ever yields an API context, and no error is
// rewritten. The Enterprise implementation is bound through the build alias
// for '@product/service-principals/entry'.
import type {
  BoundaryApiContext,
  BoundaryApiKeyRecord,
  BoundaryKeyGateOwner,
} from '../types';

export type * from '../types';
export { assertNoDelegationHeaders } from '../delegation';

export async function resolveServicePrincipalApiContext<TUser = unknown>(
  _keyRecord: BoundaryApiKeyRecord,
  _owner: TUser,
  _req: Request,
): Promise<BoundaryApiContext<TUser> | null> {
  return null;
}

/** Resolves true only when the owner (neither internal nor client) may authenticate a key. */
export async function servicePrincipalKeyGate(_owner: BoundaryKeyGateOwner): Promise<boolean> {
  return false;
}

/** CE has no principal attribution columns, so time-entry writes remain schema-compatible. */
export async function stampTimeEntryAttribution(
  _conn: unknown,
  _tenant: string,
  _entryId: string,
  _operation: 'create' | 'update',
  _viaPrincipalUserId: string | null | undefined,
): Promise<Record<string, string | null>> {
  return {};
}

export function mapServicePrincipalError<T>(error: T): T {
  return error;
}
