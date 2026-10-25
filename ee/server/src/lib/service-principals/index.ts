// Placeholder for the Enterprise service-principal module. It is intentionally
// inert (same behavior as the CE stub in packages/product-service-principals/oss)
// so the EE build compiles until the real implementation replaces it.
import type {
  BoundaryApiContext,
  BoundaryApiKeyRecord,
  BoundaryKeyGateOwner,
} from '../../../../../packages/product-service-principals/types';

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
