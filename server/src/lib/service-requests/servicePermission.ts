import { hasPermission } from '@alga-psa/auth';
import type { Knex } from 'knex';

type PermissionUser = Parameters<typeof hasPermission>[0];

export class ServiceRequestPermissionError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = 'ServiceRequestPermissionError';
  }
}

// LEVERAGE: pattern service-request-permission-gate — app/msp/service-requests/actions.ts has a private copy of this gate (MSP-only + `service:<action>`); one shared helper would serve both.
/**
 * Gate for MSP service-request surfaces: MSP users only, holding the existing
 * `service` resource permission. Deliberately no `service_request:*` resource
 * (RBAC for that is owned by another card) and no client-scoped rule.
 */
export async function requireServiceRequestPermission(
  user: PermissionUser,
  action: 'create' | 'read' | 'update' | 'delete',
  knex?: Knex
): Promise<void> {
  if ((user as { user_type?: string }).user_type === 'client') {
    throw new ServiceRequestPermissionError('MSP user required');
  }
  const allowed = await hasPermission(user, 'service', action, knex);
  if (!allowed) {
    throw new ServiceRequestPermissionError(`Service permission "${action}" required`);
  }
}
