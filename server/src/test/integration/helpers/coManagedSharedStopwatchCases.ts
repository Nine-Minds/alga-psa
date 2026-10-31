import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { expect, it } from 'vitest';

type Fixture = (work: (fixture: any) => Promise<void>) => Promise<void>;

/**
 * Stopwatch on a shared (`co_managed`) work reference. The clock is main's own
 * `time_tracking_sessions` / `time_tracking_session_segments`; the co-managed time-source provider
 * only widens which work item types may start one (`timer.start`) and closes the session in the
 * same transaction as the combined save (`entries.admit`).
 *
 * `withTime` supplies a participating MSP workspace: `f.referenceId` is the MSP-local
 * `co_managed_ticket_references` row id, `f.save(overrides?)` runs `saveTimeEntry`, `f.principal`
 * and `f.sponsor` are the MSP actor and tenant-scoped db.
 * NOT RUNNABLE without the disposable Postgres fixture (no database was reachable when authored).
 */
export function registerCoManagedSharedStopwatchTests(_getDb: () => Knex, withTime: Fixture) {
  async function setup(f: any) {
    const sw = await import('../../../../../packages/scheduling/src/actions/stopwatchActions');
    const sessions = () => f.sponsor.table('time_tracking_sessions');
    const segments = () => f.sponsor.table('time_tracking_session_segments');
    return { sw, sessions, segments };
  }

  it('starts on the local reference in main\'s session table, logs through the combined save, and leaves no second clock table', async () => withTime(async f => {
    const { sw, sessions } = await setup(f);
    const started: any = await sw.startStopwatch({ work_item_type: 'co_managed', work_item_id: f.referenceId, notes: 'Tracked shared work' });
    expect(started.session).toMatchObject({ user_id: f.principal.userId, work_item_type: 'co_managed', work_item_id: f.referenceId, status: 'running' });
    expect(await sessions()).toHaveLength(1);
    expect(await sw.startStopwatch({ work_item_type: 'co_managed', work_item_id: f.referenceId })).toMatchObject({ conflict: { session_id: started.session.session_id } });
    expect(await sw.pauseStopwatch(started.session.session_id)).toMatchObject({ status: 'paused' });
    expect(await sw.resumeStopwatch(started.session.session_id)).toMatchObject({ status: 'running' });
    const entry = await f.save({ stopwatch_session_id: started.session.session_id });
    expect(entry).toMatchObject({ work_item_type: 'co_managed', work_item_id: f.referenceId, billing_mode: 'commercial' });
    expect(await sessions().first()).toMatchObject({ status: 'logged', time_entry_id: entry.entry_id });
    expect(await sw.getMyStopwatch()).toBeNull();
    expect(await f.sponsor.table('co_managed_work_references').where('entry_id', entry.entry_id)).toHaveLength(1);
  }));

  it('an unknown or foreign reference is not startable and a native clock never logs shared time', async () => withTime(async f => {
    const { sw, sessions } = await setup(f);
    expect(await sw.startStopwatch({ work_item_type: 'co_managed', work_item_id: randomUUID() })).toMatchObject({ permissionError: expect.any(String) });
    expect(await sessions()).toHaveLength(0);
    const [native] = await sessions().insert({ tenant: f.principal.tenant, user_id: f.principal.userId, work_item_type: 'ticket', work_item_id: randomUUID(),
      notes: '', status: 'running', created_at: new Date(), updated_at: new Date() }).returning('*');
    await expect(f.save({ stopwatch_session_id: native.session_id, work_item_type: 'co_managed', work_item_id: f.referenceId })).rejects.toBeDefined();
    expect(await sessions().where('session_id', native.session_id).first()).toMatchObject({ status: 'running', time_entry_id: null });
    expect(await f.sponsor.table('time_entries')).toHaveLength(0);
  }));

  it('start is refused when the user lacks staff authority or the customer revoked the grant; an open clock can still be paused and discarded', async () => withTime(async f => {
    const { sw, sessions } = await setup(f);
    const started: any = await sw.startStopwatch({ work_item_type: 'co_managed', work_item_id: f.referenceId });
    await f.revokeGrant();
    await expect(f.save({ stopwatch_session_id: started.session.session_id })).rejects.toBeDefined();
    expect(await f.sponsor.table('time_entries')).toHaveLength(0);
    expect(await sw.pauseStopwatch(started.session.session_id)).toMatchObject({ status: 'paused' });
    expect(await sw.discardStopwatch(started.session.session_id)).toMatchObject({ status: 'discarded' });
    expect(await sw.startStopwatch({ work_item_type: 'co_managed', work_item_id: f.referenceId })).toMatchObject({ permissionError: expect.any(String) });
    expect(await sessions().where('status', 'running')).toHaveLength(0);
  }));
}
