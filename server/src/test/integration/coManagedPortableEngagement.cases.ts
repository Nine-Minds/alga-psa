import { randomUUID, createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { expect, it, vi } from 'vitest';
import * as meetingAdmission from '../../../../packages/co-managed/src/nativeMeetingRead';
import { exportCoManagedPortableEngagement, validateCoManagedPortableEngagementRecords } from '../../../../packages/co-managed/src/portableEngagementExport';

export function registerCoManagedPortableEngagementCases(getDb: () => Knex, createFixture: () => Promise<any>) {
  const setup = async () => {
    const f = await createFixture(), db = getDb(), tenant = f.actor.tenant, user = f.actor.userId;
    const typeId = randomUUID(), interactionId = randomUUID(), requestId = randomUUID(), scheduleId = randomUUID(), meetingId = randomUUID();
    const serviceId = randomUUID(), serviceTypeId = randomUUID(), categoryId = randomUUID(), documentId = randomUUID(), artifactId = randomUUID();
    await f.customer.table('interaction_types').insert({ tenant, type_id: typeId, type_name: `Portable interaction ${typeId}`, created_by: user });
    await f.customer.table('interactions').insert({ tenant, interaction_id: interactionId, type_id: typeId, user_id: user, client_id: f.operation.customer_client_id,
      ticket_id: f.resource.id, title: 'Customer engagement', notes: 'Customer interaction notes', duration: 45 });
    await f.customer.table('service_types').insert({ tenant, id: serviceTypeId, name: 'Portable appointment type' });
    await f.customer.table('service_categories').insert({ tenant, category_id: categoryId, category_name: 'Customer appointment category' });
    await f.customer.table('service_catalog').insert({ tenant, service_id: serviceId, service_name: 'Customer appointment service', description: 'Appointment assistance',
      billing_method: 'hourly', default_rate: 123456, category_id: categoryId, custom_service_type_id: serviceTypeId });
    await f.customer.table('service_catalog').insert({ tenant, service_id: randomUUID(), service_name: 'Unreferenced commercial service', billing_method: 'hourly', custom_service_type_id: serviceTypeId });
    await f.customer.table('appointment_requests').insert({ tenant, appointment_request_id: requestId, client_id: f.operation.customer_client_id, service_id: serviceId,
      ticket_id: f.resource.id, requested_date: '2026-09-08', requested_time: '09:00:00', requested_duration: 45, requester_timezone: 'America/New_York',
      status: 'approved', preferred_assigned_user_id: user, description: 'Customer booking notes', requester_name: 'Customer requester',
      online_meeting_provider: 'teams', online_meeting_id: 'never-portable-remote-meeting', online_meeting_url: 'https://provider.invalid/never-portable-join-token' });
    await f.customer.table('schedule_entries').insert({ tenant, entry_id: scheduleId, title: 'Customer appointment', work_item_id: requestId, work_item_type: 'appointment_request',
      scheduled_start: '2026-09-08T13:00:00Z', scheduled_end: '2026-09-08T13:45:00Z', status: 'scheduled', is_private: true });
    await f.customer.table('schedule_entry_assignees').insert({ tenant, entry_id: scheduleId, user_id: user });
    await f.customer.table('appointment_requests').where('appointment_request_id', requestId).update({ schedule_entry_id: scheduleId });
    await f.customer.table('availability_settings').insert({ tenant, availability_setting_id: randomUUID(), setting_type: 'general_settings',
      service_id: serviceId, config_json: { approver_user_ids: [user], approver_team_ids: [], default_duration: 45, auto_approval_enabled: true,
        auto_approval_criteria: { require_availability: true, check_conflicts: true, provider_token: 'never-portable-nested-token' }, provider_token: 'never-portable-setting-token' } });
    await f.customer.table('availability_exceptions').insert({ tenant, exception_id: randomUUID(), user_id: user, date: '2026-09-09', is_available: false, reason: 'Customer holiday absence' });
    await f.customer.table('online_meetings').insert({ tenant, meeting_id: meetingId, provider: 'teams', provider_meeting_id: 'never-portable-provider-meeting',
      provider_event_id: 'never-portable-provider-event', organizer_upn: 'never-portable-organizer@example.test', organizer_user_id: 'never-portable-organizer-id',
      subject: 'Customer joint meeting', join_url: 'https://provider.invalid/never-portable-join-token', status: 'ended', created_by: user,
      appointment_request_id: requestId, interaction_id: interactionId, schedule_entry_id: scheduleId, start_time: '2026-09-08T13:00:00Z', end_time: '2026-09-08T13:45:00Z' });
    await f.customer.table('documents').insert({ tenant, document_id: documentId, document_name: 'Customer meeting transcript', created_by: user, user_id: user });
    await f.customer.table('online_meeting_artifacts').insert({ tenant, artifact_id: artifactId, meeting_id: meetingId, artifact_type: 'transcript', document_id: documentId,
      provider_artifact_id: 'never-portable-provider-artifact', content_url: 'https://provider.invalid/never-portable-content-token' });
    await f.sponsor.table('availability_exceptions').insert({ tenant: f.principal.tenant, exception_id: randomUUID(), user_id: f.principal.userId, date: '2026-09-09', is_available: false, reason: 'MSP private absence' });
    return { ...f, db, interactionId, requestId, scheduleId, meetingId, artifactId, documentId, serviceId,
      exportRecords: () => exportCoManagedPortableEngagement(db, f.customerPrincipal, randomUUID()) };
  };

  it('portable engagement export retains customer bookings availability and meeting metadata without provider credentials or commercial prices', async () => {
    const f = await setup(), result = await f.exportRecords();
    expect(result.records.interactions[0]).toMatchObject({ interaction_id: f.interactionId, notes: 'Customer interaction notes' });
    expect(result.records.appointment_requests[0]).toMatchObject({ appointment_request_id: f.requestId, description: 'Customer booking notes', service_id: f.serviceId, requester_timezone: 'America/New_York' });
    expect(result.records.online_meeting_artifacts[0]).toMatchObject({ artifact_id: f.artifactId, document_id: f.documentId, meeting_id: f.meetingId });
    expect(result.records.service_catalog).toHaveLength(1);
    expect(result.records.service_catalog[0]).toMatchObject({ service_id: f.serviceId, service_name: 'Customer appointment service' });
    expect(result.records.availability_settings[0].config_json).toMatchObject({ approver_user_ids: [f.actor.userId], default_duration: 45 });
    const serialized = JSON.stringify(result);
    for (const excluded of ['never-portable-', 'Unreferenced commercial service', 'MSP private absence', 'default_rate', 'provider_event_id', 'join_url', 'content_url', 'co_managed_meeting_creation_operations']) expect(serialized).not.toContain(excluded);
    const { sha256, ...payload } = result;
    expect(sha256).toBe(createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
    const broken = structuredClone(result.records); broken.service_catalog = [];
    expect(() => validateCoManagedPortableEngagementRecords(broken)).toThrow();
    const forged = structuredClone(result.records); forged.availability_settings[0].config_json.provider_token = 'injected';
    expect(() => validateCoManagedPortableEngagementRecords(forged)).toThrow();
  });

  it('portable engagement export denies private meeting ownership and current settings permission or session loss', async () => {
    const f = await setup();
    await f.customer.table('schedule_entry_assignees').where('entry_id', f.scheduleId).delete();
    await expect(f.exportRecords()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    await f.customer.table('schedule_entry_assignees').insert({ tenant: f.actor.tenant, entry_id: f.scheduleId, user_id: f.actor.userId });
    const permission = await f.customer.table('permissions').where({ resource: 'system_settings', action: 'read', msp: true }).first();
    const grants = await f.customer.table('role_permissions').where('permission_id', permission.permission_id);
    await f.customer.table('role_permissions').where('permission_id', permission.permission_id).delete();
    await expect(f.exportRecords()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
    await f.customer.table('role_permissions').insert(grants);
    await f.customer.table('sessions').where('session_id', f.customerPrincipal.sessionId).update({ expires_at: new Date(Date.now() - 1000) });
    await expect(f.exportRecords()).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
  });

  it('portable engagement export rejects a meeting changed after capture before native retention', async () => {
    const f = await setup();
    let reached!: () => void, resume!: () => void;
    const ready = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { resume = resolve; });
    const original = meetingAdmission.retainNativeOnlineMeeting;
    const spy = vi.spyOn(meetingAdmission, 'retainNativeOnlineMeeting').mockImplementation(async (...args) => {
      if (args[3] === f.meetingId) { reached(); await gate; }
      return original(...args);
    });
    const outcome = f.exportRecords().then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    try {
      await Promise.race([ready, outcome.then(result => { throw result.error ?? new Error('Export finished before meeting gate'); })]);
      await f.db.transaction(async (trx: Knex.Transaction) => {
        await trx.raw("SET LOCAL lock_timeout = '2s'");
        await trx('online_meetings').where({ tenant: f.actor.tenant, meeting_id: f.meetingId }).update({ subject: 'Changed meeting ownership context', interaction_id: null });
      });
      resume();
      const result = await outcome;
      expect(result.value).toBeUndefined(); expect(result.error).toMatchObject({ code: '40001' });
    } finally { resume(); spy.mockRestore(); await outcome; }
  });
}
