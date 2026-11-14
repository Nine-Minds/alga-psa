import type { Knex } from 'knex';
import { tenantDb } from './tenantDb';

/**
 * A live seat assignment means the seat role and nothing else, and no MSP team.
 *
 * A seat technician is an internal user of the sponsoring MSP who holds the seat role and is
 * bound to one client's seat arrangement. Two restrictions are written as rows, and any path
 * that writes those rows can undo them: a role grant (`user_roles`) widens what the technician
 * may do, and a team membership (`team_members`) puts them in the MSP's staff structures
 * (schedules, approvals, assignment pools). This is the one check every such writer runs first.
 *
 * Lives in @alga-psa/db for the reason `assertUserRoleFloor` does: the vertical packages (users,
 * auth, teams) and the REST API services may not import one another, and the rule must exist once.
 *
 * "Live" is the definition the seat tables carry (`co_managed_one_live_seat_assignment`): an
 * assignment that names a user and is not `revoked`. The check is one indexed read of
 * `co_managed_seat_assignments` by user id, so a tenant with no seat arrangements pays one empty
 * lookup. `users.seat_reader` is deliberately not consulted: the writers hold ids, not user rows,
 * so the marker would be a second read in front of the same table, not a saving. (A stale `true`
 * would fall through to these tables anyway.)
 *
 * No lock is taken. A user becomes a live technician only by being created at invitation
 * acceptance, and stops being one only by revoke or conversion; neither adds roles or teams to an
 * existing user's detriment, so a decision made a moment before one of them commits is still
 * correct when it does.
 *
 * Ordering without a bypass: the commands that own a technician's roles end or create the
 * assignment themselves. Acceptance writes the seat role, which this check admits; conversion
 * ends the assignment before it writes the MSP roles, so by then the user is no longer a
 * technician and the same writers would accept them.
 */
export const CO_MANAGED_SEAT_ROLE_NAME = 'Seat Technician';

export type SeatTechnicianGuardCode = 'SEAT_TECHNICIAN_ROLE_REFUSED' | 'SEAT_TECHNICIAN_TEAM_REFUSED';

const MESSAGES: Record<SeatTechnicianGuardCode, string> = {
  SEAT_TECHNICIAN_ROLE_REFUSED: 'A co-managed seat technician can hold only the seat role. Convert them to an MSP user first.',
  SEAT_TECHNICIAN_TEAM_REFUSED: 'A co-managed seat technician cannot be added to an MSP team. Convert them to an MSP user first.',
};

export class SeatTechnicianGuardError extends Error {
  readonly name = 'SeatTechnicianGuardError';
  readonly statusCode = 409;
  constructor(readonly code: SeatTechnicianGuardCode, readonly userIds: readonly string[]) {
    super(MESSAGES[code]);
  }
}

/** Recognises the error across bundle boundaries, where instanceof can fail. */
export function isSeatTechnicianGuardError(error: unknown): error is SeatTechnicianGuardError {
  return error instanceof SeatTechnicianGuardError
    || (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'SeatTechnicianGuardError');
}

/** What the caller is about to write: these roles for the users, or a team membership for them. */
export type SeatTechnicianWrite = { roleIds: readonly string[] } | { teamMembership: true };

/**
 * Throws `SeatTechnicianGuardError` when any of `userIds` is a live seat technician and `write`
 * is not something a technician may hold. Run it in the writer's transaction, before the write.
 *
 * - `{ roleIds }`: the roles the users will hold afterwards (or are being given). Refused when any
 *   is not the seat role. An empty list writes nothing and passes.
 * - `{ teamMembership: true }`: refused for any live technician, including as a team manager.
 *
 * Users that do not exist, and ordinary internal or client users, pass.
 */
export async function assertSeatTechnicianWrite(
  db: Knex | Knex.Transaction,
  tenant: string,
  userIds: readonly (string | null | undefined)[],
  write: SeatTechnicianWrite,
): Promise<void> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => typeof id === 'string' && id !== '')));
  if (ids.length === 0) return;
  const roleIds = 'roleIds' in write ? Array.from(new Set(write.roleIds)) : [];
  if ('roleIds' in write && roleIds.length === 0) return;

  const scope = tenantDb(db, tenant);
  const live = scope.table('co_managed_seat_assignments as seat_assignment')
    .whereIn('seat_assignment.user_id', ids)
    .whereNot('seat_assignment.state', 'revoked');
  if ('roleIds' in write) {
    live.whereExists(
      scope.table('roles as granted').select(db.raw('1'))
        .whereIn('granted.role_id', roleIds as string[])
        // The seat role is the one role a technician may hold: identified as the seat admission does.
        .whereRaw('NOT (granted.role_name = ? AND granted.msp = true AND granted.client = false)', [CO_MANAGED_SEAT_ROLE_NAME]),
    );
  }
  const refused: string[] = await live.distinct('seat_assignment.user_id').pluck('seat_assignment.user_id');
  if (refused.length > 0) {
    throw new SeatTechnicianGuardError('roleIds' in write ? 'SEAT_TECHNICIAN_ROLE_REFUSED' : 'SEAT_TECHNICIAN_TEAM_REFUSED', refused);
  }
}
