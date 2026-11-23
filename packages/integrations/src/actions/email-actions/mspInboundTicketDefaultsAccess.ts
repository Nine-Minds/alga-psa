/**
 * Shared authorization guard for inbound ticket defaults actions.
 * Client-portal users are always rejected; MSP users need ticket-settings
 * read access for reads and update access for mutations.
 */

import type { Knex } from 'knex';
import { hasPermission } from '@alga-psa/auth/rbac';
import { isClientUser } from './mspOutboundEmailAccess';

type GuardUser = Parameters<typeof hasPermission>[0];

export type InboundTicketDefaultsAdminCheck =
  | { allowed: true; reason?: undefined; message?: undefined }
  | { allowed: false; reason: 'client_user' | 'missing_permission'; message: string };

export async function requireInboundTicketDefaultsAdmin(
  user: GuardUser,
  knex: Knex,
  mode: 'read' | 'write'
): Promise<InboundTicketDefaultsAdminCheck> {
  if (isClientUser(user)) {
    return { allowed: false, reason: 'client_user', message: 'Permission denied' };
  }

  const action = mode === 'read' ? 'read' : 'update';
  if (!await hasPermission(user, 'ticket_settings', action, knex)) {
    return {
      allowed: false,
      reason: 'missing_permission',
      message: 'Permission denied',
    };
  }

  return { allowed: true };
}
