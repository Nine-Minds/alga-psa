import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Behavioral tests for the E3 meeting lifecycle in the appointment request
 * actions: attendees on approval meetings (T024-T026, T029), approval failure
 * semantics (T042/T043/T046), decline Graph cleanup via the cancel_pending +
 * cleanup-job flow (T033-T035), and the "Generate Teams meeting" retry action
 * (T044).
 */

const hoisted = vi.hoisted(() => {
  type Row = Record<string, any>;

  const tables = new Map<string, Row[]>();

  function rows(table: string): Row[] {
    if (!tables.has(table)) {
      tables.set(table, []);
    }
    return tables.get(table)!;
  }

  function stripAlias(tableExpr: string): string {
    return tableExpr.split(/\s+as\s+/i)[0].trim();
  }

  function buildQuery(tableName: string) {
    const filters: Array<(row: Row) => boolean> = [];
    const matches = (row: Row) => filters.every((filter) => filter(row));
    const chain: any = {
      where(cond: Row) {
        filters.push((row) => Object.entries(cond).every(([key, value]) => row[key] === value));
        return chain;
      },
      andWhere(cond: any) {
        return chain.where(cond);
      },
      whereIn(col: string, vals: any[]) {
        filters.push((row) => vals.includes(row[col]));
        return chain;
      },
      whereNot(cond: Row) {
        filters.push((row) => !Object.entries(cond).every(([key, value]) => row[key] === value));
        return chain;
      },
      whereNotIn(col: string, vals: any[]) {
        filters.push((row) => !vals.includes(row[col]));
        return chain;
      },
      whereNotNull(col: string) {
        filters.push((row) => row[col] !== null && row[col] !== undefined);
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit() {
        return chain;
      },
      select(..._cols: any[]) {
        return chain;
      },
      then(resolve: any, reject: any) {
        return Promise.resolve(rows(tableName).filter(matches).map((row: Row) => ({ ...row }))).then(
          resolve,
          reject,
        );
      },
      async first(..._cols: any[]) {
        const row = rows(tableName).find(matches);
        return row ? { ...row } : undefined;
      },
      async update(data: Row) {
        let count = 0;
        for (const row of rows(tableName)) {
          if (matches(row)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return count;
      },
      async insert(data: Row | Row[]) {
        const list = Array.isArray(data) ? data : [data];
        rows(tableName).push(...list.map((row) => ({ ...row })));
        return list.length;
      },
      async delete() {
        const arr = rows(tableName);
        let count = 0;
        for (let i = arr.length - 1; i >= 0; i -= 1) {
          if (matches(arr[i])) {
            arr.splice(i, 1);
            count += 1;
          }
        }
        return count;
      },
    };
    return chain;
  }

  const fakeDb = {
    tables,
    rows,
    reset() {
      tables.clear();
    },
    seed(table: string, seedRows: Row[]) {
      tables.set(table, seedRows.map((row) => ({ ...row })));
    },
  };

  const tenantDbMock = (_conn: any, _tenant: string) => ({
    table: (tableExpr: string) => buildQuery(stripAlias(tableExpr)),
    unscoped: (tableExpr: string) => buildQuery(stripAlias(tableExpr)),
    tenantJoin: (query: any) => query,
  });

  const user = {
    user_id: 'approver-1',
    tenant: 'tenant-1',
    user_type: 'internal',
    email: 'approver@example.test',
    first_name: 'App',
    last_name: 'Rover',
    roles: [],
  };

  return {
    fakeDb,
    tenantDbMock,
    user,
    hasPermissionMock: vi.fn(async () => true),
    createTeamsMeetingWithResultMock: vi.fn(),
    updateTeamsMeetingWithResultMock: vi.fn(),
    deleteTeamsMeetingWithResultMock: vi.fn(),
    getTeamsMeetingCapabilityMock: vi.fn(),
    scheduleJobMock: vi.fn(async () => ({ jobId: 'job-1', externalId: 'ext-1' })),
    publishEventMock: vi.fn(async () => undefined),
    publishWorkflowEventMock: vi.fn(async () => undefined),
    sendApprovedEmailMock: vi.fn(async () => undefined),
    sendAssignedEmailMock: vi.fn(async () => undefined),
    sendDeclinedEmailMock: vi.fn(async () => undefined),
    createInteractionMock: vi.fn(async () => ({
      interaction: { interaction_id: 'interaction-1' },
      publishSideEffects: async () => undefined,
    })),
  };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: unknown[]) => fn(hoisted.user, { tenant: 'tenant-1' }, ...args),
  hasPermission: hoisted.hasPermissionMock,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
  tenantDb: hoisted.tenantDbMock,
  withTransaction: async (_knex: any, cb: any) => cb({}),
  resolveEffectiveTimeZone: vi.fn(async () => 'UTC'),
  User: { getReportsToSubordinateIds: vi.fn(async () => []) },
}));

vi.mock('@alga-psa/email', () => ({
  SystemEmailService: {
    getInstance: () => ({
      sendAppointmentRequestApproved: hoisted.sendApprovedEmailMock,
      sendAppointmentAssignedNotification: hoisted.sendAssignedEmailMock,
      sendAppointmentRequestDeclined: hoisted.sendDeclinedEmailMock,
      sendEmail: vi.fn(async () => undefined),
    }),
  },
}));

vi.mock('@alga-psa/shared/models/scheduleEntry', () => ({
  default: {
    create: vi.fn(async () => ({ entry_id: 'entry-created-1' })),
  },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: hoisted.publishEventMock,
  publishWorkflowEvent: hoisted.publishWorkflowEventMock,
}));

vi.mock('@alga-psa/workflow-streams', () => ({
  buildAppointmentAssignedPayload: (value: unknown) => value,
  buildAppointmentCreatedPayload: (value: unknown) => value,
}));

vi.mock('@alga-psa/scheduling/actions/appointmentHelpers', () => ({
  getTenantSettings: vi.fn(async () => ({ contactEmail: 'help@example.test', contactPhone: '555' })),
  generateICSLink: vi.fn(async () => 'https://example.test/calendar.ics'),
  getRequestNewAppointmentLink: vi.fn(async () => 'https://example.test/book'),
  getClientUserIdFromContact: vi.fn(async () => null),
  formatDate: vi.fn(async (value: string) => value),
  formatTime: vi.fn(async (value: string) => value),
}));

vi.mock('@alga-psa/scheduling/utils/icsGenerator', () => ({
  generateICSBuffer: vi.fn(() => Buffer.from('ics')),
  generateICSFilename: vi.fn(() => 'appointment.ics'),
}));

vi.mock('@alga-psa/scheduling/lib/teamsMeetingService', () => ({
  resolveTeamsMeetingService: vi.fn(async () => ({
    getTeamsMeetingCapability: hoisted.getTeamsMeetingCapabilityMock,
    createTeamsMeetingWithResult: hoisted.createTeamsMeetingWithResultMock,
    updateTeamsMeetingWithResult: hoisted.updateTeamsMeetingWithResultMock,
    deleteTeamsMeetingWithResult: hoisted.deleteTeamsMeetingWithResultMock,
    createTeamsMeeting: vi.fn(),
    updateTeamsMeeting: vi.fn(),
    deleteTeamsMeeting: vi.fn(),
    fetchMeetingArtifacts: vi.fn(async () => []),
  })),
}));

// The cleanup job is enqueued through the @alga-psa/core DI seam (not a direct
// @alga-psa/jobs import, which would create a scheduling <-> jobs cycle). Mock
// just that seam so the enqueue is observable.
vi.mock('@alga-psa/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/core')>()),
  enqueueImmediateJob: hoisted.scheduleJobMock,
}));

vi.mock('@alga-psa/clients/actions/interactionCreateHelper', () => ({
  createInteractionWithSideEffects: hoisted.createInteractionMock,
}));

import {
  approveAppointmentRequest,
  declineAppointmentRequest,
  generateTeamsMeetingForApprovedRequest,
  updateAppointmentRequestDateTime,
} from '@alga-psa/scheduling/actions/appointmentRequestManagementActions';

const TENANT = 'tenant-1';
const REQ_ID = '11111111-1111-4111-8111-111111111111';
const TECH_ID = '22222222-2222-4222-8222-222222222222';
const SVC_ID = '33333333-3333-4333-8333-333333333333';
const CONTACT_ID = '44444444-4444-4444-8444-444444444444';
const CLIENT_ID = '55555555-5555-4555-8555-555555555555';
const ENTRY_ID = '66666666-6666-4666-8666-666666666666';
const MEETING_ROW_ID = '77777777-7777-4777-8777-777777777777';
const FAILED_ROW_ID = '88888888-8888-4888-8888-888888888888';
const NEW_TECH_ID = '99999999-9999-4999-8999-999999999999';

function seedBaseline(overrides: { request?: Record<string, any> } = {}) {
  hoisted.fakeDb.reset();
  hoisted.fakeDb.seed('appointment_requests', [
    {
      tenant: TENANT,
      appointment_request_id: REQ_ID,
      status: 'pending',
      service_id: SVC_ID,
      requested_date: '2026-07-10',
      requested_time: '14:00',
      requested_duration: 60,
      requester_timezone: 'UTC',
      is_authenticated: true,
      client_id: CLIENT_ID,
      contact_id: CONTACT_ID,
      requester_email: 'requester@example.test',
      requester_name: 'Rita Requester',
      schedule_entry_id: ENTRY_ID,
      ticket_id: null,
      online_meeting_provider: null,
      online_meeting_url: null,
      online_meeting_id: null,
      description: 'Printer maintenance visit',
      ...(overrides.request ?? {}),
    },
  ]);
  hoisted.fakeDb.seed('users', [
    {
      tenant: TENANT,
      user_id: TECH_ID,
      email: 'tech@example.test',
      first_name: 'Tess',
      last_name: 'Tech',
      phone: '555-1',
      user_type: 'internal',
      is_inactive: false,
    },
  ]);
  hoisted.fakeDb.seed('service_catalog', [
    { tenant: TENANT, service_id: SVC_ID, service_name: 'Network Support' },
  ]);
  hoisted.fakeDb.seed('contacts', [
    { tenant: TENANT, contact_name_id: CONTACT_ID, email: 'client@example.test', full_name: 'Cli Ent' },
  ]);
  hoisted.fakeDb.seed('schedule_entries', [
    {
      tenant: TENANT,
      entry_id: ENTRY_ID,
      scheduled_start: '2026-07-10T14:00:00.000Z',
      scheduled_end: '2026-07-10T15:00:00.000Z',
      title: '[Pending Request] Network Support',
    },
  ]);
  hoisted.fakeDb.seed('schedule_entry_assignees', [
    { tenant: TENANT, entry_id: ENTRY_ID, user_id: TECH_ID },
  ]);
  hoisted.fakeDb.seed('system_interaction_types', [
    { type_id: 'type-online-meeting', type_name: 'Online Meeting' },
  ]);
  hoisted.fakeDb.seed('online_meetings', []);
  hoisted.fakeDb.seed('clients', [
    { tenant: TENANT, client_id: CLIENT_ID, client_name: 'Acme Corp' },
  ]);
}

function createdOutcome() {
  return {
    status: 'created' as const,
    meeting: {
      joinWebUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
      meetingId: 'graph-meeting-1',
      organizerUpn: 'organizer@example.test',
      organizerUserId: 'organizer-object-1',
      eventId: 'graph-event-1',
    },
  };
}

describe('appointment request meeting lifecycle (E3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedBaseline();
    hoisted.hasPermissionMock.mockResolvedValue(true);
    hoisted.getTeamsMeetingCapabilityMock.mockResolvedValue({ available: true, recordingsAvailable: true });
    hoisted.createTeamsMeetingWithResultMock.mockResolvedValue(createdOutcome());
    hoisted.updateTeamsMeetingWithResultMock.mockResolvedValue({ status: 'updated' });
    hoisted.deleteTeamsMeetingWithResultMock.mockResolvedValue({ status: 'deleted', alreadyDeleted: false });
  });

  it('T024/T025: approval passes the client contact and assigned technician as required attendees', async () => {
    const result = await approveAppointmentRequest({
      appointment_request_id: REQ_ID,
      assigned_user_id: TECH_ID,
      generate_teams_meeting: true,
    });

    expect(result.success).toBe(true);
    expect(hoisted.createTeamsMeetingWithResultMock).toHaveBeenCalledTimes(1);
    const input = hoisted.createTeamsMeetingWithResultMock.mock.calls[0][0];
    expect(input.attendees).toEqual([
      { emailAddress: { address: 'client@example.test', name: 'Cli Ent' }, type: 'required' },
      { emailAddress: { address: 'tech@example.test', name: 'Tess Tech' }, type: 'required' },
    ]);
  });

  it('T029: created event subject and body carry the appointment context and a PSA link', async () => {
    await approveAppointmentRequest({
      appointment_request_id: REQ_ID,
      assigned_user_id: TECH_ID,
      generate_teams_meeting: true,
    });

    const input = hoisted.createTeamsMeetingWithResultMock.mock.calls[0][0];
    expect(input.subject).toBe('Appointment: Network Support');
    expect(input.bodyHtml).toContain('Network Support');
    expect(input.bodyHtml).toContain(`/msp/schedule?requestId=${REQ_ID}`);
    expect(input.bodyHtml).toContain('Printer maintenance visit');
  });

  it('T026: approval succeeds attendee-empty-safe when the contact email is missing', async () => {
    seedBaseline({ request: { is_authenticated: false, contact_id: null, requester_email: null, requester_name: null } });

    const result = await approveAppointmentRequest({
      appointment_request_id: REQ_ID,
      assigned_user_id: TECH_ID,
      generate_teams_meeting: true,
    });

    expect(result.success).toBe(true);
    const input = hoisted.createTeamsMeetingWithResultMock.mock.calls[0][0];
    expect(input.attendees).toEqual([
      { emailAddress: { address: 'tech@example.test', name: 'Tess Tech' }, type: 'required' },
    ]);
  });

  it('stores the created meeting and join link on approval', async () => {
    const result = await approveAppointmentRequest({
      appointment_request_id: REQ_ID,
      assigned_user_id: TECH_ID,
      generate_teams_meeting: true,
    });

    expect(result.success).toBe(true);
    const meetingRows = hoisted.fakeDb.rows('online_meetings');
    expect(meetingRows).toHaveLength(1);
    expect(meetingRows[0]).toMatchObject({
      provider: 'teams',
      provider_meeting_id: 'graph-meeting-1',
      status: 'scheduled',
      appointment_request_id: REQ_ID,
    });
    const request = hoisted.fakeDb.rows('appointment_requests')[0];
    expect(request).toMatchObject({
      status: 'approved',
      online_meeting_url: 'https://teams.microsoft.com/l/meetup-join/abc',
      online_meeting_id: 'graph-meeting-1',
    });
  });

  it('T042: aborts the approval with meetingCreationFailed when Graph creation fails', async () => {
    hoisted.createTeamsMeetingWithResultMock.mockResolvedValue({
      status: 'failed',
      errorCode: 'graph_server_error',
      errorMessage: 'boom',
    });

    const result = await approveAppointmentRequest({
      appointment_request_id: REQ_ID,
      assigned_user_id: TECH_ID,
      generate_teams_meeting: true,
    });

    expect(result.success).toBe(false);
    expect(result.meetingCreationFailed).toBe(true);
    // The request was NOT approved and no approval email was sent.
    expect(hoisted.fakeDb.rows('appointment_requests')[0].status).toBe('pending');
    expect(hoisted.sendApprovedEmailMock).not.toHaveBeenCalled();
  });

  it('T043/T046: approve_without_meeting completes the approval, sends a link-less email, and persists a failed online_meetings row', async () => {
    hoisted.createTeamsMeetingWithResultMock.mockResolvedValue({
      status: 'failed',
      errorCode: 'graph_throttled',
      errorMessage: 'throttled',
    });

    const result = await approveAppointmentRequest({
      appointment_request_id: REQ_ID,
      assigned_user_id: TECH_ID,
      generate_teams_meeting: true,
      approve_without_meeting: true,
    });

    expect(result.success).toBe(true);
    expect(result.teamsMeetingWarning).toContain('without a Microsoft Teams meeting');
    expect(hoisted.fakeDb.rows('appointment_requests')[0].status).toBe('approved');

    const meetingRows = hoisted.fakeDb.rows('online_meetings');
    expect(meetingRows).toHaveLength(1);
    expect(meetingRows[0]).toMatchObject({
      status: 'failed',
      error_code: 'graph_throttled',
      provider_meeting_id: null,
      join_url: null,
      appointment_request_id: REQ_ID,
    });

    // Approval email went out without a join link.
    expect(hoisted.sendApprovedEmailMock).toHaveBeenCalledTimes(1);
    expect(hoisted.sendApprovedEmailMock.mock.calls[0][0].onlineMeetingUrl).toBeUndefined();
  });

  it('skipped meeting creation approves with the reason-specific warning', async () => {
    hoisted.createTeamsMeetingWithResultMock.mockResolvedValue({ status: 'skipped', reason: 'no_organizer' });

    const result = await approveAppointmentRequest({
      appointment_request_id: REQ_ID,
      assigned_user_id: TECH_ID,
      generate_teams_meeting: true,
    });

    expect(result.success).toBe(true);
    expect(result.teamsMeetingWarning).toContain('no default organizer');
    expect(hoisted.fakeDb.rows('online_meetings')).toHaveLength(0);
  });

  it('T033/T035: declining an approved request marks the meeting cancel_pending and enqueues the cleanup job', async () => {
    seedBaseline({ request: { status: 'approved' } });
    hoisted.fakeDb.seed('online_meetings', [
      {
        tenant: TENANT,
        meeting_id: MEETING_ROW_ID,
        provider: 'teams',
        provider_meeting_id: 'graph-meeting-1',
        provider_event_id: 'graph-event-1',
        status: 'scheduled',
        appointment_request_id: REQ_ID,
      },
    ]);

    const result = await declineAppointmentRequest({
      appointment_request_id: REQ_ID,
      decline_reason: 'Technician unavailable',
    });

    expect(result.success).toBe(true);
    expect(hoisted.fakeDb.rows('online_meetings')[0].status).toBe('cancel_pending');
    expect(hoisted.scheduleJobMock).toHaveBeenCalledWith(
      'teams-meeting-cleanup',
      { tenantId: TENANT, meetingId: MEETING_ROW_ID },
    );
    expect(hoisted.fakeDb.rows('appointment_requests')[0].status).toBe('declined');
  });

  it('T034: declining a never-approved request performs no Graph cleanup', async () => {
    const result = await declineAppointmentRequest({
      appointment_request_id: REQ_ID,
      decline_reason: 'Not available',
    });

    expect(result.success).toBe(true);
    expect(hoisted.scheduleJobMock).not.toHaveBeenCalled();
    expect(hoisted.deleteTeamsMeetingWithResultMock).not.toHaveBeenCalled();
  });

  it('T044: the retry action creates the meeting, updates the failed row, and stores the URL on the request', async () => {
    seedBaseline({ request: { status: 'approved' } });
    hoisted.fakeDb.seed('online_meetings', [
      {
        tenant: TENANT,
        meeting_id: FAILED_ROW_ID,
        provider: 'teams',
        provider_meeting_id: null,
        provider_event_id: null,
        join_url: null,
        status: 'failed',
        error_code: 'graph_server_error',
        appointment_request_id: REQ_ID,
      },
    ]);

    const result = await generateTeamsMeetingForApprovedRequest(REQ_ID);

    expect(result.success).toBe(true);
    expect(hoisted.createTeamsMeetingWithResultMock).toHaveBeenCalledTimes(1);
    const input = hoisted.createTeamsMeetingWithResultMock.mock.calls[0][0];
    expect(input.attendees).toEqual([
      { emailAddress: { address: 'client@example.test', name: 'Cli Ent' }, type: 'required' },
      { emailAddress: { address: 'tech@example.test', name: 'Tess Tech' }, type: 'required' },
    ]);

    const meetingRows = hoisted.fakeDb.rows('online_meetings');
    expect(meetingRows).toHaveLength(1);
    expect(meetingRows[0]).toMatchObject({
      meeting_id: FAILED_ROW_ID,
      status: 'scheduled',
      provider_meeting_id: 'graph-meeting-1',
      join_url: 'https://teams.microsoft.com/l/meetup-join/abc',
      error_code: null,
    });

    expect(hoisted.fakeDb.rows('appointment_requests')[0]).toMatchObject({
      online_meeting_url: 'https://teams.microsoft.com/l/meetup-join/abc',
      online_meeting_id: 'graph-meeting-1',
    });
  });

  it('T045-adjacent: the retry action refuses requests that already have a link', async () => {
    seedBaseline({ request: { status: 'approved', online_meeting_url: 'https://teams.microsoft.com/existing' } });

    const result = await generateTeamsMeetingForApprovedRequest(REQ_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain('already has a meeting link');
    expect(hoisted.createTeamsMeetingWithResultMock).not.toHaveBeenCalled();
  });

  it('T031: rescheduling refreshes the technician attendee to the current assignee and PATCHes subject + attendees', async () => {
    seedBaseline({ request: { status: 'approved' } });
    // The assignment changed since approval: entry now belongs to a new tech.
    hoisted.fakeDb.seed('users', [
      {
        tenant: TENANT,
        user_id: TECH_ID,
        email: 'tech@example.test',
        first_name: 'Tess',
        last_name: 'Tech',
        user_type: 'internal',
        is_inactive: false,
      },
      {
        tenant: TENANT,
        user_id: NEW_TECH_ID,
        email: 'newtech@example.test',
        first_name: 'Nia',
        last_name: 'Newtech',
        user_type: 'internal',
        is_inactive: false,
      },
    ]);
    hoisted.fakeDb.seed('schedule_entry_assignees', [
      { tenant: TENANT, entry_id: ENTRY_ID, user_id: NEW_TECH_ID },
    ]);
    hoisted.fakeDb.seed('online_meetings', [
      {
        tenant: TENANT,
        meeting_id: MEETING_ROW_ID,
        provider: 'teams',
        provider_meeting_id: 'graph-meeting-1',
        provider_event_id: 'graph-event-1',
        status: 'scheduled',
        appointment_request_id: REQ_ID,
        interaction_id: null,
      },
    ]);

    const result = await updateAppointmentRequestDateTime({
      appointment_request_id: REQ_ID,
      new_date: '2026-07-11',
      new_time: '10:00',
    });

    expect(result.success).toBe(true);
    expect(result.teamsMeetingWarning).toBeUndefined();
    expect(hoisted.updateTeamsMeetingWithResultMock).toHaveBeenCalledTimes(1);
    const input = hoisted.updateTeamsMeetingWithResultMock.mock.calls[0][0];
    expect(input.subject).toBe('Appointment: Network Support');
    expect(input.startDateTime).toBe('2026-07-11T10:00:00.000Z');
    expect(input.attendees).toEqual([
      { emailAddress: { address: 'client@example.test', name: 'Cli Ent' }, type: 'required' },
      { emailAddress: { address: 'newtech@example.test', name: 'Nia Newtech' }, type: 'required' },
    ]);
  });

  it('T032: a failed Graph reschedule surfaces the manual-update warning', async () => {
    seedBaseline({ request: { status: 'approved' } });
    hoisted.fakeDb.seed('online_meetings', [
      {
        tenant: TENANT,
        meeting_id: MEETING_ROW_ID,
        provider: 'teams',
        provider_meeting_id: 'graph-meeting-1',
        provider_event_id: 'graph-event-1',
        status: 'scheduled',
        appointment_request_id: REQ_ID,
        interaction_id: null,
      },
    ]);
    hoisted.updateTeamsMeetingWithResultMock.mockResolvedValue({
      status: 'failed',
      errorCode: 'graph_server_error',
      errorMessage: 'boom',
    });

    const result = await updateAppointmentRequestDateTime({
      appointment_request_id: REQ_ID,
      new_date: '2026-07-11',
      new_time: '10:00',
    });

    expect(result.success).toBe(true);
    expect(result.teamsMeetingWarning).toContain('could not be rescheduled');
  });
});
