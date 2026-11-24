/**
 * Shared authorization guard for actions that change or exercise the tenant's
 * outbound email transport (settings writes, test sends, diagnostics, and OAuth
 * credential exchange).
 */

import type { Knex } from 'knex';
import { hasPermission } from '@alga-psa/auth/rbac';

type GuardUser = Parameters<typeof hasPermission>[0];

export type OutboundEmailAdminCheck =
  | { allowed: true; reason?: undefined; message?: undefined }
  | { allowed: false; reason: 'client_user' | 'missing_permission'; message: string };

export function isClientUser(user: GuardUser): boolean {
  return (user as any)?.user_type === 'client';
}

export async function requireOutboundEmailAdmin(
  user: GuardUser,
  knex: Knex
): Promise<OutboundEmailAdminCheck> {
  if (isClientUser(user)) {
    return { allowed: false, reason: 'client_user', message: 'Permission denied' };
  }
  if (!await hasPermission(user, 'ticket_settings', 'update', knex)) {
    return {
      allowed: false,
      reason: 'missing_permission',
      message: 'Permission denied: Cannot manage outbound email',
    };
  }
  return { allowed: true };
}

export async function requireOutboundEmailReader(
  user: GuardUser,
  knex: Knex
): Promise<OutboundEmailAdminCheck> {
  if (isClientUser(user)) {
    return { allowed: false, reason: 'client_user', message: 'Permission denied' };
  }
  if (!await hasPermission(user, 'ticket_settings', 'read', knex)) {
    return {
      allowed: false,
      reason: 'missing_permission',
      message: 'Permission denied: Cannot view email providers',
    };
  }
  return { allowed: true };
}
