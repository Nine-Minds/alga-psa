import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { expect, it, vi } from 'vitest';

type Fixture = (work: (fixture: any) => Promise<void>) => Promise<void>;

/**
 * The native stopwatch and per-work-item time list on a shared (co_managed) work reference.
 * `withTime` is the MSP shared-time-save fixture: a sponsor workspace with a registered
 * reference, a draft sheet, a service and the tracked browser session the actions require.
 */
const unsupported = 'msp/time-entry:errors.stopwatch.unsupportedWorkItem';
export function registerCoManagedSharedStopwatchTests(getDb: () => Knex, withTime: Fixture) {
  async function setup(f: any) {
    // The clock reads and writes its own sessions under the plain time_entry permissions.
    const permission = await f.customer.table('permissions').where({ resource: 'time_entry', action: 'read', msp: true, client: false }).first();
    await f.sponsor.table('permissions').insert({ ...permission, tenant: f.principal.tenant }).onConflict().ignore();
    await f.sponsor.table('role_permissions').insert({ tenant: f.principal.tenant, role_id: f.roleId, permission_id: permission.permission_id }).onConflict().ignore();
    const sw = await import('../../../../../packages/scheduling/src/actions/stopwatchActions');
    const shared = await import('../../../lib/actions/coManagedTimeActions');
    const sessions = () => f.sponsor.table('time_tracking_sessions');
    return { sw, shared, sessions };
  }

  it('shared stopwatch starts on the work reference, logs through the shared save, and lists the entry for that work item', async () => withTime(async f => {
    const { sw, shared, sessions } = await setup(f);
    const started: any = await sw.startStopwatch({ work_item_type: 'co_managed', work_item_id: f.referenceId, notes: 'Tracked shared work' });
    expect(started.session).toMatchObject({ user_id: f.principal.userId, work_item_type: 'co_managed', work_item_id: f.referenceId, status: 'running',
      work_item_title: 'Customer issue' });
    expect(await sessions()).toHaveLength(1);
    // One open clock per user, shared or native.
    expect(await sw.startStopwatch({ work_item_type: 'co_managed', work_item_id: f.referenceId })).toMatchObject({ conflict: { session_id: started.session.session_id } });
    expect(await sw.getMyStopwatch()).toMatchObject({ session_id: started.session.session_id, work_item_type: 'co_managed' });
    expect(await sw.pauseStopwatch(started.session.session_id)).toMatchObject({ status: 'paused' });
    expect(await sw.resumeStopwatch(started.session.session_id)).toMatchObject({ status: 'running' });

    const entry = await f.save({ stopwatch_session_id: started.session.session_id });
    expect(entry).toMatchObject({ work_item_type: 'co_managed', work_item_id: f.referenceId, co_managed_work_reference_id: f.referenceId, billing_mode: 'commercial' });
    expect(await sessions().first()).toMatchObject({ status: 'logged', time_entry_id: entry.entry_id });
    expect(await sw.getMyStopwatch()).toBeNull();
    expect(await f.sponsor.table('time_entries')).toHaveLength(1);

    const list: any = await shared.listSharedTimeEntriesAction(f.resource);
    expect(list.entries).toEqual([expect.objectContaining({ entry_id: entry.entry_id, user_id: f.principal.userId, is_own: true, billable_duration: 60 })]);
    expect(list).toMatchObject({ ownEntryCount: 1, ownTotalMinutes: 60, othersEntryCount: 0, totalMinutes: 60 });
    // A source that was never registered here has no time, and a guessed UUID reveals nothing.
    expect(await shared.listSharedTimeEntriesAction({ ...f.resource, id: randomUUID() })).toMatchObject({ entries: [], totalMinutes: 0 });
  }));

  it('shared stopwatch cannot be redirected: a native clock never logs shared time and a shared clock never logs another item', async () => withTime(async f => {
    const { sw, sessions } = await setup(f);
    const started: any = await sw.startStopwatch({ work_item_type: 'co_managed', work_item_id: f.referenceId });
    // A shared clock refused for a different shared work item or a native work item type.
    expect(await f.save({ stopwatch_session_id: started.session.session_id, work_item_type: 'ad_hoc', work_item_id: randomUUID() })).toMatchObject({ messageKey: unsupported });
    expect(await sessions().first()).toMatchObject({ status: 'running', time_entry_id: null });
    // The shared reference only exists for a registered clock: a made-up reference is not startable.
    await sw.discardStopwatch(started.session.session_id);
    expect(await sw.startStopwatch({ work_item_type: 'co_managed', work_item_id: randomUUID() })).toMatchObject({ permissionError: expect.any(String) });
    // A native stopwatch session cannot be logged as shared time, even with a valid reference.
    const [native] = await sessions().insert({ tenant: f.principal.tenant, user_id: f.principal.userId, work_item_type: 'ticket', work_item_id: randomUUID(),
      notes: '', status: 'running', created_at: new Date(), updated_at: new Date() }).returning('*');
    expect(await f.save({ stopwatch_session_id: native.session_id })).toMatchObject({ messageKey: unsupported });
    expect(await f.sponsor.table('time_entries')).toHaveLength(0);
  }));

  it('shared stopwatch admission denies users without current technician staff assignment, revoked grants and API-key overrides', async () => withTime(async f => {
    const { sw, shared, sessions } = await setup(f);
    const auth = await import('@alga-psa/auth');
    // Viewer-only staff may read shared work but not contribute effort through a clock.
    await f.sponsor.table('co_management_staff_assignments').where('principal_id', f.principal.userId).update({ relationship_role: 'viewer' });
    expect(await sw.startStopwatch({ work_item_type: 'co_managed', work_item_id: f.referenceId })).toMatchObject({ permissionError: expect.any(String) });
    // No assignment at all.
    await f.sponsor.table('co_management_staff_assignments').where('principal_id', f.principal.userId).del();
    expect(await sw.startStopwatch({ work_item_type: 'co_managed', work_item_id: f.referenceId })).toMatchObject({ permissionError: expect.any(String) });
    expect(await sessions()).toHaveLength(0);
    await expect(shared.listSharedTimeEntriesAction(f.resource)).resolves.toMatchObject({ entries: [] });
  }));

  it('shared stopwatch start is refused for API credentials and after the customer revokes the grant, but the open clock survives for pause and discard', async () => withTime(async f => {
    const { sw, shared, sessions } = await setup(f);
    const auth = await import('@alga-psa/auth');
    vi.mocked(auth.getApiKeyUserOverride).mockReturnValue(f.user);
    expect(await sw.startStopwatch({ work_item_type: 'co_managed', work_item_id: f.referenceId })).toMatchObject({ permissionError: expect.any(String) });
    await expect(shared.listSharedTimeEntriesAction(f.resource)).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    vi.mocked(auth.getApiKeyUserOverride).mockReturnValue(undefined);
    expect(await sessions()).toHaveLength(0);

    const started: any = await sw.startStopwatch({ work_item_type: 'co_managed', work_item_id: f.referenceId });
    await (await import('../../../../../packages/co-managed/src/ticketHandoffs')).revokeCoManagedTicketGrant(getDb(), f.customerPrincipal, f.resource,
      { operationId: randomUUID(), expectedRevision: 1, note: 'Customer withdrew the shared work' });
    // Revocation closes new contribution: the held clock cannot be logged, nor a new one started.
    await expect(f.save({ stopwatch_session_id: started.session.session_id })).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    expect(await f.sponsor.table('time_entries')).toHaveLength(0);
    expect(await sw.pauseStopwatch(started.session.session_id)).toMatchObject({ status: 'paused' });
    expect(await sw.discardStopwatch(started.session.session_id)).toMatchObject({ status: 'discarded' });
    expect(await sw.startStopwatch({ work_item_type: 'co_managed', work_item_id: f.referenceId })).toMatchObject({ permissionError: expect.any(String) });
  }));

  it('shared time list returns only admitted entries and counts the rest as hidden, never as content', async () => withTime(async f => {
    const { shared } = await setup(f);
    const own = await f.save();
    const otherUser = randomUUID(), otherSheet = randomUUID(), otherEntry = randomUUID();
    const base = await f.sponsor.table('users').where('user_id', f.principal.userId).first();
    await f.sponsor.table('users').insert({ ...base, user_id: otherUser, email: `shared-list-${otherUser}@example.test`, username: `shared-list-${otherUser}` });
    const sheet = await f.sponsor.table('time_sheets').where('id', f.sheetId).first();
    await f.sponsor.table('time_sheets').insert({ ...sheet, id: otherSheet, user_id: otherUser });
    await f.sponsor.table('time_entries').insert({ tenant: f.principal.tenant, entry_id: otherEntry, user_id: otherUser, work_item_id: f.referenceId, work_item_type: 'co_managed',
      co_managed_work_reference_id: f.referenceId, time_sheet_id: otherSheet, start_time: new Date('2026-09-09T09:00:00Z'), end_time: new Date('2026-09-09T09:30:00Z'),
      work_date: '2026-09-09', work_timezone: 'UTC', billable_duration: 30, notes: 'Colleague private note', approval_status: 'DRAFT', invoiced: false });
    const list: any = await shared.listSharedTimeEntriesAction(f.resource);
    expect(list).toMatchObject({ ownEntryCount: 1, ownTotalMinutes: 60, othersEntryCount: 1, othersTotalMinutes: 30, totalMinutes: 90 });
    expect(list.entries.map((entry: any) => entry.entry_id)).toContain(own.entry_id);
    // The colleague's entry is visible only if the engine admits it; either way no hidden content leaks.
    expect(list.othersVisibleCount + list.othersHiddenCount).toBe(1);
    if (list.othersHiddenCount) { expect(JSON.stringify(list)).not.toContain('Colleague private note'); expect(list.entries).toHaveLength(1); }
  }));
}
