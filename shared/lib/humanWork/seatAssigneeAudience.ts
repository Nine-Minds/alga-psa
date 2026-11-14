import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { HumanWorkAssigneeInvalidError } from './HumanWorkOwnerRequiredError';
import type { InternalReaderIdentity } from '../commentAudience';

type Db = Knex | Knex.Transaction;

/**
 * Who a seat technician may assign work to: themselves and the other live seat technicians of
 * their own client, and no MSP user. `null` means the actor is not a seat technician and the
 * audience is unrestricted.
 *
 * The one place that answers "who may this actor assign to?", for the assignee pickers (so a seat
 * technician is offered nobody else) and for the server-side check (so the picker is not the only
 * thing standing between a seat technician and an MSP user).
 *
 * Native code never imports `@alga-psa/co-managed`, so this reads the seat tables directly, as
 * `assertHumanWorkAssignee` does. Pass the actor's loaded user row when the caller holds it: a row
 * whose `seat_reader` marker is `false` is MSP staff with no statement, so a plain PSA request never
 * touches a co-managed table. (A user whose only seat was revoked has the marker cleared and reads as
 * staff here; that is safe because the closed seat baseline already denies such a user every ticket
 * read and write before an assignee is offered or checked.) A bare id (or a row without the marker) costs one indexed lookup of
 * `co_managed_seat_assignments` by user id, and nothing else for a non-seat actor.
 */
export async function resolveSeatAssigneeAudience(
  db: Db,
  tenant: string,
  actor: InternalReaderIdentity | null | undefined
): Promise<string[] | null> {
  if (!actor) return null;
  // Same rule as commentAudience's isKnownStaffReader (not imported: that module pulls in write admission).
  if (typeof actor !== 'string' && actor.seat_reader === false) return null;
  const actorUserId = typeof actor === 'string' ? actor : actor.user_id;
  if (!actorUserId) return null;
  const scoped = tenantDb(db, tenant);
  // A user may hold a revoked history row beside a live one: the live row decides, and any other
  // row only makes them a seat subject with nothing granted.
  const own = await scoped.table('co_managed_seat_assignments').where('user_id', actorUserId)
    .orderByRaw("(state = 'active') desc").first('arrangement_id', 'state');
  if (!own) return null;

  // A seat technician whose seat is not live is still a seat subject and is offered nobody.
  const mine = await liveClientId(db, tenant, own.state === 'active' ? own.arrangement_id : null);
  if (!mine) return [];

  const peers = scoped.table('co_managed_seat_assignments as a');
  scoped.tenantJoin(peers, 'co_managed_seat_arrangements as r', 'r.arrangement_id', 'a.arrangement_id', { rootTenantColumn: 'a.tenant' });
  const rows = await peers
    .where({ 'a.state': 'active', 'r.state': 'active', 'r.client_id': mine })
    .whereNotNull('a.user_id')
    .select('a.user_id');
  return rows.map((row: { user_id: string }) => row.user_id);
}

// LEVERAGE: pattern seat-tables-read-from-shared — native code may not import @alga-psa/co-managed, so this file and assertHumanWorkAssignee each re-read the seat assignment/arrangement tables; a seat-scope reader below co-managed would serve both.
async function liveClientId(db: Db, tenant: string, arrangementId: string | null): Promise<string | null> {
  if (!arrangementId) return null;
  const row = await tenantDb(db, tenant).table('co_managed_seat_arrangements')
    .where({ arrangement_id: arrangementId, state: 'active' }).first('client_id');
  return row?.client_id ?? null;
}

/**
 * Narrows a users query to an audience from `resolveSeatAssigneeAudience`. A `null` audience
 * (unrestricted actor) returns the query untouched.
 */
export function restrictToSeatAudience<Q extends Knex.QueryBuilder>(
  query: Q,
  audience: string[] | null,
  userIdColumn: string = 'user_id'
): Q {
  return audience ? (query.whereIn(userIdColumn, audience) as Q) : query;
}

/**
 * Server-side counterpart of the picker: a seat technician may only assign themselves or a seat
 * technician of their own client. `actor` is the acting user's id or loaded row (see
 * `resolveSeatAssigneeAudience`). Refuses with `HumanWorkAssigneeInvalidError('seat_out_of_scope')`.
 * Does nothing for any other actor.
 */
export async function assertActorMayAssign(
  db: Db,
  tenant: string,
  actor: InternalReaderIdentity | null | undefined,
  userIds: ReadonlyArray<string | null | undefined>
): Promise<void> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => typeof id === 'string' && id.length > 0)));
  if (ids.length === 0) return;
  const audience = await resolveSeatAssigneeAudience(db, tenant, actor);
  if (!audience) return;
  const allowed = new Set(audience);
  const refused = ids.filter((id) => !allowed.has(id));
  if (refused.length > 0) throw new HumanWorkAssigneeInvalidError(refused, 'seat_out_of_scope');
}
