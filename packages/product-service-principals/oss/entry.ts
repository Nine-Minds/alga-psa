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

export function mapServicePrincipalError<T>(error: T): T {
  return error;
}
