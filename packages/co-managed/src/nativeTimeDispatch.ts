import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { productTimeEntryMode } from '@alga-psa/types';
import { getCoManagedOperationalState } from '@alga-psa/licensing';
import { hasCoManagedConversationOwnership } from './nativeConversationEvents';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';

/** What a native time operation is addressed at.
 *
 * `tenant` is a collection that genuinely spans the workspace. `entries`,
 * `sheets` and `userPeriod` name the records the operation actually touches.
 * `inherited` says an enclosing operation has already dispatched this request
 * and a nested step must not decide it a second time. */
export type CoManagedNativeTimeScope =
  | { kind: 'tenant' }
  | { kind: 'entries'; entryIds: readonly string[] }
  | { kind: 'sheets'; sheetIds: readonly string[] }
  | { kind: 'userPeriod'; userId: string; periodId: string }
  | { kind: 'inherited' };

/** The one question every native time entry point asks before doing any work:
 * does the co-managed layer own this operation, or does the native PSA path?
 *
 * A co-managed workspace owns all of its time unconditionally. Any other
 * workspace -- an MSP sponsor recording commercial effort against shared work
 * -- owns only the time that carries co-managed or operational effort, and
 * that evidence has to be read at the scope the operation is *addressed* at.
 *
 * Two copies of this probe answering at different scopes is what made a
 * sponsor's empty sheet unopenable: the lifecycle claimed the operation
 * because the tenant held co-managed effort in some *other* sheet, created the
 * sheet, and then the sheet-scoped read declined that same brand-new empty
 * sheet -- and the lifecycle turned the disagreement into a refusal. Scope is
 * an argument now, so the halves of one operation cannot drift apart again. */
export async function dispatchCoManagedNativeTime(trx: Knex.Transaction, tenant: string,
  scope: CoManagedNativeTimeScope): Promise<boolean> {
  await getCoManagedOperationalState(trx, tenant);
  const owner = tenantDb(trx, tenant), workspace = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
  const claimed = scope.kind === 'inherited' || workspace?.product_code === 'co_managed' ||
    !!await addressedCoManagedEffort(trx, tenant, scope) || await hasCoManagedConversationOwnership(trx, tenant);
  if (!claimed) return false;
  if (!workspace || workspace.suspended_at || !productTimeEntryMode(workspace.product_code)) throw new CoManagedSharedWorkError();
  return true;
}

async function addressedCoManagedEffort(trx: Knex.Transaction, tenant: string, scope: CoManagedNativeTimeScope) {
  if (scope.kind === 'inherited') return undefined;
  const owner = tenantDb(trx, tenant);
  const effort = owner.table('time_entries').where(q => q.where('billing_mode', 'operational').orWhere('work_item_type', 'co_managed'));
  if (scope.kind === 'entries') effort.whereIn('entry_id', [...scope.entryIds]);
  if (scope.kind === 'sheets') effort.whereIn('time_sheet_id', [...scope.sheetIds]);
  if (scope.kind === 'userPeriod') {
    if (!isCoManagedUuid(scope.userId) || !isCoManagedUuid(scope.periodId)) throw new CoManagedSharedWorkError();
    // The addressed resource is whichever sheet already holds this user's
    // effort for this period -- none of them, when the operation is about to
    // open the first one.
    const addressed = await owner.table('time_sheets').where({ user_id: scope.userId, period_id: scope.periodId }).orderBy('id').select('id');
    effort.whereIn('time_sheet_id', addressed.map(row => row.id));
  }
  return effort.first('entry_id');
}
