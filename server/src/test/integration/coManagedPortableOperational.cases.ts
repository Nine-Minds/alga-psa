import { randomUUID, createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { expect, it, vi } from 'vitest';
import * as timeAdmission from '../../../../packages/co-managed/src/nativeTimeEntryAccess';
import * as scheduleAdmission from '../../../../packages/co-managed/src/nativeScheduleRead';
import { exportCoManagedPortableOperational, validateCoManagedPortableOperationalRecords } from '../../../../packages/co-managed/src/portableOperationalExport';

/** Registered by the schema-only bootstrap suite to reuse its real tracked
 * customer/MSP fixture and disposable PostgreSQL database. */
export function registerCoManagedPortableOperationalCases(getDb: () => Knex, createFixture: () => Promise<any>) {
  const setup = async () => {
    const f = await createFixture(), db = getDb(), tenant = f.actor.tenant, user = f.actor.userId;
    const periodId = randomUUID(), sheetId = randomUUID(), entryId = randomUUID(), scheduleId = randomUUID(), hoursId = randomUUID(), policyId = randomUUID();
    await f.customer.table('time_periods').insert({ tenant, period_id: periodId, start_date: '2026-09-07', end_date: '2026-09-14' });
    await f.customer.table('time_sheets').insert({ tenant, id: sheetId, user_id: user, period_id: periodId, approval_status: 'DRAFT', notes: 'Customer whole-sheet notes' });
    await f.customer.table('time_entries').insert({ tenant, entry_id: entryId, user_id: user, time_sheet_id: sheetId,
      work_item_id: f.resource.id, work_item_type: 'ticket', notes: 'Customer operational time', start_time: '2026-09-08T09:00:00Z', end_time: '2026-09-08T10:00:00Z',
      billable_duration: 0, approval_status: 'DRAFT', work_date: '2026-09-08', work_timezone: 'America/New_York', created_by: user, updated_by: user });
    await f.customer.table('time_sheet_comments').insert({ tenant, comment_id: randomUUID(), time_sheet_id: sheetId, user_id: user, comment: 'Customer review comment', is_approver: false });
    await f.customer.table('time_entry_change_requests').insert({ tenant, change_request_id: randomUUID(), time_sheet_id: sheetId, time_entry_id: entryId,
      created_by: user, comment: 'Customer change request' });
    await f.customer.table('schedule_entries').insert({ tenant, entry_id: scheduleId, title: 'Customer ticket appointment', notes: 'Customer appointment notes',
      work_item_id: f.resource.id, work_item_type: 'ticket', scheduled_start: '2026-09-08T09:00:00Z', scheduled_end: '2026-09-08T10:00:00Z', status: 'scheduled', is_private: true });
    await f.customer.table('schedule_entry_assignees').insert({ tenant, entry_id: scheduleId, user_id: user });
    await f.customer.table('user_work_schedules').insert({ tenant, user_id: user, day_of_week: 2, start_time: '09:00', end_time: '17:00', is_working: true });
    await f.customer.table('business_hours_schedules').insert({ tenant, schedule_id: hoursId, schedule_name: 'Customer office hours', timezone: 'America/New_York' });
    await f.customer.table('business_hours_entries').insert({ tenant, entry_id: randomUUID(), schedule_id: hoursId, day_of_week: 2, start_time: '09:00', end_time: '17:00', is_enabled: true });
    await f.customer.table('holidays').insert({ tenant, holiday_id: randomUUID(), schedule_id: hoursId, holiday_name: 'Customer holiday', holiday_date: '2026-09-09', is_recurring: false });
    await f.customer.table('sla_policies').insert({ tenant, sla_policy_id: policyId, policy_name: 'Customer SLA', business_hours_schedule_id: hoursId });
    const priority = await f.customer.table('priorities').where('item_type', 'ticket').first();
    await f.customer.table('sla_policy_targets').insert({ tenant, target_id: randomUUID(), sla_policy_id: policyId, priority_id: priority.priority_id, response_time_minutes: 60, resolution_time_minutes: 480 });
    await f.customer.table('sla_notification_thresholds').insert({ tenant, threshold_id: randomUUID(), sla_policy_id: policyId, threshold_percent: 80, notification_type: 'warning', channels: ['in_app'] });
    return { ...f, db, periodId, sheetId, entryId, scheduleId, hoursId, policyId, exportRecords: () => exportCoManagedPortableOperational(db, f.customerPrincipal, randomUUID()) };
  };

  it('portable operational export preserves own time review schedules and SLA configuration without commercial or live dispatch bindings', async () => {
    const f = await setup(), result = await f.exportRecords();
    expect(result.records.time_entries.find((row: any) => row.entry_id === f.entryId)).toMatchObject({ notes: 'Customer operational time', work_item_id: f.resource.id, work_timezone: 'America/New_York' });
    const entry = result.records.time_entries.find((row: any) => row.entry_id === f.entryId);
    expect((Date.parse(entry.end_time) - Date.parse(entry.start_time)) / 60000).toBe(60);
    expect(result.records.time_sheets.find((row: any) => row.id === f.sheetId)?.notes).toBe('Customer whole-sheet notes');
    expect(result.records.time_sheet_comments.map((row: any) => row.comment)).toContain('Customer review comment');
    expect(result.records.time_entry_change_requests.map((row: any) => row.comment)).toContain('Customer change request');
    expect(result.records.schedule_entries.find((row: any) => row.entry_id === f.scheduleId)).toMatchObject({ is_private: true, title: 'Customer ticket appointment' });
    expect(result.records.sla_policies.find((row: any) => row.sla_policy_id === f.policyId)).toMatchObject({ business_hours_schedule_id: f.hoursId });
    expect(result.records.sla_policies.some((row: any) => row.policy_name === 'MSP policy')).toBe(false);
    expect(result.restorePolicy).toMatchObject({ sponsorship: 'none', timeBilling: 'operational', runningTimers: 'none', notificationDispatch: 'paused' });
    const { sha256, ...payload } = result;
    expect(sha256).toBe(createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
    for (const name of ['billable_duration', 'service_id', 'contract_line_id', 'billing_profile_id', 'co_managed_work_reference_id', 'sla_notifications_sent', 'native_time_tracking_sessions']) expect(JSON.stringify(result)).not.toContain(name);
    const broken = structuredClone(result.records); broken.time_sheets = [];
    expect(() => validateCoManagedPortableOperationalRecords(broken)).toThrow();
    const duplicateDay = structuredClone(result.records); duplicateDay.user_work_schedules.push({ ...duplicateDay.user_work_schedules[0] });
    expect(() => validateCoManagedPortableOperationalRecords(duplicateDay)).toThrow();
    const badType = structuredClone(result.records); badType.time_entries[0].work_item_type = 'co_managed';
    expect(() => validateCoManagedPortableOperationalRecords(badType)).toThrow();
  });

  it('portable operational export rejects another employee private appointment and missing current permissions or session', async () => {
    const f = await setup();
    await f.customer.table('schedule_entry_assignees').where('entry_id', f.scheduleId).delete();
    await expect(f.exportRecords()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    await f.customer.table('schedule_entry_assignees').insert({ tenant: f.actor.tenant, entry_id: f.scheduleId, user_id: f.actor.userId });
    const permission = await f.customer.table('permissions').where({ resource: 'sla_policy', action: 'read', msp: true }).first();
    const grants = await f.customer.table('role_permissions').where('permission_id', permission.permission_id);
    await f.customer.table('role_permissions').where('permission_id', permission.permission_id).delete();
    await expect(f.exportRecords()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    await f.customer.table('role_permissions').insert(grants);
    await f.customer.table('sessions').where('session_id', f.customerPrincipal.sessionId).update({ expires_at: new Date(Date.now() - 1000) });
    await expect(f.exportRecords()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
  });

  it.each(['privacy', 'assignment'] as const)('portable operational export retains canonical schedules against concurrent %s changes', async change => {
    const f = await setup();
    if (change === 'privacy') {
      await f.customer.table('schedule_entries').where('entry_id', f.scheduleId).update({ is_private: false });
      await f.customer.table('schedule_entry_assignees').where('entry_id', f.scheduleId).delete();
    }
    let reached!: () => void, resume!: () => void;
    const atSource = new Promise<void>(resolve => { reached = resolve; });
    const released = new Promise<void>(resolve => { resume = resolve; });
    const retainSource = scheduleAdmission.retainScheduleSource;
    const spy = vi.spyOn(scheduleAdmission, 'retainScheduleSource').mockImplementation(async (...args) => {
      const result = await retainSource(...args);
      if (args[3].entry_id === f.scheduleId) { reached(); await released; }
      return result;
    });
    const exporting = f.exportRecords();
    // Attach rejection handling immediately so an admission failure before the
    // gate cannot hang the test or become an unhandled rejection.
    const outcome = exporting.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    try {
      await Promise.race([atSource, outcome.then(result => { throw result.error ?? new Error('Export finished before source gate'); })]);
      await f.db.transaction(async (trx: Knex.Transaction) => {
        await trx.raw("SET LOCAL lock_timeout = '2s'");
        if (change === 'privacy') await trx('schedule_entries').where({ tenant: f.actor.tenant, entry_id: f.scheduleId }).update({ is_private: true, notes: 'New private content' });
        else await trx('schedule_entry_assignees').where({ tenant: f.actor.tenant, entry_id: f.scheduleId, user_id: f.actor.userId }).delete();
      });
      resume();
      const result = await outcome;
      expect(result.value).toBeUndefined();
      expect(result.error).toMatchObject({ code: '40001' });
    } finally { resume(); spy.mockRestore(); await outcome; }
  });


  it('portable operational export retains canonical time entries against concurrent work-source changes', async () => {
    const f = await setup();
    let reached!: () => void, resume!: () => void;
    const atSource = new Promise<void>(resolve => { reached = resolve; });
    const released = new Promise<void>(resolve => { resume = resolve; });
    const admitSource = timeAdmission.admitCoManagedNativeTimeSource;
    const spy = vi.spyOn(timeAdmission, 'admitCoManagedNativeTimeSource').mockImplementation(async (...args) => {
      const result = await admitSource(...args);
      if (args[2].entry_id === f.entryId) { reached(); await released; }
      return result;
    });
    const outcome = f.exportRecords().then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    try {
      await Promise.race([atSource, outcome.then(result => { throw result.error ?? new Error('Export finished before source gate'); })]);
      await f.db.transaction(async (trx: Knex.Transaction) => {
        await trx.raw("SET LOCAL lock_timeout = '2s'");
        await trx('time_entries').where({ tenant: f.actor.tenant, entry_id: f.entryId }).update({ work_item_type: 'non_billable_category', work_item_id: null, notes: 'Changed work source' });
      });
      resume();
      const result = await outcome;
      expect(result.value).toBeUndefined();
      expect(result.error).toMatchObject({ code: '40001' });
    } finally { resume(); spy.mockRestore(); await outcome; }
  });

}
