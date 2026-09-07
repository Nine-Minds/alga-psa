import type { Knex } from 'knex';
import { compileResourceReadAuthorizationSql, type AuthorizationSubject, type BundleNarrowingRule } from '@alga-psa/authorization';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';

/** The compiler sees only home-policy projections. Shared work has no MSP
 * owner, and its queue/assignee exist only through the verified MSP work reference. */
export function applyCoManagedQueuePolicy(query: Knex.QueryBuilder, subject: AuthorizationSubject, rules: BundleNarrowingRule[],
  options: { resourceType: 'ticket' | 'project'; shared: boolean; ownerAvailable?: boolean; boardAvailable?: boolean }) {
  const { resourceType, shared, ownerAvailable = !shared, boardAvailable = true } = options;
  const result = compileResourceReadAuthorizationSql(query, { resourceType, action: 'read', builtinRules: [], bundleRules: rules,
    ctx: { subject, adapter: { ownerColumn: 'q.auth_owner', clientColumn: 'q.auth_client', boardColumn: 'q.auth_board', teamColumn: 'q.auth_team',
      applyAssignedUsers: (builder, ids) => { builder.whereIn('q.auth_assigned', ids); } } } });
  // Do not execute a partially compiled policy if the kernel gains a new guard.
  if (!result.supported) throw new CoManagedSharedWorkError();
  const columns: Record<string, string | undefined> = { client_id: 'q.auth_client', board_id: boardAvailable ? 'q.auth_board' : undefined,
    owner_user_id: ownerAvailable ? 'q.auth_owner' : undefined, assigned_to: 'q.auth_assigned' };
  for (const rule of rules) for (const constraint of rule.constraints ?? []) {
    const column = columns[constraint.field];
    if (!column) { query.whereRaw('false'); continue; }
    // The shared command's absent local queue/assignee is undefined, not null.
    if ((shared && constraint.field !== 'client_id') || constraint.field === 'assigned_to') query.whereNotNull(column);
    if (constraint.operator === 'eq') {
      if (isCoManagedUuid(constraint.value) || constraint.value === null) query.where(column, constraint.value);
      else query.whereRaw('false');
    }
    else if (constraint.operator === 'in' && Array.isArray(constraint.value)) {
      query.where(function () {
        this.whereIn(column, (constraint.value as unknown[]).filter(isCoManagedUuid));
        if (!shared && (constraint.value as unknown[]).includes(null)) this.orWhereNull(column);
      });
    } else query.whereRaw('false');
  }
}
