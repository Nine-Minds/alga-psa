import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
// LEVERAGE: pattern has-permission-duplicated — hasPermission exists in both @alga-psa/authorization and @alga-psa/auth (rbac.ts); the predicate had to pick one copy.
import { hasPermission } from './rbac';

export const QUOTE_APPROVE_PERMISSION = { resource: 'quotes', action: 'approve' } as const;

/** Audit metadata written on the `approved` quote activity when a sole approver approves their own quote. */
export const SELF_APPROVAL_AUDIT_METADATA = {
  self_approved: true,
  reason: 'sole approver',
} as const;

/**
 * Whether `subjectUserId` may approve a quote they authored: true only when NO OTHER
 * active internal (MSP) user in the tenant holds `quotes:approve`.
 *
 * Who "holds" the permission is decided by the existing RBAC resolution
 * (`hasPermission` -> `User.getUserRolesWithPermissions`), the same path the kernel's
 * default RBAC evaluator uses -- there is no second RBAC query here. Client-portal
 * users (`user_type != 'internal'`) and inactive users are excluded.
 *
 * This does not check that the subject themselves holds `quotes:approve`; callers
 * gate on that separately.
 */
export async function allowSelfQuoteApproval(
  knex: Knex | Knex.Transaction,
  tenant: string,
  subjectUserId: string
): Promise<boolean> {
  const candidates = await tenantDb(knex, tenant)
    .table('users')
    .where({ user_type: 'internal' })
    .andWhere((builder) => {
      builder.where('is_inactive', false).orWhereNull('is_inactive');
    })
    .whereNot('user_id', subjectUserId)
    .select<Array<{ user_id: string; user_type: 'internal' }>>('user_id', 'user_type');

  for (const candidate of candidates) {
    const holdsApprove = await hasPermission(
      { user_id: candidate.user_id, user_type: 'internal', tenant },
      QUOTE_APPROVE_PERMISSION.resource,
      QUOTE_APPROVE_PERMISSION.action,
      knex
    );
    if (holdsApprove) {
      return false;
    }
  }

  return true;
}

/**
 * Call-site helper: the `allowSelfApproval` flag to put on an `approve` mutation.
 * Only consults the tenant's approvers when the subject actually owns the record
 * (the only case the not-self-approver rules could deny), so ordinary approvals by
 * someone else cost no extra queries.
 */
export async function resolveAllowSelfApprovalFlag(
  knex: Knex | Knex.Transaction,
  tenant: string,
  subjectUserId: string,
  ownerUserId: string | null | undefined
): Promise<boolean> {
  if (typeof ownerUserId !== 'string' || ownerUserId !== subjectUserId) {
    return false;
  }

  return allowSelfQuoteApproval(knex, tenant, subjectUserId);
}
