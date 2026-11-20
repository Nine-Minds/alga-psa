import type { Knex } from 'knex';
import { admits } from '@alga-psa/core/capability';
import { tenantDb } from '@alga-psa/db';
import type { TicketSeatContext } from './ticketSeatContext';

type Db = Knex | Knex.Transaction;

/**
 * Key in `co_managed_seat_arrangements.settings` (jsonb): whether the client's seat technicians may see the MSP's
 * total effort on a ticket. Only the boolean `true` allows it; absent, `false` or any other value is off, which is
 * the default (PRD open question 1). Read live from the client's active arrangement on every ticket load, so
 * flipping it decides the technician's next request. No column: the setting is one boolean on an existing jsonb bag.
 */
export const SEAT_MSP_EFFORT_VISIBLE_SETTING = 'mspEffortVisibleToTechnicians';

export const mspEffortVisibleToTechnicians = (settings: unknown): boolean =>
  typeof settings === 'object' && settings !== null && (settings as Record<string, unknown>)[SEAT_MSP_EFFORT_VISIBLE_SETTING] === true;

/** One of the technician's own entries on the ticket. Display fields only; `entry_id` is the edit/delete key. */
export interface SeatEffortOwnEntry { entry_id: string; start_time: string; end_time: string; minutes: number; notes: string | null }

/**
 * Effort on one ticket, projected by organization and by who is asking (S28 / F069).
 *
 * - Client IT effort: operational entries on the ticket (written only by seat technicians of the client).
 * - MSP effort: commercial entries on the ticket.
 *
 * The projection is decided HERE, on the server, and the payload is built to the viewer:
 * - `msp` viewer: `clientItMinutes`, `mspMinutes` and `combinedMinutes`.
 * - `client_it` viewer: `clientItMinutes`, their own entries, and `mspMinutes` ONLY when the arrangement setting allows.
 *   When it does not, the MSP total is never queried and the key is absent from the object, so it cannot be
 *   serialized to the browser; the screen has nothing to hide.
 */
export interface SeatEffortSummary {
  viewer: 'msp' | 'client_it';
  clientItMinutes: number;
  mspMinutes?: number;
  combinedMinutes?: number;
  ownMinutes?: number;
  ownEntries?: SeatEffortOwnEntry[];
}

// Actual minutes of one entry, from the start/end instants (operational rows store no billable minutes).
// LEVERAGE: pattern entry-minutes-sql — the same ROUND(EXTRACT(EPOCH …)/60) rule as packages/co-managed/src/effortTotals.ts (workspace shape, cross-tenant); a shared minutes expression below both would remove the copy
const MINUTES_SQL = 'GREATEST(ROUND(EXTRACT(EPOCH FROM (end_time - start_time)) / 60.0), 0)';

/**
 * The seat-shape sibling of `getCoManagedEffortTotals` (which projects the workspace shape: two tenants, joined
 * through time work references, behind shared-work grants and redaction). Here both sides live in ONE tenant and
 * split on `time_entries.billing_mode`, so the structures share only the minutes rule.
 *
 * Returns null unless the ticket has a seat context (a live arrangement, a reader who is staff or a technician) AND the
 * `co-managed-seat` capability admits the tenant (release flag on). Off by default on both counts.
 */
export async function resolveSeatEffortSummary(
  db: Db,
  tenant: string,
  input: { seatTicket: TicketSeatContext | null; userId: string; ticketId: string; clientId: string | null | undefined },
): Promise<SeatEffortSummary | null> {
  const { seatTicket } = input;
  if (!seatTicket?.arrangement || !input.clientId) return null;
  // The summary is user-visible, so it needs the capability ADMITTED (release flag `release-v2-0-feature` AND an eligible pool);
  // the seat context alone only says the tenant participates, which survives the flag being turned off.
  if (!(await admits('co-managed-seat', tenant)).admitted) return null;
  const scoped = tenantDb(db, tenant);
  const ticketEntries = () => scoped.table('time_entries').where({ work_item_type: 'ticket', work_item_id: input.ticketId });
  const total = async (mode: 'operational' | 'commercial') => {
    const query = ticketEntries();
    if (mode === 'operational') query.where('billing_mode', 'operational'); else query.whereNot('billing_mode', 'operational');
    const row = await query.select(db.raw(`COALESCE(SUM(${MINUTES_SQL}), 0)::bigint AS minutes`)).first() as { minutes: string | number } | undefined;
    const value = Number(row?.minutes ?? 0);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid seat effort total');
    return value;
  };

  if (seatTicket.viewer === 'msp') {
    const [clientItMinutes, mspMinutes] = await Promise.all([total('operational'), total('commercial')]);
    return { viewer: 'msp', clientItMinutes, mspMinutes, combinedMinutes: clientItMinutes + mspMinutes };
  }

  const arrangement = await scoped.table('co_managed_seat_arrangements')
    .where({ client_id: input.clientId, state: 'active' }).first('settings');
  const showMsp = mspEffortVisibleToTechnicians(arrangement?.settings);
  const [clientItMinutes, mspMinutes, own] = await Promise.all([
    total('operational'),
    showMsp ? total('commercial') : Promise.resolve(null),
    ticketEntries().where({ billing_mode: 'operational', user_id: input.userId })
      .orderBy('start_time', 'desc').select('entry_id', 'start_time', 'end_time', 'notes'),
  ]);
  const ownEntries: SeatEffortOwnEntry[] = own.map((row: any) => ({
    entry_id: row.entry_id,
    start_time: new Date(row.start_time).toISOString(),
    end_time: new Date(row.end_time).toISOString(),
    minutes: Math.max(Math.round((new Date(row.end_time).getTime() - new Date(row.start_time).getTime()) / 60000), 0),
    notes: row.notes ?? null,
  }));
  return {
    viewer: 'client_it',
    clientItMinutes,
    ...(mspMinutes === null ? {} : { mspMinutes }),
    ownMinutes: ownEntries.reduce((sum, entry) => sum + entry.minutes, 0),
    ownEntries,
  };
}
