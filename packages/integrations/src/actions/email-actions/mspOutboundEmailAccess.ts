/**
 * Shared authorization guard for actions that change or exercise the tenant's
 * outbound email transport (settings writes, test sends, diagnostics).
 *
 * Client-portal users are rejected before any permission lookup, and the
 * caller must hold `ticket_settings:update` (MSP-only in the permission
 * catalog). A dedicated `email_provider:*` permission is a follow-up.
 */

import type { Knex } from 'knex';
import { hasPermission } from '@alga-psa/auth/rbac';

type GuardUser = Parameters<typeof hasPermission>[0];

// The allowed branch declares `reason`/`message` as undefined so callers can
// read `access.message` after `!access.allowed` even in projects compiled
// without strictNullChecks (e.g. ee/server), where boolean-literal narrowing
// does not apply.
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
