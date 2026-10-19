import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isLicensedUserType } from '@alga-psa/types';
import { HumanWorkAssigneeInvalidError, HumanWorkOwnerRequiredError } from './HumanWorkOwnerRequiredError';

export { HumanWorkAssigneeInvalidError, HumanWorkOwnerRequiredError };

type MaybeId = string | null | undefined;

async function loadInvalidIds(trx: Knex | Knex.Transaction, tenant: string, ids: string[]): Promise<string[]> {
  const rows = (await tenantDb(trx, tenant)
    .table('users')
    .whereIn('user_id', ids)
    .select('user_id', 'user_type', 'is_inactive')) as Array<{
    user_id: string;
    user_type: string | null;
    is_inactive: boolean | null;
  }>;
  const valid = new Set(
    rows.filter((row) => !row.is_inactive && isLicensedUserType(row.user_type)).map((row) => row.user_id)
  );
  return ids.filter((id) => !valid.has(id));
}

/**
 * Human-work guard: every id must be an active, licensed (`internal`) user of the tenant.
 * Missing, inactive, client and service ids are rejected. null/undefined ids are ignored.
 * Call only with ids the write sets or changes so legacy references never block unrelated edits.
 */
export async function assertHumanWorkAssignee(
  trx: Knex | Knex.Transaction,
  tenant: string,
  userIds: ReadonlyArray<MaybeId>
): Promise<void> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => typeof id === 'string' && id.length > 0)));
  if (ids.length === 0) return;
  const invalid = await loadInvalidIds(trx, tenant, ids);
  if (invalid.length > 0) {
    throw new HumanWorkAssigneeInvalidError(invalid);
  }
}

/**
 * Guard for writes that DEFAULT ownership to the caller: the effective user must be an
 * active internal user, else HumanWorkOwnerRequiredError(field).
 */
export async function assertHumanWorkOwner(
  trx: Knex | Knex.Transaction,
  tenant: string,
  effectiveUserId: MaybeId,
  field: string
): Promise<void> {
  if (!effectiveUserId) throw new HumanWorkOwnerRequiredError(field);
  const invalid = await loadInvalidIds(trx, tenant, [effectiveUserId]);
  if (invalid.length > 0) throw new HumanWorkOwnerRequiredError(field);
}
