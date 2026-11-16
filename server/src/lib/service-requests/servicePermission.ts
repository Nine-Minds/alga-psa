import { hasPermission } from '@alga-psa/auth';
import type { Knex } from 'knex';
import { createClientScopeContext } from '@alga-psa/authorization/clientScopeAuthorization';
import type { IUserWithRoles } from '@alga-psa/types';
import { MspSubmissionError } from './mspSubmissions';
import { findMissingPermission, permissionKey, type MspSubmitPermission } from './mspSubmitPermissions';

type PermissionUser = Parameters<typeof hasPermission>[0];

export class ServiceRequestPermissionError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = 'ServiceRequestPermissionError';
  }
}

/**
 * Gate for MSP submit-on-behalf surfaces: MSP users only, holding every permission in `required`
 * (see mspSubmitPermissions.ts). Deliberately no `service:*` (catalog authoring) and no new
 * `service_request:*` resource (RBAC for that is owned by another card).
 */
export async function requireMspSubmitPermissions(
  user: PermissionUser,
  required: readonly MspSubmitPermission[],
  knex?: Knex
): Promise<void> {
  if ((user as { user_type?: string }).user_type === 'client') {
    throw new ServiceRequestPermissionError('MSP user required');
  }
  const missing = await findMissingPermission((resource, action) => hasPermission(user, resource, action, knex), required);
  if (missing) {
    throw new ServiceRequestPermissionError(`Permission "${permissionKey(missing)}" required`);
  }
}

/**
 * The technician may act for a contact only if the contact is inside their existing client/contact read
 * scope (bundle narrowing rules). This adds no rule of its own: with no published narrowing it is a no-op,
 * and a contact outside the scope is reported exactly like a missing one.
 */
export async function requireContactInReadScope(
  knex: Knex,
  tenant: string,
  user: IUserWithRoles,
  contactId: string
): Promise<void> {
  const scope = await createClientScopeContext(knex, tenant, user);
  if (!(await scope.permits('contact', contactId))) {
    throw new MspSubmissionError('contact_not_found', 'Contact not found for this client');
  }
}
