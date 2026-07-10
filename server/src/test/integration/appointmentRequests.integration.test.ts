import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { formatInTimeZone } from 'date-fns-tz';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { setupCommonMocks, createMockUser, setMockUser } from '../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;
let createAppointmentRequest: typeof import('@alga-psa/client-portal/actions').createAppointmentRequest;
let approveAppointmentRequest: typeof import('@alga-psa/scheduling/actions').approveAppointmentRequest;
let declineAppointmentRequest: typeof import('@alga-psa/scheduling/actions').declineAppointmentRequest;
let deleteScheduleEntry: typeof import('@alga-psa/scheduling/actions').deleteScheduleEntry;
let scheduleTeamsMeeting: typeof import('@alga-psa/scheduling/actions').scheduleTeamsMeeting;

const enterpriseState = vi.hoisted(() => ({ value: true }));
const teamsMeetingCapabilityMock = vi.hoisted(() => vi.fn());
const createTeamsMeetingMock = vi.hoisted(() => vi.fn());
const updateTeamsMeetingMock = vi.hoisted(() => vi.fn());
const deleteTeamsMeetingMock = vi.hoisted(() => vi.fn());
const createTeamsMeetingWithResultMock = vi.hoisted(() => vi.fn());
const updateTeamsMeetingWithResultMock = vi.hoisted(() => vi.fn());
const deleteTeamsMeetingWithResultMock = vi.hoisted(() => vi.fn());
const scheduleJobMock = vi.hoisted(() => vi.fn());

const STAFF_USER_ID = '00000000-0000-0000-0000-000000000101';
const STAFF_USER_2_ID = '00000000-0000-0000-0000-000000000102';

type CreatedIds = {
  serviceTypeId?: string;
  serviceId?: string;
  clientId?: string;
  contactId?: string;
  userId?: string;
  clientUserId?: string;
  technicianUserId?: string;
  appointmentRequestId?: string;
  scheduleEntryId?: string;
  interactionId?: string;
  onlineMeetingId?: string;
  contractId?: string;
  clientContractId?: string;
  contractLineId?: string;
  availabilitySettingIds: string[];
};
let createdIds: CreatedIds = { availabilitySettingIds: [] };

function tenantTableFor(connection: Knex, tenant: string, table: string) {
  return tenantDb(connection, tenant).table(table);
}

function tenantRows(connection: Knex) {
  return tenantDb(connection, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

function globalTableFor(connection: Knex, table: string, reason: string) {
  return tenantDb(connection, '__test_global_catalog__').unscoped(table, reason);
}

async function insertServiceType(
  db: Knex,
  values: {
    id: string;
    tenant: string;
    name: string;
    order_number: number;
  }
) {
  const hasBillingMethod = await db.schema.hasColumn('service_types', 'billing_method');
  await tenantTableFor(db, values.tenant, 'service_types').insert({
    ...values,
    ...(hasBillingMethod ? { billing_method: 'fixed' } : {}),
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
}

async function ensureStaffUser(db: Knex, tenant: string) {
  await tenantTableFor(db, tenant, 'users')
    .insert({
      tenant,
      user_id: STAFF_USER_ID,
      username: 'staff_online_meeting_test',
      first_name: 'Staff',
      last_name: 'User',
      email: 'staff-online-meeting-test@example.com',
      hashed_password: 'hashed',
      user_type: 'internal',
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    })
    .onConflict(['tenant', 'user_id'])
    .merge({
      is_inactive: false,
      updated_at: db.fn.now()
    });
}

// Mock the database module to return test database
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
    getTenantContext: vi.fn(() => ({ tenant: tenantId })),
  };
});

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn())
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null)
}));

vi.mock('@alga-psa/core/features', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/core/features')>('@alga-psa/core/features');
  return {
    ...actual,
    get isEnterprise() {
      return enterpriseState.value;
    }
  };
});

vi.mock('@alga-psa/licensing', () => ({
  getLicenseStateRow: vi.fn(async () => null),
  resolveSelfHostTier: vi.fn(() => null),
}));

// Mock SystemEmailService to prevent actual email sending
const mockEmailInstance = {
  sendAppointmentRequestReceived: vi.fn(() => Promise.resolve()),
  sendNewAppointmentRequest: vi.fn(() => Promise.resolve()),
  sendAppointmentRequestApproved: vi.fn(() => Promise.resolve()),
  sendAppointmentAssignedNotification: vi.fn(() => Promise.resolve()),
  sendAppointmentRequestDeclined: vi.fn(() => Promise.resolve()),
  sendEmail: vi.fn(() => Promise.resolve())
};

vi.mock('@alga-psa/email', () => ({
  SystemEmailService: {
    getInstance: vi.fn(() => mockEmailInstance)
  }
}));

// Mock event bus to prevent actual event publishing
vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(() => Promise.resolve())
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(() => Promise.resolve()),
  publishWorkflowEvent: vi.fn(() => Promise.resolve())
}));

// Mock internal notification actions
vi.mock('@alga-psa/notifications/actions', () => ({
  createNotificationFromTemplateInternal: vi.fn(() => Promise.resolve())
}));

vi.mock('@alga-psa/scheduling/lib/teamsMeetingService', () => ({
  resolveTeamsMeetingService: vi.fn(async () => ({
    getTeamsMeetingCapability: teamsMeetingCapabilityMock,
    createTeamsMeeting: createTeamsMeetingMock,
    updateTeamsMeeting: updateTeamsMeetingMock,
    deleteTeamsMeeting: deleteTeamsMeetingMock,
    createTeamsMeetingWithResult: createTeamsMeetingWithResultMock,
    updateTeamsMeetingWithResult: updateTeamsMeetingWithResultMock,
    deleteTeamsMeetingWithResult: deleteTeamsMeetingWithResultMock,
  })),
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib', () => ({
  deleteTeamsMeeting: deleteTeamsMeetingMock,
  deleteTeamsMeetingWithResult: deleteTeamsMeetingWithResultMock,
}));

// Decline/cancel no longer delete the Graph event inline: they flip the
// online_meetings row to cancel_pending and enqueue 'teams-meeting-cleanup'.
// Mock the runner accessor so enqueues are observable and never hit the real
// (unregistered) accessor.
vi.mock('@alga-psa/jobs/runner', () => ({
  registerJobRunnerAccessor: vi.fn(),
  getJobRunner: vi.fn(async () => ({ scheduleJob: scheduleJobMock })),
}));

// The cleanup job is enqueued through the @alga-psa/core DI seam (not a direct
// @alga-psa/jobs import, which would create a scheduling <-> jobs cycle).
vi.mock('@alga-psa/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/core')>()),
  enqueueImmediateJob: scheduleJobMock,
}));

// Mock appointment helpers
vi.mock('@alga-psa/scheduling/actions', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/scheduling/actions')>('@alga-psa/scheduling/actions');
  return {
    ...actual,
    getTenantSettings: vi.fn(() => Promise.resolve({
      contactEmail: 'support@test.com',
      contactPhone: '555-1234',
      tenantName: 'Test Tenant'
    })),
    getScheduleApprovers: vi.fn(() => Promise.resolve([
      { user_id: 'approver-1', email: 'approver1@test.com' }
    ])),
    getClientUserIdFromContact: vi.fn(() => Promise.resolve('client-user-id')),
    formatDate: vi.fn((date: string) => Promise.resolve(date)),
    formatTime: vi.fn((time: string) => Promise.resolve(time)),
    getClientCompanyName: vi.fn(() => Promise.resolve('Test Client Company')),
    generateICSLink: vi.fn(() => Promise.resolve('https://calendar.example.com/event.ics')),
    getRequestNewAppointmentLink: vi.fn(() => Promise.resolve('https://example.com/appointments'))
  };
});

describe('Appointment Request Integration Tests', () => {
  const resetIntegrationMocks = () => {
    enterpriseState.value = true;
    teamsMeetingCapabilityMock.mockResolvedValue({ available: true });
    createTeamsMeetingMock.mockResolvedValue({
      joinWebUrl: 'https://teams.example.com/meeting/123',
      meetingId: 'meeting-123',
      organizerUpn: 'organizer@example.com',
      organizerUserId: 'organizer-object-1',
      eventId: 'event-123',
    });
    updateTeamsMeetingMock.mockResolvedValue(true);
    deleteTeamsMeetingMock.mockResolvedValue(true);
    createTeamsMeetingWithResultMock.mockResolvedValue({
      status: 'created',
      meeting: {
        joinWebUrl: 'https://teams.example.com/meeting/123',
        meetingId: 'meeting-123',
        organizerUpn: 'organizer@example.com',
        organizerUserId: 'organizer-object-1',
        eventId: 'event-123',
      },
    });
    updateTeamsMeetingWithResultMock.mockResolvedValue({ status: 'updated' });
    deleteTeamsMeetingWithResultMock.mockResolvedValue({ status: 'deleted', alreadyDeleted: false });
    scheduleJobMock.mockResolvedValue({ jobId: 'job-1', externalId: 'x' });
  };

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';
    process.env.NEXT_PUBLIC_APP_URL = 'https://test.example.com';
    // teamsMeetingCleanupHandler gates its EE Graph module load on the raw
    // EDITION env (read at module load), not the mocked isEnterprise flag.
    process.env.EDITION = 'ee';

    db = await createTestDbConnection();
    tenantId = await ensureTenant(db);
    await ensureStaffUser(db, tenantId);

    // Import the actions after mocks are set up
    ({ createAppointmentRequest } = await import('@alga-psa/client-portal/actions'));
    ({ approveAppointmentRequest, declineAppointmentRequest, deleteScheduleEntry, scheduleTeamsMeeting } = await import('@alga-psa/scheduling/actions'));
  }, 120_000);

  beforeEach(() => {
    resetIntegrationMocks();
  });

  afterAll(async () => {
    await db?.destroy();
  });

  afterEach(async () => {
    if (db && tenantId) {
      await cleanupCreatedRecords(db, tenantId, createdIds);
    }
    createdIds = { availabilitySettingIds: [] };
    resetIntegrationMocks();
    vi.clearAllMocks();
  });

  describe('Create Appointment Request (Client Portal)', () => {
    it('should successfully create appointment request with all required fields', async () => {
      // Setup test data
      const { clientId, contactId, serviceId, clientUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;

      // Mock current user as client
      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({
        tenantId,
        userId: clientUserId,
        user: clientUser,
        permissionCheck: () => true
      });

      // Create appointment request
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const result = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60,
        description: 'Need help with server maintenance'
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.appointment_request_id).toBeDefined();
      expect(result.data?.client_id).toBe(clientId);
      expect(result.data?.contact_id).toBe(contactId);
      expect(result.data?.service_id).toBe(serviceId);
      expect(result.data?.status).toBe('pending');
      expect(result.data?.is_authenticated).toBe(true);
      expect(result.data?.schedule_entry_id).toBeDefined();

      createdIds.appointmentRequestId = result.data?.appointment_request_id;
      createdIds.scheduleEntryId = result.data?.schedule_entry_id;

      // Verify schedule entry was created
      const scheduleEntry = await tenantTableFor(db, tenantId, 'schedule_entries')
        .where({
          entry_id: result.data?.schedule_entry_id,
          tenant: tenantId
        })
        .first();

      expect(scheduleEntry).toBeDefined();
      expect(scheduleEntry.work_item_type).toBe('appointment_request');
      expect(scheduleEntry.work_item_id).toBe(result.data?.appointment_request_id);
      expect(scheduleEntry.status).toBe('scheduled');
    });

    it('should validate service availability', async () => {
      const { clientId, contactId, clientUserId } = await setupTestData(db, tenantId, { skipService: true });
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.clientUserId = clientUserId;

      // Create a service without any availability settings
      const serviceTypeId = uuidv4();
      await insertServiceType(db, {
        id: serviceTypeId,
        tenant: tenantId,
        name: `Service Type ${serviceTypeId.slice(0, 8)}`,
        order_number: Math.floor(Math.random() * 1000000)
      });
      createdIds.serviceTypeId = serviceTypeId;

      const serviceId = uuidv4();
      await tenantTableFor(db, tenantId, 'service_catalog').insert({
        tenant: tenantId,
        service_id: serviceId!,
        service_name: 'Unavailable Service',
        description: 'Service with no availability',
        billing_method: 'fixed',
        default_rate: 5000,
        custom_service_type_id: serviceTypeId
      });
      createdIds.serviceId = serviceId;

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const result = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      // Service exists but has no contract, should fail
      expect(result.success).toBe(false);
      expect(result.error).toContain('active contract');
    });

    it('should enforce contract requirement for services', async () => {
      const { clientId, contactId, serviceId, clientUserId } = await setupTestData(db, tenantId, { skipContract: true });
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const result = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('active contract');
    });

    it('should allow booking without contract when service allows it', async () => {
      const { clientId, contactId, serviceId, clientUserId } = await setupTestData(db, tenantId, {
        skipContract: true,
        allowWithoutContract: true
      });
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const result = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      expect(result.success).toBe(true);
      expect(result.data?.appointment_request_id).toBeDefined();

      createdIds.appointmentRequestId = result.data?.appointment_request_id;
      createdIds.scheduleEntryId = result.data?.schedule_entry_id;
    });

    it('should create email notifications', async () => {
      const { clientId, contactId, serviceId, clientUserId, technicianUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;
      createdIds.technicianUserId = technicianUserId;

      // Staff recipients come from the configured approvers (3e8a08001f);
      // without a general_settings approver row nobody is notified.
      const approverSettingId = uuidv4();
      await tenantTableFor(db, tenantId, 'availability_settings').insert({
        availability_setting_id: approverSettingId,
        tenant: tenantId,
        setting_type: 'general_settings',
        is_available: true,
        config_json: { approver_user_ids: [technicianUserId], approver_team_ids: [] },
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      createdIds.availabilitySettingIds.push(approverSettingId);

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const SystemEmailService = (await import('@alga-psa/email')).SystemEmailService;
      const emailInstance = SystemEmailService.getInstance();

      const result = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      expect(result.success).toBe(true);
      createdIds.appointmentRequestId = result.data?.appointment_request_id;
      createdIds.scheduleEntryId = result.data?.schedule_entry_id;

      // Verify email methods were called
      expect(emailInstance.sendAppointmentRequestReceived).toHaveBeenCalled();
      expect(emailInstance.sendNewAppointmentRequest).toHaveBeenCalled();
    });

    it('should create internal notifications', async () => {
      const { clientId, contactId, serviceId, clientUserId, technicianUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;
      createdIds.technicianUserId = technicianUserId;

      // Staff recipients come from the configured approvers (3e8a08001f).
      const approverSettingId = uuidv4();
      await tenantTableFor(db, tenantId, 'availability_settings').insert({
        availability_setting_id: approverSettingId,
        tenant: tenantId,
        setting_type: 'general_settings',
        is_available: true,
        config_json: { approver_user_ids: [technicianUserId], approver_team_ids: [] },
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      createdIds.availabilitySettingIds.push(approverSettingId);

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const { createNotificationFromTemplateInternal } = await import('@alga-psa/notifications/actions');

      const result = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      expect(result.success).toBe(true);
      createdIds.appointmentRequestId = result.data?.appointment_request_id;
      createdIds.scheduleEntryId = result.data?.schedule_entry_id;

      // Verify internal notification was created for both client and staff
      expect(createNotificationFromTemplateInternal).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          template_name: 'appointment-request-created-client',
          type: 'info',
          category: 'appointments'
        })
      );

      expect(createNotificationFromTemplateInternal).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          template_name: 'appointment-request-created-staff',
          type: 'info',
          category: 'appointments'
        })
      );
    });
  });

  describe('Approve Appointment Request', () => {
    it('should successfully approve request and create schedule entry', async () => {
      const { clientId, contactId, serviceId, clientUserId, technicianUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;
      createdIds.technicianUserId = technicianUserId;

      // Create appointment request as client
      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      expect(createResult.success).toBe(true);
      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      // Approve request as MSP staff
      const staffUser = createMockUser('internal', {
        user_id: STAFF_USER_ID,
        tenant: tenantId
      });
      setMockUser(staffUser, ['user_schedule:update', 'user_schedule:read']);
      setupCommonMocks({
        tenantId,
        userId: STAFF_USER_ID,
        user: staffUser,
        permissionCheck: () => true
      });

      const approveResult = await approveAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        assigned_user_id: technicianUserId
      });

      expect(approveResult.success).toBe(true);
      expect(approveResult.data?.status).toBe('approved');
      expect(approveResult.data?.approved_by_user_id).toBe(STAFF_USER_ID);
      expect(approveResult.data?.schedule_entry_id).toBeDefined();

      // Verify schedule entry was updated
      const scheduleEntry = await tenantTableFor(db, tenantId, 'schedule_entries')
        .where({
          entry_id: approveResult.data?.schedule_entry_id,
          tenant: tenantId
        })
        .first();

      expect(scheduleEntry).toBeDefined();
      expect(scheduleEntry.title).not.toContain('[Pending Request]');
      expect(scheduleEntry.title).toContain('Appointment:');

      // Verify assignee was set
      const assignee = await tenantTableFor(db, tenantId, 'schedule_entry_assignees')
        .where({
          entry_id: approveResult.data?.schedule_entry_id,
          tenant: tenantId
        })
        .first();

      expect(assignee).toBeDefined();
      expect(assignee.user_id).toBe(technicianUserId);
    });

    it('should send email to client upon approval', async () => {
      const { clientId, contactId, serviceId, clientUserId, technicianUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;
      createdIds.technicianUserId = technicianUserId;

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      const staffUser = createMockUser('internal', {
        user_id: STAFF_USER_ID,
        tenant: tenantId
      });
      setMockUser(staffUser, ['user_schedule:update', 'user_schedule:read']);
      setupCommonMocks({ tenantId, userId: STAFF_USER_ID, user: staffUser, permissionCheck: () => true });


      const SystemEmailService = (await import('@alga-psa/email')).SystemEmailService;
      const emailInstance = SystemEmailService.getInstance();

      await approveAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        assigned_user_id: technicianUserId
      });

      expect(emailInstance.sendAppointmentRequestApproved).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterEmail: expect.any(String),
          serviceName: expect.any(String)
        }),
        expect.objectContaining({
          tenantId: tenantId
        })
      );
    });

    it('should send internal notification to client', async () => {
      const { clientId, contactId, serviceId, clientUserId, technicianUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;
      createdIds.technicianUserId = technicianUserId;

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      const staffUser = createMockUser('internal', {
        user_id: STAFF_USER_ID,
        tenant: tenantId
      });
      setMockUser(staffUser, ['user_schedule:update', 'user_schedule:read']);
      setupCommonMocks({ tenantId, userId: STAFF_USER_ID, user: staffUser, permissionCheck: () => true });

      const { publishEvent } = await import('@alga-psa/event-bus/publishers');

      // Clear mocks from appointment creation
      vi.clearAllMocks();

      await approveAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        assigned_user_id: technicianUserId
      });

      // Since c43321e4cb the client's in-app notification is event-driven:
      // the action publishes APPOINTMENT_REQUEST_APPROVED (with the resolved
      // clientUserId) and internalNotificationSubscriber renders the
      // appointment-request-approved template from it.
      expect(publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'APPOINTMENT_REQUEST_APPROVED',
          payload: expect.objectContaining({
            tenantId,
            appointmentRequestId: createResult.data!.appointment_request_id,
            clientUserId
          })
        })
      );
    });

    it('should handle technician assignment', async () => {
      const { clientId, contactId, serviceId, clientUserId, technicianUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;
      createdIds.technicianUserId = technicianUserId;

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      const staffUser = createMockUser('internal', {
        user_id: STAFF_USER_ID,
        tenant: tenantId
      });
      setMockUser(staffUser, ['user_schedule:update', 'user_schedule:read']);
      setupCommonMocks({ tenantId, userId: STAFF_USER_ID, user: staffUser, permissionCheck: () => true });


      const approveResult = await approveAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        assigned_user_id: technicianUserId
      });

      expect(approveResult.success).toBe(true);

      // Verify the technician is assigned to the schedule entry
      const assignees = await tenantTableFor(db, tenantId, 'schedule_entry_assignees')
        .where({
          entry_id: approveResult.data?.schedule_entry_id,
          tenant: tenantId
        })
        .select('user_id');

      expect(assignees.length).toBe(1);
      expect(assignees[0].user_id).toBe(technicianUserId);
    });

    it('creates and stores a Teams meeting when approval opts in', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId);
      setStaffSchedulingContext(tenantId);

      const approveResult = await approveAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        assigned_user_id: fixture.technicianUserId,
        generate_teams_meeting: true,
      });

      expect(approveResult.success).toBe(true);
      expect(createTeamsMeetingWithResultMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          appointmentRequestId: fixture.appointmentRequestId,
          subject: 'Appointment: Test Service',
          attendees: expect.arrayContaining([
            expect.objectContaining({
              emailAddress: expect.objectContaining({
                address: `contact-${fixture.contactId.slice(0, 8)}@test.com`,
              }),
              type: 'required',
            }),
            expect.objectContaining({
              emailAddress: expect.objectContaining({
                address: `tech-${fixture.technicianUserId.slice(0, 8)}@test.com`,
              }),
              type: 'required',
            }),
          ]),
          bodyHtml: expect.stringContaining(`/msp/schedule?requestId=${fixture.appointmentRequestId}`),
        })
      );

      const updatedRequest = await tenantTableFor(db, tenantId, 'appointment_requests')
        .where({
          appointment_request_id: fixture.appointmentRequestId,
          tenant: tenantId,
        })
        .first();

      expect(updatedRequest.online_meeting_provider).toBe('teams');
      expect(updatedRequest.online_meeting_url).toBe('https://teams.example.com/meeting/123');
      expect(updatedRequest.online_meeting_id).toBe('meeting-123');

      const onlineMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          appointment_request_id: fixture.appointmentRequestId,
        })
        .first();

      expect(onlineMeeting).toMatchObject({
        tenant: tenantId,
        provider: 'teams',
        provider_meeting_id: 'meeting-123',
        provider_event_id: 'event-123',
        organizer_upn: 'organizer@example.com',
        organizer_user_id: 'organizer-object-1',
        join_url: 'https://teams.example.com/meeting/123',
        status: 'scheduled',
        schedule_entry_id: approveResult.data?.schedule_entry_id,
      });

      const interaction = await tenantTableFor(db, tenantId, 'interactions')
        .where({
          tenant: tenantId,
          interaction_id: onlineMeeting.interaction_id,
        })
        .first();

      const onlineMeetingType = await globalTableFor(
        db,
        'system_interaction_types',
        'global interaction type catalog lookup for appointment Teams meeting assertions'
      )
        .where({ type_name: 'Online Meeting' })
        .first();

      expect(interaction).toMatchObject({
        tenant: tenantId,
        type_id: onlineMeetingType.type_id,
        client_id: fixture.clientId,
        contact_name_id: fixture.contactId,
        user_id: STAFF_USER_ID,
        title: 'Online Meeting: Test Service',
      });
      expect(mockEmailInstance.sendAppointmentRequestApproved).toHaveBeenCalledWith(
        expect.objectContaining({
          onlineMeetingUrl: 'https://teams.example.com/meeting/123',
        }),
        expect.anything()
      );
    });

    it('deletes the orphaned Teams event when the local approval transaction fails after Graph create', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId);
      setStaffSchedulingContext(tenantId);

      const onlineMeetingType = await globalTableFor(
        db,
        'system_interaction_types',
        'global interaction type catalog lookup for appointment Teams meeting failure setup'
      )
        .where({ type_name: 'Online Meeting' })
        .first();
      expect(onlineMeetingType).toBeTruthy();

      await globalTableFor(
        db,
        'system_interaction_types',
        'global interaction type catalog mutation for appointment Teams meeting failure setup'
      )
        .where({ type_id: onlineMeetingType.type_id })
        .update({ type_name: `Online Meeting Hidden ${uuidv4()}` });

      try {
        const approveResult = await approveAppointmentRequest({
          appointment_request_id: fixture.appointmentRequestId,
          assigned_user_id: fixture.technicianUserId,
          generate_teams_meeting: true,
        });

        expect(approveResult.success).toBe(false);
        expect(approveResult.error).toContain('Online Meeting interaction type is not configured');
        expect(createTeamsMeetingWithResultMock).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId,
            appointmentRequestId: fixture.appointmentRequestId,
          })
        );
        expect(deleteTeamsMeetingMock).toHaveBeenCalledWith({
          tenantId,
          meetingId: 'meeting-123',
          eventId: 'event-123',
          appointmentRequestId: fixture.appointmentRequestId,
        });

        const updatedRequest = await tenantTableFor(db, tenantId, 'appointment_requests')
          .where({
            appointment_request_id: fixture.appointmentRequestId,
            tenant: tenantId,
          })
          .first();
        expect(updatedRequest.status).toBe('pending');
        expect(updatedRequest.online_meeting_provider).toBeNull();
        expect(updatedRequest.online_meeting_url).toBeNull();
        expect(updatedRequest.online_meeting_id).toBeNull();

        const onlineMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
          .where({
            tenant: tenantId,
            appointment_request_id: fixture.appointmentRequestId,
          })
          .first();
        expect(onlineMeeting).toBeUndefined();
      } finally {
        await globalTableFor(
          db,
          'system_interaction_types',
          'global interaction type catalog restoration after appointment Teams meeting failure setup'
        )
          .where({ type_id: onlineMeetingType.type_id })
          .update({ type_name: 'Online Meeting' });
      }
    });

    it('does not backfill legacy approved Teams appointment links into online meeting records or timeline interactions', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId);
      const approvedAt = new Date('2026-06-01T12:00:00.000Z');

      await tenantTableFor(db, tenantId, 'appointment_requests')
        .where({
          tenant: tenantId,
          appointment_request_id: fixture.appointmentRequestId,
        })
        .update({
          status: 'approved',
          approved_by_user_id: STAFF_USER_ID,
          approved_at: approvedAt,
          online_meeting_provider: 'teams',
          online_meeting_url: 'https://teams.example.com/legacy',
          online_meeting_id: 'legacy-meeting-123',
        });

      const legacyRequest = await tenantTableFor(db, tenantId, 'appointment_requests')
        .where({
          tenant: tenantId,
          appointment_request_id: fixture.appointmentRequestId,
        })
        .first();
      expect(legacyRequest.online_meeting_provider).toBe('teams');
      expect(legacyRequest.online_meeting_url).toBe('https://teams.example.com/legacy');
      expect(legacyRequest.online_meeting_id).toBe('legacy-meeting-123');

      const onlineMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          appointment_request_id: fixture.appointmentRequestId,
        })
        .first();
      expect(onlineMeeting).toBeUndefined();

      const timelineInteractions = await tenantTableFor(db, tenantId, 'interactions')
        .where({
          tenant: tenantId,
          client_id: fixture.clientId,
          contact_name_id: fixture.contactId,
        })
        .whereILike('title', 'Online Meeting:%');
      expect(timelineInteractions).toHaveLength(0);
    });

    it('skips Teams meeting creation when the toggle is off', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId);
      setStaffSchedulingContext(tenantId);

      const approveResult = await approveAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        assigned_user_id: fixture.technicianUserId,
        generate_teams_meeting: false,
      });

      expect(approveResult.success).toBe(true);
      expect(createTeamsMeetingMock).not.toHaveBeenCalled();
      expect(createTeamsMeetingWithResultMock).not.toHaveBeenCalled();

      const updatedRequest = await tenantTableFor(db, tenantId, 'appointment_requests')
        .where({
          appointment_request_id: fixture.appointmentRequestId,
          tenant: tenantId,
        })
        .first();

      expect(updatedRequest.online_meeting_provider).toBeNull();
      expect(updatedRequest.online_meeting_url).toBeNull();
      expect(updatedRequest.online_meeting_id).toBeNull();
    });

    it('returns a warning and skips Graph create when Teams capability is unavailable', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId);
      // Capability gating now lives inside the EE service: the WithResult call
      // reports 'skipped' instead of the action pre-checking capability.
      teamsMeetingCapabilityMock.mockResolvedValue({ available: false, reason: 'no_organizer' });
      createTeamsMeetingWithResultMock.mockResolvedValue({ status: 'skipped', reason: 'no_organizer' });
      setStaffSchedulingContext(tenantId);

      const approveResult = await approveAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        assigned_user_id: fixture.technicianUserId,
        generate_teams_meeting: true,
      });

      expect(approveResult.success).toBe(true);
      expect(approveResult.teamsMeetingWarning).toContain('no default organizer');
      expect(createTeamsMeetingMock).not.toHaveBeenCalled();

      const updatedRequest = await tenantTableFor(db, tenantId, 'appointment_requests')
        .where({
          appointment_request_id: fixture.appointmentRequestId,
          tenant: tenantId,
        })
        .first();

      expect(updatedRequest.online_meeting_provider).toBeNull();
      expect(updatedRequest.online_meeting_url).toBeNull();
      expect(updatedRequest.online_meeting_id).toBeNull();

      const onlineMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          appointment_request_id: fixture.appointmentRequestId,
        })
        .first();
      expect(onlineMeeting).toBeUndefined();
    });

    // T046: Graph failure surfaces at approval time — the approval ABORTS so
    // the approver can retry; a silent link-less approval is never produced.
    it('aborts the approval when Teams meeting creation fails (T046)', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId);
      createTeamsMeetingWithResultMock.mockResolvedValue({
        status: 'failed',
        errorCode: 'graph_server_error',
        errorMessage: 'Graph create failed',
      });
      setStaffSchedulingContext(tenantId);

      const approveResult = await approveAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        assigned_user_id: fixture.technicianUserId,
        generate_teams_meeting: true,
      });

      expect(approveResult.success).toBe(false);
      expect(approveResult.meetingCreationFailed).toBe(true);
      expect(approveResult.error).toContain('could not be created');
      expect(createTeamsMeetingWithResultMock).toHaveBeenCalled();
      expect(mockEmailInstance.sendAppointmentRequestApproved).not.toHaveBeenCalled();

      const updatedRequest = await tenantTableFor(db, tenantId, 'appointment_requests')
        .where({
          appointment_request_id: fixture.appointmentRequestId,
          tenant: tenantId,
        })
        .first();

      expect(updatedRequest.status).toBe('pending');
      expect(updatedRequest.online_meeting_provider).toBeNull();
      expect(updatedRequest.online_meeting_url).toBeNull();
      expect(updatedRequest.online_meeting_id).toBeNull();

      const onlineMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          appointment_request_id: fixture.appointmentRequestId,
        })
        .first();
      expect(onlineMeeting).toBeUndefined();
    });

    // T046: approve_without_meeting overrides the abort — the approval goes
    // through and the failed creation is persisted (never silent absence).
    it('approves without a meeting and records the failed creation when approve_without_meeting is set (T046)', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId);
      createTeamsMeetingWithResultMock.mockResolvedValue({
        status: 'failed',
        errorCode: 'graph_server_error',
        errorMessage: 'Graph create failed',
      });
      setStaffSchedulingContext(tenantId);

      const approveResult = await approveAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        assigned_user_id: fixture.technicianUserId,
        generate_teams_meeting: true,
        approve_without_meeting: true,
      });

      expect(approveResult.success).toBe(true);
      expect(approveResult.teamsMeetingWarning).toContain('meeting creation failed');
      expect(mockEmailInstance.sendAppointmentRequestApproved).toHaveBeenCalledWith(
        expect.not.objectContaining({
          onlineMeetingUrl: expect.anything(),
        }),
        expect.anything()
      );

      const updatedRequest = await tenantTableFor(db, tenantId, 'appointment_requests')
        .where({
          appointment_request_id: fixture.appointmentRequestId,
          tenant: tenantId,
        })
        .first();

      expect(updatedRequest.status).toBe('approved');
      expect(updatedRequest.online_meeting_provider).toBeNull();
      expect(updatedRequest.online_meeting_url).toBeNull();
      expect(updatedRequest.online_meeting_id).toBeNull();

      const onlineMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          appointment_request_id: fixture.appointmentRequestId,
        })
        .first();
      expect(onlineMeeting).toMatchObject({
        provider: 'teams',
        status: 'failed',
        error_code: 'graph_server_error',
        provider_meeting_id: null,
        provider_event_id: null,
        join_url: null,
        schedule_entry_id: approveResult.data?.schedule_entry_id,
      });
    });

    it('converts requester-local approval times to UTC before creating the Teams meeting', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId, {
        requestedDate: '2026-08-25',
        requestedTime: '14:30',
        requestedDuration: 60,
      });

      await tenantTableFor(db, tenantId, 'appointment_requests')
        .where({
          appointment_request_id: fixture.appointmentRequestId,
          tenant: tenantId,
        })
        .update({
          requester_timezone: 'America/Los_Angeles',
        });

      setStaffSchedulingContext(tenantId);

      const approveResult = await approveAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        assigned_user_id: fixture.technicianUserId,
        generate_teams_meeting: true,
      });

      expect(approveResult.success).toBe(true);
      expect(createTeamsMeetingWithResultMock).toHaveBeenCalledWith(
        expect.objectContaining({
          startDateTime: '2026-08-25T21:30:00.000Z',
          endDateTime: '2026-08-25T22:30:00.000Z',
        })
      );

      const createArgs = createTeamsMeetingWithResultMock.mock.calls.at(-1)?.[0];
      expect(formatInTimeZone(createArgs.startDateTime, 'America/Los_Angeles', 'yyyy-MM-dd HH:mm')).toBe('2026-08-25 14:30');
      expect(formatInTimeZone(createArgs.endDateTime, 'America/Los_Angeles', 'yyyy-MM-dd HH:mm')).toBe('2026-08-25 15:30');
    });
  });

  describe('Schedule Teams Meeting (MSP)', () => {
    const startDateTime = '2026-08-25T14:00:00.000Z';
    const endDateTime = '2026-08-25T14:30:00.000Z';

    async function setupMspMeetingContext() {
      const setup = await setupTestData(db, tenantId, { skipService: true });
      createdIds.clientId = setup.clientId;
      createdIds.contactId = setup.contactId;
      createdIds.clientUserId = setup.clientUserId;
      createdIds.technicianUserId = setup.technicianUserId;
      setStaffSchedulingContext(tenantId);
      return setup;
    }

    it('creates a Teams meeting for a contact/client and persists the interaction plus online_meetings row', async () => {
      const { clientId, contactId } = await setupMspMeetingContext();

      const result = await scheduleTeamsMeeting({
        subject: 'Account review',
        startDateTime,
        endDateTime,
        client_id: clientId,
        contact_name_id: contactId,
        attendees: [
          {
            emailAddress: {
              address: 'client-attendee@example.com',
              name: 'Client Attendee',
            },
            type: 'required',
          },
        ],
      });

      expect(result.success).toBe(true);
      if (!result.success) {
        throw new Error(result.error);
      }
      createdIds.onlineMeetingId = result.data.meeting_id;
      createdIds.interactionId = result.data.interaction_id;

      expect(createTeamsMeetingMock).toHaveBeenCalledWith({
        tenantId,
        subject: 'Account review',
        startDateTime,
        endDateTime,
        appointmentRequestId: null,
        attendees: [
          {
            emailAddress: {
              address: 'client-attendee@example.com',
              name: 'Client Attendee',
            },
            type: 'required',
          },
        ],
      });
      expect(createTeamsMeetingMock.mock.calls[0][0]).not.toHaveProperty('organizerUpn');

      const onlineMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          meeting_id: result.data.meeting_id,
        })
        .first();

      expect(onlineMeeting).toMatchObject({
        provider: 'teams',
        provider_meeting_id: 'meeting-123',
        provider_event_id: 'event-123',
        organizer_upn: 'organizer@example.com',
        organizer_user_id: 'organizer-object-1',
        subject: 'Account review',
        join_url: 'https://teams.example.com/meeting/123',
        status: 'scheduled',
        appointment_request_id: null,
        schedule_entry_id: null,
        created_by: STAFF_USER_ID,
      });

      const onlineMeetingType = await globalTableFor(
        db,
        'system_interaction_types',
        'global interaction type catalog lookup for MSP Teams meeting assertions'
      )
        .where({ type_name: 'Online Meeting' })
        .first();
      const interaction = await tenantTableFor(db, tenantId, 'interactions')
        .where({
          tenant: tenantId,
          interaction_id: result.data.interaction_id,
        })
        .first();

      expect(interaction).toMatchObject({
        type_id: onlineMeetingType.type_id,
        client_id: clientId,
        contact_name_id: contactId,
        user_id: STAFF_USER_ID,
        title: 'Online Meeting: Account review',
        notes: 'Join Teams Meeting: https://teams.example.com/meeting/123',
      });
      expect(onlineMeeting.interaction_id).toBe(interaction.interaction_id);
    });

    it('denies a user lacking user_schedule:update and creates no meeting rows', async () => {
      const setup = await setupTestData(db, tenantId, { skipService: true });
      createdIds.clientId = setup.clientId;
      createdIds.contactId = setup.contactId;
      createdIds.clientUserId = setup.clientUserId;
      createdIds.technicianUserId = setup.technicianUserId;

      const staffUser = createMockUser('internal', {
        user_id: STAFF_USER_ID,
        tenant: tenantId,
      });
      setMockUser(staffUser, ['user_schedule:read']);
      setupCommonMocks({
        tenantId,
        userId: STAFF_USER_ID,
        user: staffUser,
        permissionCheck: (_user, resource, action) => !(resource === 'user_schedule' && action === 'update'),
      });

      const result = await scheduleTeamsMeeting({
        subject: 'Permission check',
        startDateTime,
        endDateTime,
        client_id: setup.clientId,
        contact_name_id: setup.contactId,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/permission denied/i);
      expect(createTeamsMeetingMock).not.toHaveBeenCalled();

      const interactionCount = await tenantTableFor(db, tenantId, 'interactions')
        .where({
          tenant: tenantId,
          client_id: setup.clientId,
          contact_name_id: setup.contactId,
        })
        .where('title', 'Online Meeting: Permission check')
        .count<{ count: string }[]>('* as count');
      expect(Number(interactionCount[0].count)).toBe(0);
    });

    it('fails gracefully and creates no local rows when Teams capability is unavailable', async () => {
      const { clientId, contactId } = await setupMspMeetingContext();
      teamsMeetingCapabilityMock.mockResolvedValue({ available: false, reason: 'no_organizer' });

      const result = await scheduleTeamsMeeting({
        subject: 'Capability check',
        startDateTime,
        endDateTime,
        client_id: clientId,
        contact_name_id: contactId,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no default organizer');
      expect(createTeamsMeetingMock).not.toHaveBeenCalled();

      const interactionCount = await tenantTableFor(db, tenantId, 'interactions')
        .where({
          tenant: tenantId,
          client_id: clientId,
          contact_name_id: contactId,
        })
        .where('title', 'Online Meeting: Capability check')
        .count<{ count: string }[]>('* as count');
      expect(Number(interactionCount[0].count)).toBe(0);
    });

    it('optionally creates a schedule entry linked to the created interaction', async () => {
      const { clientId, contactId, technicianUserId } = await setupMspMeetingContext();

      const result = await scheduleTeamsMeeting({
        subject: 'Scheduled Teams consult',
        startDateTime,
        endDateTime,
        client_id: clientId,
        contact_name_id: contactId,
        createScheduleEntry: true,
        assignedUserIds: [technicianUserId],
      });

      expect(result.success).toBe(true);
      if (!result.success) {
        throw new Error(result.error);
      }
      createdIds.onlineMeetingId = result.data.meeting_id;
      createdIds.interactionId = result.data.interaction_id;
      createdIds.scheduleEntryId = result.data.schedule_entry_id ?? undefined;

      expect(result.data.schedule_entry_id).toBeTruthy();

      const scheduleEntry = await tenantTableFor(db, tenantId, 'schedule_entries')
        .where({
          tenant: tenantId,
          entry_id: result.data.schedule_entry_id,
        })
        .first();
      expect(scheduleEntry).toMatchObject({
        title: 'Scheduled Teams consult',
        work_item_type: 'interaction',
        work_item_id: result.data.interaction_id,
        status: 'scheduled',
        notes: 'Join Teams Meeting: https://teams.example.com/meeting/123',
      });

      const assignees = await tenantTableFor(db, tenantId, 'schedule_entry_assignees')
        .where({
          tenant: tenantId,
          entry_id: result.data.schedule_entry_id,
        })
        .select('user_id');
      expect(assignees.map((row) => row.user_id)).toEqual([technicianUserId]);

      const onlineMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          meeting_id: result.data.meeting_id,
        })
        .first();
      expect(onlineMeeting.schedule_entry_id).toBe(result.data.schedule_entry_id);
    });
  });

  describe('Approve as configured approver (no user_schedule:update)', () => {
    // Returns false specifically for user_schedule:update so the action falls into the
    // approver-membership fallback path. Other permission checks still succeed.
    const denyScheduleUpdate = (
      _user: unknown,
      resource?: string,
      action?: string
    ) => !(resource === 'user_schedule' && action === 'update');

    const setStaffWithoutScheduleUpdate = (tenant: string) => {
      const staffUser = createMockUser('internal', {
        user_id: STAFF_USER_ID,
        tenant,
      });
      setMockUser(staffUser, ['user_schedule:read']);
      setupCommonMocks({
        tenantId: tenant,
        userId: STAFF_USER_ID,
        user: staffUser,
        permissionCheck: denyScheduleUpdate,
      });
    };

    it('allows approval when the caller is listed in approver_user_ids (modern config)', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId);

      const settingId = uuidv4();
      await tenantTableFor(db, tenantId, 'availability_settings').insert({
        availability_setting_id: settingId,
        tenant: tenantId,
        setting_type: 'general_settings',
        is_available: true,
        config_json: {
          approver_user_ids: [STAFF_USER_ID],
          approver_team_ids: [],
        },
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      createdIds.availabilitySettingIds.push(settingId);

      setStaffWithoutScheduleUpdate(tenantId);

      const result = await approveAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        assigned_user_id: fixture.technicianUserId,
      });

      expect(result.success).toBe(true);
      expect(result.data?.approved_by_user_id).toBe(STAFF_USER_ID);
    });

    it('honors the legacy default_approver_id fallback for un-backfilled rows', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId);

      // Pre-migration shape: only `default_approver_id`, no array fields.
      const settingId = uuidv4();
      await tenantTableFor(db, tenantId, 'availability_settings').insert({
        availability_setting_id: settingId,
        tenant: tenantId,
        setting_type: 'general_settings',
        is_available: true,
        config_json: { default_approver_id: STAFF_USER_ID },
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      createdIds.availabilitySettingIds.push(settingId);

      setStaffWithoutScheduleUpdate(tenantId);

      const result = await approveAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        assigned_user_id: fixture.technicianUserId,
      });

      expect(result.success).toBe(true);
      expect(result.data?.approved_by_user_id).toBe(STAFF_USER_ID);
    });

    it('rejects approval when the caller is neither permitted nor a configured approver', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId);

      // No approver config exists for STAFF_USER_ID.
      setStaffWithoutScheduleUpdate(tenantId);

      const result = await approveAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        assigned_user_id: fixture.technicianUserId,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/insufficient permissions/i);
    });
  });

  describe('Decline Appointment Request', () => {
    it('should update status correctly when declined', async () => {
      const { clientId, contactId, serviceId, clientUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      expect(createResult.success).toBe(true);
      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      const originalScheduleEntryId = createResult.data?.schedule_entry_id;
      const meetingId = uuidv4();
      await tenantTableFor(db, tenantId, 'online_meetings').insert({
        tenant: tenantId,
        meeting_id: meetingId,
        provider: 'teams',
        provider_meeting_id: `pending-meeting-${meetingId}`,
        subject: 'Pending meeting',
        join_url: 'https://teams.example.com/pending',
        start_time: new Date(`${requestDate}T14:00:00.000Z`),
        end_time: new Date(`${requestDate}T15:00:00.000Z`),
        status: 'scheduled',
        appointment_request_id: createResult.data!.appointment_request_id,
      });

      const staffUser = createMockUser('internal', {
        user_id: STAFF_USER_ID,
        tenant: tenantId
      });
      setMockUser(staffUser, ['user_schedule:update', 'user_schedule:read']);
      setupCommonMocks({ tenantId, userId: STAFF_USER_ID, user: staffUser, permissionCheck: () => true });


      const declineResult = await declineAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        decline_reason: 'No technician available at requested time'
      });

      expect(declineResult.success).toBe(true);

      // Verify status was updated
      const updatedRequest = await tenantTableFor(db, tenantId, 'appointment_requests')
        .where({
          appointment_request_id: createResult.data!.appointment_request_id,
          tenant: tenantId
        })
        .first();

      expect(updatedRequest.status).toBe('declined');
      expect(updatedRequest.declined_reason).toBe('No technician available at requested time');
      expect(updatedRequest.approved_by_user_id).toBe(STAFF_USER_ID);
      expect(updatedRequest.schedule_entry_id).toBeNull();

      // The live Teams meeting is no longer deleted inline: it moves to
      // cancel_pending and the idempotent cleanup job is enqueued.
      const onlineMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          meeting_id: meetingId,
        })
        .first();
      expect(onlineMeeting.status).toBe('cancel_pending');
      expect(scheduleJobMock).toHaveBeenCalledWith(
        'teams-meeting-cleanup',
        { tenantId, meetingId },
      );

      // Run the real cleanup handler to close the loop: Graph delete is
      // confirmed and the row reaches its terminal cancelled state.
      const { teamsMeetingCleanupHandler } = await import('@alga-psa/jobs/handlers/teamsMeetingCleanupHandler');
      await teamsMeetingCleanupHandler({ tenantId, meetingId });

      expect(deleteTeamsMeetingWithResultMock).toHaveBeenCalledWith({
        tenantId,
        meetingId: `pending-meeting-${meetingId}`,
        eventId: null,
        appointmentRequestId: createResult.data!.appointment_request_id,
      });

      const cleanedMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          meeting_id: meetingId,
        })
        .first();
      expect(cleanedMeeting.status).toBe('cancelled');

      // Verify schedule entry was deleted
      const scheduleEntry = await tenantTableFor(db, tenantId, 'schedule_entries')
        .where({
          entry_id: originalScheduleEntryId,
          tenant: tenantId
        })
        .first();

      expect(scheduleEntry).toBeUndefined();
    });

    it('should send email to client with reason when declined', async () => {
      const { clientId, contactId, serviceId, clientUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;

      const staffUser = createMockUser('internal', {
        user_id: STAFF_USER_ID,
        tenant: tenantId
      });
      setMockUser(staffUser, ['user_schedule:update', 'user_schedule:read']);
      setupCommonMocks({ tenantId, userId: STAFF_USER_ID, user: staffUser, permissionCheck: () => true });


      const SystemEmailService = (await import('@alga-psa/email')).SystemEmailService;
      const emailInstance = SystemEmailService.getInstance();

      await declineAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        decline_reason: 'Fully booked on requested date'
      });

      expect(emailInstance.sendAppointmentRequestDeclined).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterEmail: expect.any(String),
          declineReason: 'Fully booked on requested date'
        }),
        expect.objectContaining({
          tenantId: tenantId
        })
      );
    });

    it('should send internal notification to client when declined', async () => {
      const { clientId, contactId, serviceId, clientUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;

      const staffUser = createMockUser('internal', {
        user_id: STAFF_USER_ID,
        tenant: tenantId
      });
      setMockUser(staffUser, ['user_schedule:update', 'user_schedule:read']);
      setupCommonMocks({ tenantId, userId: STAFF_USER_ID, user: staffUser, permissionCheck: () => true });

      const { publishEvent } = await import('@alga-psa/event-bus/publishers');

      // Clear mocks from appointment creation
      vi.clearAllMocks();

      await declineAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        decline_reason: 'Service temporarily unavailable'
      });

      // Since c43321e4cb the client's in-app notification is event-driven:
      // the action publishes APPOINTMENT_REQUEST_DECLINED (with the resolved
      // clientUserId and reason) and internalNotificationSubscriber renders the
      // appointment-request-declined template from it.
      expect(publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'APPOINTMENT_REQUEST_DECLINED',
          payload: expect.objectContaining({
            tenantId,
            appointmentRequestId: createResult.data!.appointment_request_id,
            clientUserId,
            declineReason: 'Service temporarily unavailable'
          })
        })
      );
    });
  });

  describe('Multi-tenant Isolation', () => {
    it('should not allow access to requests from another tenant', async () => {
      // Create data in first tenant
      const { clientId, contactId, serviceId, clientUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      expect(createResult.success).toBe(true);
      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      // Create second tenant
      const tenant2Id = uuidv4();
      await tenantRows(db).insert({
        tenant: tenant2Id,
        client_name: 'Second Tenant',
        email: 'tenant2@test.com',
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      });

      // Try to access first tenant's appointment from second tenant context
      const originalTenantId = tenantId;
      tenantId = tenant2Id;

      try {
        const staffUser2 = createMockUser('internal', {
          user_id: STAFF_USER_2_ID,
          tenant: tenant2Id
        });
        setMockUser(staffUser2, ['user_schedule:update', 'user_schedule:read']);
        setupCommonMocks({ tenantId: tenant2Id, userId: STAFF_USER_2_ID, user: staffUser2, permissionCheck: () => true });

        const approveResult = await approveAppointmentRequest({
          appointment_request_id: createResult.data!.appointment_request_id,
          assigned_user_id: clientUserId // This user doesn't exist in tenant2
        });

        // Should fail because request doesn't exist in tenant2
        expect(approveResult.success).toBe(false);
        expect(approveResult.error).toContain('not found');
      } finally {
        // Cleanup second tenant
        await tenantRows(db).where({ tenant: tenant2Id }).del();
        tenantId = originalTenantId;
      }
    });
  });

  describe('Validation and Error Handling', () => {
    it('should reject appointment request with past date', async () => {
      const { clientId, contactId, serviceId, clientUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const pastDate = yesterday.toISOString().split('T')[0];

      const result = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: pastDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Appointment request contains invalid fields. Review the details and try again.');
    });

    it('should reject appointment request with invalid time format', async () => {
      const { clientId, contactId, serviceId, clientUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const result = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '25:00', // Invalid time
        requested_duration: 60
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid|time/i);
    });

    it('should reject appointment request with negative duration', async () => {
      const { clientId, contactId, serviceId, clientUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const result = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: -30 // Negative duration
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/duration|invalid|positive/i);
    });

    it('should reject appointment request with non-existent service', async () => {
      const { clientId, contactId, clientUserId } = await setupTestData(db, tenantId, { skipService: true });
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.clientUserId = clientUserId;

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const result = await createAppointmentRequest({
        service_id: uuidv4(), // Non-existent service
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/service|not found|does not exist/i);
    });

    it('should reject updating non-pending appointment request', async () => {
      const { clientId, contactId, serviceId, clientUserId, technicianUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;
      createdIds.technicianUserId = technicianUserId;

      // Create and approve a request
      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      // Approve it
      const staffUser = createMockUser('internal', {
        user_id: STAFF_USER_ID,
        tenant: tenantId
      });
      setMockUser(staffUser, ['user_schedule:update', 'user_schedule:read']);
      setupCommonMocks({ tenantId, userId: STAFF_USER_ID, user: staffUser, permissionCheck: () => true });

      await approveAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        assigned_user_id: technicianUserId
      });

      // Try to update the approved request as client
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const { updateAppointmentRequest } = await import('@alga-psa/client-portal/actions');

      const updateResult = await updateAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '15:00',
        requested_duration: 60
      });

      expect(updateResult.success).toBe(false);
      expect(updateResult.error).toMatch(/pending|cannot update|already/i);
    });

    // Canceling an approved request became a supported flow in e4bd66f038
    // (Teams meeting deletion on cancellation); only terminal statuses
    // (declined/cancelled) are rejected now.
    it('allows canceling an already approved request', async () => {
      const { clientId, contactId, serviceId, clientUserId, technicianUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;
      createdIds.technicianUserId = technicianUserId;

      // Create and approve a request
      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      // Approve it
      const staffUser = createMockUser('internal', {
        user_id: STAFF_USER_ID,
        tenant: tenantId
      });
      setMockUser(staffUser, ['user_schedule:update', 'user_schedule:read']);
      setupCommonMocks({ tenantId, userId: STAFF_USER_ID, user: staffUser, permissionCheck: () => true });

      await approveAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        assigned_user_id: technicianUserId
      });

      // Try to cancel the approved request as client
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const { cancelAppointmentRequest } = await import('@alga-psa/client-portal/actions');

      const cancelResult = await cancelAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id
      });

      expect(cancelResult.success).toBe(true);

      const cancelledRow = await tenantTableFor(db, tenantId, 'appointment_requests')
        .where({ appointment_request_id: createResult.data!.appointment_request_id })
        .first();
      expect(cancelledRow?.status).toBe('cancelled');
    });

    it('should reject double-approving a request', async () => {
      const { clientId, contactId, serviceId, clientUserId, technicianUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;
      createdIds.technicianUserId = technicianUserId;

      // Create request
      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      // Approve it once
      const staffUser = createMockUser('internal', {
        user_id: STAFF_USER_ID,
        tenant: tenantId
      });
      setMockUser(staffUser, ['user_schedule:update', 'user_schedule:read']);
      setupCommonMocks({ tenantId, userId: STAFF_USER_ID, user: staffUser, permissionCheck: () => true });


      const firstApproval = await approveAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        assigned_user_id: technicianUserId
      });

      expect(firstApproval.success).toBe(true);

      // Try to approve it again
      const secondApproval = await approveAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        assigned_user_id: technicianUserId
      });

      expect(secondApproval.success).toBe(false);
      expect(secondApproval.error).toMatch(/already|pending|cannot approve/i);
    });
  });

  describe('Preferred Technician Selection', () => {
    it('should accept preferred technician when creating request', async () => {
      const { clientId, contactId, serviceId, clientUserId, technicianUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;
      createdIds.technicianUserId = technicianUserId;

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const result = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60,
        preferred_assigned_user_id: technicianUserId
      });

      expect(result.success).toBe(true);
      expect(result.data?.preferred_assigned_user_id).toBe(technicianUserId);

      createdIds.appointmentRequestId = result.data?.appointment_request_id;
      createdIds.scheduleEntryId = result.data?.schedule_entry_id;
    });

    it('should handle preferred technician even if unavailable', async () => {
      const { clientId, contactId, serviceId, clientUserId, technicianUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;
      createdIds.technicianUserId = technicianUserId;

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      // Create appointment request with preferred technician (system should still accept)
      const result = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60,
        preferred_assigned_user_id: technicianUserId,
        description: 'Prefer specific technician'
      });

      expect(result.success).toBe(true);
      expect(result.data?.preferred_assigned_user_id).toBe(technicianUserId);

      createdIds.appointmentRequestId = result.data?.appointment_request_id;
      createdIds.scheduleEntryId = result.data?.schedule_entry_id;
    });
  });

  describe('Ticket Association', () => {
    it('should allow linking appointment request to existing ticket', async () => {
      const { clientId, contactId, serviceId, clientUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;

      // Ensure ticket metadata exists
      const { statusId, priorityId } = await ensureTicketMetadata(db, tenantId, clientUserId);

      // Create a ticket
      const ticketNumber = Math.floor(Math.random() * 100000);
      const [ticketRow] = await tenantTableFor(db, tenantId, 'tickets').insert({
        tenant: tenantId,
        ticket_number: ticketNumber,
        title: 'Test Ticket',
        client_id: clientId,
        entered_by: clientUserId,
        status_id: statusId,
        priority_id: priorityId,
        entered_at: db.fn.now(),
        updated_at: db.fn.now()
      }).returning('ticket_id');
      const ticketId = ticketRow.ticket_id as string;

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const result = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60,
        ticket_id: ticketId
      });

      expect(result.success).toBe(true);
      expect(result.data?.ticket_id).toBe(ticketId);

      createdIds.appointmentRequestId = result.data?.appointment_request_id;
      createdIds.scheduleEntryId = result.data?.schedule_entry_id;

      // Cleanup ticket
      await tenantTableFor(db, tenantId, 'tickets').where({ ticket_id: ticketId, tenant: tenantId }).del();
    });

    it('should allow staff to associate request to ticket during approval', async () => {
      const { clientId, contactId, serviceId, clientUserId, technicianUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;
      createdIds.technicianUserId = technicianUserId;

      // Ensure ticket metadata exists
      const { statusId, priorityId } = await ensureTicketMetadata(db, tenantId, technicianUserId);

      // Create a ticket
      const ticketNumber = Math.floor(Math.random() * 100000);
      const [ticketRow] = await tenantTableFor(db, tenantId, 'tickets').insert({
        tenant: tenantId,
        ticket_number: ticketNumber,
        title: 'Test Ticket for Association',
        client_id: clientId,
        entered_by: clientUserId,
        status_id: statusId,
        priority_id: priorityId,
        entered_at: db.fn.now(),
        updated_at: db.fn.now()
      }).returning('ticket_id');
      const ticketId = ticketRow.ticket_id as string;

      // Create appointment request without ticket
      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      // Associate ticket as staff during approval
      const staffUser = createMockUser('internal', {
        user_id: STAFF_USER_ID,
        tenant: tenantId
      });
      setMockUser(staffUser, ['user_schedule:update', 'user_schedule:read']);
      setupCommonMocks({ tenantId, userId: STAFF_USER_ID, user: staffUser, permissionCheck: () => true });


      const { associateRequestToTicket } = await import('@alga-psa/scheduling/actions');

      const associateResult = await associateRequestToTicket({
        appointment_request_id: createResult.data!.appointment_request_id,
        ticket_id: ticketId
      });

      expect(associateResult.success).toBe(true);

      // Verify association
      const updatedRequest = await tenantTableFor(db, tenantId, 'appointment_requests')
        .where({
          appointment_request_id: createResult.data!.appointment_request_id,
          tenant: tenantId
        })
        .first();

      expect(updatedRequest.ticket_id).toBe(ticketId);

      // Cleanup ticket
      await tenantTableFor(db, tenantId, 'tickets').where({ ticket_id: ticketId, tenant: tenantId }).del();
    });
  });

  describe('Update Appointment Date/Time', () => {
    it('should allow staff to update date/time before approval', async () => {
      const { clientId, contactId, serviceId, clientUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;

      // Create appointment request as client
      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      // Update date/time as staff
      const staffUser = createMockUser('internal', {
        user_id: STAFF_USER_ID,
        tenant: tenantId
      });
      setMockUser(staffUser, ['user_schedule:update', 'user_schedule:read']);
      setupCommonMocks({ tenantId, userId: STAFF_USER_ID, user: staffUser, permissionCheck: () => true });

      const { updateAppointmentRequestDateTime } = await import('@alga-psa/scheduling/actions');

      const updateResult = await updateAppointmentRequestDateTime({
        appointment_request_id: createResult.data!.appointment_request_id,
        new_date: requestDate,
        new_time: '15:30',
        new_duration: 90
      });

      expect(updateResult.success).toBe(true);
      // The action returns the re-read row; Postgres serializes TIME as HH:MM:SS.
      expect(updateResult.data?.requested_time).toBe('15:30:00');
      expect(updateResult.data?.requested_duration).toBe(90);

      // Verify schedule entry was also updated
      const scheduleEntry = await tenantTableFor(db, tenantId, 'schedule_entries')
        .where({
          entry_id: createResult.data?.schedule_entry_id,
          tenant: tenantId
        })
        .first();

      expect(scheduleEntry).toBeDefined();
      // scheduled_start is the UTC instant for the requester's wall-clock
      // (5589b2c770); this request's timezone is UTC, so assert in UTC rather
      // than the test machine's locale.
      const startTime = new Date(scheduleEntry.scheduled_start);
      expect(startTime.getUTCHours()).toBe(15);
      expect(startTime.getUTCMinutes()).toBe(30);
    });

    // Rescheduling an approved request became a supported flow in 23d22000dc
    // (Teams meeting sync on reschedule); only terminal statuses are rejected.
    it('allows updating date/time after approval (reschedule)', async () => {
      const { clientId, contactId, serviceId, clientUserId, technicianUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;
      createdIds.technicianUserId = technicianUserId;

      // Create and approve request
      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setMockUser(clientUser, []);
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId!,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      // Approve it
      const staffUser = createMockUser('internal', {
        user_id: STAFF_USER_ID,
        tenant: tenantId
      });
      setMockUser(staffUser, ['user_schedule:update', 'user_schedule:read']);
      setupCommonMocks({ tenantId, userId: STAFF_USER_ID, user: staffUser, permissionCheck: () => true });

      await approveAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        assigned_user_id: technicianUserId
      });

      // Reschedule the approved request
      const { updateAppointmentRequestDateTime } = await import('@alga-psa/scheduling/actions');

      const updateResult = await updateAppointmentRequestDateTime({
        appointment_request_id: createResult.data!.appointment_request_id,
        new_date: requestDate,
        new_time: '16:00',
        new_duration: 60
      });

      expect(updateResult.success).toBe(true);
      expect(updateResult.data?.requested_time).toBe('16:00:00');
      expect(updateResult.data?.status).toBe('approved');
    });

    it('reschedules the linked Teams meeting when an approved request has an online meeting', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId);
      setStaffSchedulingContext(tenantId);

      const approveResult = await approveAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        assigned_user_id: fixture.technicianUserId,
        generate_teams_meeting: true,
      });

      expect(approveResult.success).toBe(true);

      const { updateAppointmentRequestDateTime } = await import('@alga-psa/scheduling/actions');
      const updateResult = await updateAppointmentRequestDateTime({
        appointment_request_id: fixture.appointmentRequestId,
        new_date: '2026-04-30',
        new_time: '16:45',
        new_duration: 90,
      });

      expect(updateResult.success).toBe(true);
      // Reschedules PATCH subject + attendees in addition to times (F016).
      expect(updateTeamsMeetingWithResultMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          appointmentRequestId: fixture.appointmentRequestId,
          meetingId: 'meeting-123',
          eventId: 'event-123',
          startDateTime: '2026-04-30T16:45:00.000Z',
          endDateTime: '2026-04-30T18:15:00.000Z',
          subject: 'Appointment: Test Service',
          attendees: expect.arrayContaining([
            expect.objectContaining({
              emailAddress: expect.objectContaining({
                address: `contact-${fixture.contactId.slice(0, 8)}@test.com`,
              }),
            }),
            expect.objectContaining({
              emailAddress: expect.objectContaining({
                address: `tech-${fixture.technicianUserId.slice(0, 8)}@test.com`,
              }),
            }),
          ]),
          bodyHtml: expect.stringContaining(`/msp/schedule?requestId=${fixture.appointmentRequestId}`),
        })
      );

      const onlineMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          appointment_request_id: fixture.appointmentRequestId,
        })
        .first();
      expect(new Date(onlineMeeting.start_time).toISOString()).toBe('2026-04-30T16:45:00.000Z');
      expect(new Date(onlineMeeting.end_time).toISOString()).toBe('2026-04-30T18:15:00.000Z');

      const interaction = await tenantTableFor(db, tenantId, 'interactions')
        .where({
          tenant: tenantId,
          interaction_id: onlineMeeting.interaction_id,
        })
        .first();
      expect(new Date(interaction.start_time).toISOString()).toBe('2026-04-30T16:45:00.000Z');
      expect(new Date(interaction.end_time).toISOString()).toBe('2026-04-30T18:15:00.000Z');
      expect(interaction.duration).toBe(90);
    });

    it('reschedules the linked Teams meeting when the schedule entry is moved directly on the calendar (drag/edit)', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId);
      setStaffSchedulingContext(tenantId);

      const approveResult = await approveAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        assigned_user_id: fixture.technicianUserId,
        generate_teams_meeting: true,
      });
      expect(approveResult.success).toBe(true);

      // The calendar-drag path (updateScheduleEntry) — not the appointment
      // reschedule action — must also re-PATCH the Teams meeting so attendees
      // get an updated invite.
      updateTeamsMeetingWithResultMock.mockClear();
      const { updateScheduleEntry } = await import('@alga-psa/scheduling/actions');

      const newStart = new Date('2026-05-02T09:15:00.000Z');
      const newEnd = new Date('2026-05-02T10:15:00.000Z');
      const dragResult = await updateScheduleEntry(fixture.scheduleEntryId!, {
        scheduled_start: newStart,
        scheduled_end: newEnd,
      });

      expect(dragResult.success).toBe(true);
      expect(updateTeamsMeetingWithResultMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          appointmentRequestId: fixture.appointmentRequestId,
          meetingId: 'meeting-123',
          startDateTime: '2026-05-02T09:15:00.000Z',
          endDateTime: '2026-05-02T10:15:00.000Z',
          subject: 'Appointment: Test Service',
          attendees: expect.arrayContaining([
            expect.objectContaining({
              emailAddress: expect.objectContaining({
                address: `contact-${fixture.contactId.slice(0, 8)}@test.com`,
              }),
            }),
            expect.objectContaining({
              emailAddress: expect.objectContaining({
                address: `tech-${fixture.technicianUserId.slice(0, 8)}@test.com`,
              }),
            }),
          ]),
          bodyHtml: expect.stringContaining(`/msp/schedule?requestId=${fixture.appointmentRequestId}`),
        })
      );

      const onlineMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({ tenant: tenantId, appointment_request_id: fixture.appointmentRequestId })
        .first();
      expect(new Date(onlineMeeting.start_time).toISOString()).toBe('2026-05-02T09:15:00.000Z');
      expect(new Date(onlineMeeting.end_time).toISOString()).toBe('2026-05-02T10:15:00.000Z');
    });

    it('surfaces a warning when the calendar-drag Teams PATCH fails, without rolling back the move', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId);
      setStaffSchedulingContext(tenantId);

      const approveResult = await approveAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        assigned_user_id: fixture.technicianUserId,
        generate_teams_meeting: true,
      });
      expect(approveResult.success).toBe(true);

      updateTeamsMeetingWithResultMock.mockClear();
      updateTeamsMeetingWithResultMock.mockResolvedValue({
        status: 'failed',
        errorCode: 'graph_server_error',
        errorMessage: 'boom',
      });

      const { updateScheduleEntry } = await import('@alga-psa/scheduling/actions');
      const dragResult = await updateScheduleEntry(fixture.scheduleEntryId!, {
        scheduled_start: new Date('2026-05-03T13:00:00.000Z'),
        scheduled_end: new Date('2026-05-03T14:00:00.000Z'),
      });

      // The calendar move still succeeds; the warning surfaces the Graph failure.
      expect(dragResult.success).toBe(true);
      expect((dragResult as { teamsMeetingWarning?: string }).teamsMeetingWarning).toMatch(/could not be rescheduled/i);
    });

    it('returns a warning when the Teams reschedule PATCH fails', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId);
      setStaffSchedulingContext(tenantId);

      const approveResult = await approveAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        assigned_user_id: fixture.technicianUserId,
        generate_teams_meeting: true,
      });

      expect(approveResult.success).toBe(true);
      updateTeamsMeetingWithResultMock.mockResolvedValue({
        status: 'failed',
        errorCode: 'graph_server_error',
        errorMessage: 'x',
      });

      const { updateAppointmentRequestDateTime } = await import('@alga-psa/scheduling/actions');
      const updateResult = await updateAppointmentRequestDateTime({
        appointment_request_id: fixture.appointmentRequestId,
        new_date: '2026-05-01',
        new_time: '11:15',
        new_duration: 60,
      });

      expect(updateResult.success).toBe(true);
      expect(updateResult.teamsMeetingWarning).toContain('could not be rescheduled');
    });

    it('does not call Teams when the approved request has no online meeting id', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId);
      setStaffSchedulingContext(tenantId);

      const approveResult = await approveAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        assigned_user_id: fixture.technicianUserId,
        generate_teams_meeting: false,
      });

      expect(approveResult.success).toBe(true);

      const { updateAppointmentRequestDateTime } = await import('@alga-psa/scheduling/actions');
      const updateResult = await updateAppointmentRequestDateTime({
        appointment_request_id: fixture.appointmentRequestId,
        new_date: '2026-05-02',
        new_time: '09:00',
        new_duration: 45,
      });

      expect(updateResult.success).toBe(true);
      expect(updateTeamsMeetingMock).not.toHaveBeenCalled();
      expect(updateTeamsMeetingWithResultMock).not.toHaveBeenCalled();
    });

    it('reschedules a legacy Teams meeting without a provider event id using the standalone fallback', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId);
      setStaffSchedulingContext(tenantId);

      const approveResult = await approveAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        assigned_user_id: fixture.technicianUserId,
        generate_teams_meeting: true,
      });

      expect(approveResult.success).toBe(true);
      await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          appointment_request_id: fixture.appointmentRequestId,
        })
        .delete();
      updateTeamsMeetingMock.mockClear();
      updateTeamsMeetingWithResultMock.mockClear();

      const { updateAppointmentRequestDateTime } = await import('@alga-psa/scheduling/actions');
      const updateResult = await updateAppointmentRequestDateTime({
        appointment_request_id: fixture.appointmentRequestId,
        new_date: '2026-05-04',
        new_time: '14:30',
        new_duration: 30,
      });

      expect(updateResult.success).toBe(true);
      expect(updateTeamsMeetingWithResultMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          appointmentRequestId: fixture.appointmentRequestId,
          meetingId: 'meeting-123',
          eventId: null,
        })
      );
    });
  });

  describe('Teams meeting deletion lifecycle', () => {
    it('deletes the linked Teams meeting when a client cancels an approved appointment', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId);
      setStaffSchedulingContext(tenantId);

      const approveResult = await approveAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        assigned_user_id: fixture.technicianUserId,
        generate_teams_meeting: true,
      });

      expect(approveResult.success).toBe(true);

      const scheduledMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          appointment_request_id: fixture.appointmentRequestId,
        })
        .first();
      expect(scheduledMeeting.status).toBe('scheduled');

      setClientContext(tenantId, fixture.clientUserId, fixture.contactId);
      const { cancelAppointmentRequest } = await import('@alga-psa/client-portal/actions');
      const cancelResult = await cancelAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
      });

      // Cancellation no longer deletes the Graph event inline: the row moves
      // to cancel_pending and the idempotent cleanup job is enqueued.
      expect(cancelResult.success).toBe(true);
      expect(cancelResult.teamsMeetingWarning).toContain('is being cancelled');
      expect(deleteTeamsMeetingMock).not.toHaveBeenCalled();
      expect(scheduleJobMock).toHaveBeenCalledWith(
        'teams-meeting-cleanup',
        { tenantId, meetingId: scheduledMeeting.meeting_id },
      );

      const pendingMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          appointment_request_id: fixture.appointmentRequestId,
        })
        .first();
      expect(pendingMeeting.status).toBe('cancel_pending');

      // Full loop: the cleanup job deletes the Graph event and confirms the
      // local cancellation.
      const { teamsMeetingCleanupHandler } = await import('@alga-psa/jobs/handlers/teamsMeetingCleanupHandler');
      await teamsMeetingCleanupHandler({ tenantId, meetingId: scheduledMeeting.meeting_id });

      expect(deleteTeamsMeetingWithResultMock).toHaveBeenCalledWith({
        tenantId,
        meetingId: 'meeting-123',
        eventId: 'event-123',
        appointmentRequestId: fixture.appointmentRequestId,
      });

      const onlineMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          appointment_request_id: fixture.appointmentRequestId,
        })
        .first();
      expect(onlineMeeting.status).toBe('cancelled');
    });

    it('deletes the linked Teams meeting when MSP staff deletes the schedule entry', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId);
      setStaffSchedulingContext(tenantId);

      const approveResult = await approveAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        assigned_user_id: fixture.technicianUserId,
        generate_teams_meeting: true,
      });

      expect(approveResult.success).toBe(true);

      const deleteResult = await deleteScheduleEntry(approveResult.data!.schedule_entry_id!);

      expect(deleteResult.success).toBe(true);
      expect(deleteTeamsMeetingMock).toHaveBeenCalledWith({
        tenantId,
        meetingId: 'meeting-123',
        eventId: 'event-123',
        appointmentRequestId: fixture.appointmentRequestId,
      });

      const onlineMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          appointment_request_id: fixture.appointmentRequestId,
        })
        .first();
      expect(onlineMeeting.status).toBe('cancelled');
    });

    // Graph deletion is now async (cancel_pending + cleanup job); the failure
    // mode surfaced to the client is the enqueue failing — the row stays
    // cancel_pending and the recurring sweep retries it.
    it('surfaces a warning when the Teams meeting cleanup cannot be scheduled during cancellation', async () => {
      const fixture = await createPendingAppointmentFixture(db, tenantId);
      setStaffSchedulingContext(tenantId);

      const approveResult = await approveAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        assigned_user_id: fixture.technicianUserId,
        generate_teams_meeting: true,
      });

      expect(approveResult.success).toBe(true);
      scheduleJobMock.mockRejectedValue(new Error('job runner unavailable'));

      setClientContext(tenantId, fixture.clientUserId, fixture.contactId);
      const { cancelAppointmentRequest } = await import('@alga-psa/client-portal/actions');
      const cancelResult = await cancelAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
      });

      expect(cancelResult.success).toBe(true);
      expect(cancelResult.teamsMeetingWarning).toContain('could not be scheduled');

      const onlineMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          appointment_request_id: fixture.appointmentRequestId,
        })
        .first();
      expect(onlineMeeting.status).toBe('cancel_pending');
    });
  });

  describe('T110 Teams meeting end-to-end lifecycle', () => {
    it('T110: request → approve with meeting → decline → cleanup job → polling artifact capture', async () => {
      // 1. Client creates the request via the client portal action.
      const fixture = await createPendingAppointmentFixture(db, tenantId);
      setStaffSchedulingContext(tenantId);

      // 2. Approve with generate_teams_meeting: both parties are invited and
      //    the Graph body carries the PSA deep link.
      const approveResult = await approveAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        assigned_user_id: fixture.technicianUserId,
        generate_teams_meeting: true,
      });

      expect(approveResult.success).toBe(true);

      const createArgs = createTeamsMeetingWithResultMock.mock.calls.at(-1)?.[0];
      expect(createArgs).toBeDefined();
      const attendeeEmails = (createArgs.attendees ?? []).map(
        (attendee: { emailAddress: { address: string } }) => attendee.emailAddress.address,
      );
      expect(attendeeEmails).toContain(`contact-${fixture.contactId.slice(0, 8)}@test.com`);
      expect(attendeeEmails).toContain(`tech-${fixture.technicianUserId.slice(0, 8)}@test.com`);
      expect(createArgs.bodyHtml).toContain(`/msp/schedule?requestId=${fixture.appointmentRequestId}`);

      const approvedRequest = await tenantTableFor(db, tenantId, 'appointment_requests')
        .where({
          appointment_request_id: fixture.appointmentRequestId,
          tenant: tenantId,
        })
        .first();
      expect(approvedRequest.status).toBe('approved');
      expect(approvedRequest.online_meeting_url).toBe('https://teams.example.com/meeting/123');

      const scheduledMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          appointment_request_id: fixture.appointmentRequestId,
        })
        .first();
      expect(scheduledMeeting).toMatchObject({
        provider: 'teams',
        provider_meeting_id: 'meeting-123',
        status: 'scheduled',
      });

      // 3. Decline the APPROVED request: the meeting moves to cancel_pending
      //    and the cleanup job is enqueued (no inline Graph delete).
      const declineResult = await declineAppointmentRequest({
        appointment_request_id: fixture.appointmentRequestId,
        decline_reason: 'Technician no longer available',
      });

      expect(declineResult.success).toBe(true);
      expect(deleteTeamsMeetingMock).not.toHaveBeenCalled();
      expect(scheduleJobMock).toHaveBeenCalledWith(
        'teams-meeting-cleanup',
        { tenantId, meetingId: scheduledMeeting.meeting_id },
      );

      const pendingMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          meeting_id: scheduledMeeting.meeting_id,
        })
        .first();
      expect(pendingMeeting.status).toBe('cancel_pending');

      // 4. Run the real cleanup handler: Graph delete is confirmed and the
      //    row reaches its terminal cancelled state.
      const { teamsMeetingCleanupHandler } = await import('@alga-psa/jobs/handlers/teamsMeetingCleanupHandler');
      await teamsMeetingCleanupHandler({ tenantId, meetingId: scheduledMeeting.meeting_id });

      expect(deleteTeamsMeetingWithResultMock).toHaveBeenCalledWith({
        tenantId,
        meetingId: 'meeting-123',
        eventId: 'event-123',
        appointmentRequestId: fixture.appointmentRequestId,
      });

      const cancelledMeeting = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          meeting_id: scheduledMeeting.meeting_id,
        })
        .first();
      expect(cancelledMeeting.status).toBe('cancelled');
      expect(cancelledMeeting.error_code).toBeNull();

      // 5. Polling fallback for artifact capture (webhook-less): a meeting
      //    that ended while recording_pending gets its artifacts fetched and
      //    persisted by the real capture orchestrator against the real DB.
      const pastStart = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const pastEnd = new Date(Date.now() - 60 * 60 * 1000);
      await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          meeting_id: scheduledMeeting.meeting_id,
        })
        .update({
          status: 'recording_pending',
          start_time: pastStart,
          end_time: pastEnd,
          recording_fetch_attempts: 0,
          last_fetch_at: null,
          error_code: null,
        });

      const fetchArtifactsMock = vi.fn(async () => [
        {
          artifactType: 'recording' as const,
          providerArtifactId: 'rec-1',
          contentUrl: 'https://graph/rec',
          createdDateTime: new Date().toISOString(),
        },
      ]);

      const { fetchAndPersistMeetingArtifacts } = await import('@alga-psa/clients/lib/onlineMeetingArtifactCapture');
      const captured = await fetchAndPersistMeetingArtifacts(
        { tenantId, meetingId: scheduledMeeting.meeting_id, actorUserId: STAFF_USER_ID },
        {
          isEnterpriseEdition: () => true,
          fetchArtifacts: fetchArtifactsMock,
          loadSettings: async () => ({ downloadRecordings: false, exposeRecordingsInPortal: false }),
          revalidate: () => {},
        },
      );

      expect(fetchArtifactsMock).toHaveBeenCalledWith({
        tenantId,
        meetingId: 'meeting-123',
        organizerUserId: 'organizer-object-1',
      });
      expect(captured.status).toBe('recording_ready');

      const meetingAfterCapture = await tenantTableFor(db, tenantId, 'online_meetings')
        .where({
          tenant: tenantId,
          meeting_id: scheduledMeeting.meeting_id,
        })
        .first();
      expect(meetingAfterCapture.status).toBe('recording_ready');
      expect(meetingAfterCapture.recording_fetch_attempts).toBe(1);
      expect(meetingAfterCapture.last_fetch_at).not.toBeNull();

      const artifacts = await tenantTableFor(db, tenantId, 'online_meeting_artifacts')
        .where({
          tenant: tenantId,
          meeting_id: scheduledMeeting.meeting_id,
        });
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]).toMatchObject({
        artifact_type: 'recording',
        provider_artifact_id: 'rec-1',
        content_url: 'https://graph/rec',
      });
    });
  });
});

/**
 * Helper function to ensure a tenant exists in the test database
 */
async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await tenantRows(connection).first<{ tenant: string }>('tenant');
  if (existing?.tenant) {
    return existing.tenant;
  }

  const newTenantId = uuidv4();
  await tenantRows(connection).insert({
    tenant: newTenantId,
    client_name: 'Appointment Request Integration Test Tenant',
    email: 'appointment-test@test.com',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now()
  });
  return newTenantId;
}

function getFutureDateString(daysAhead = 1): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().split('T')[0];
}

function setStaffSchedulingContext(tenant: string) {
  const staffUser = createMockUser('internal', {
    user_id: STAFF_USER_ID,
    tenant,
  });
  setMockUser(staffUser, ['user_schedule:update', 'user_schedule:read']);
  setupCommonMocks({
    tenantId: tenant,
    userId: STAFF_USER_ID,
    user: staffUser,
    permissionCheck: () => true,
  });
}

function setClientContext(tenant: string, clientUserId: string, contactId: string) {
  const clientUser = createMockUser('client', {
    user_id: clientUserId,
    tenant,
    contact_id: contactId,
  });
  setMockUser(clientUser, []);
  setupCommonMocks({
    tenantId: tenant,
    userId: clientUserId,
    user: clientUser,
    permissionCheck: () => true,
  });
}

async function createPendingAppointmentFixture(
  db: Knex,
  tenantId: string,
  options: {
    requestedDate?: string;
    requestedTime?: string;
    requestedDuration?: number;
  } = {}
) {
  const setup = await setupTestData(db, tenantId);
  createdIds.clientId = setup.clientId;
  createdIds.contactId = setup.contactId;
  createdIds.serviceId = setup.serviceId;
  createdIds.clientUserId = setup.clientUserId;
  createdIds.technicianUserId = setup.technicianUserId;

  setClientContext(tenantId, setup.clientUserId, setup.contactId);

  const createResult = await createAppointmentRequest({
    service_id: setup.serviceId!,
    requested_date: options.requestedDate ?? getFutureDateString(),
    requested_time: options.requestedTime ?? '14:00',
    requested_duration: options.requestedDuration ?? 60,
    description: 'Need help with server maintenance',
  });

  expect(createResult.success).toBe(true);
  createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
  createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

  return {
    ...setup,
    appointmentRequestId: createResult.data!.appointment_request_id,
    scheduleEntryId: createResult.data!.schedule_entry_id,
  };
}

/**
 * Ensure ticket statuses/priorities exist for a tenant
 */
async function ensureTicketMetadata(
  db: Knex,
  tenantId: string,
  createdByUserId: string
): Promise<{ statusId: string; priorityId: string }> {
  let status = await tenantTableFor(db, tenantId, 'statuses')
    .where({ tenant: tenantId, status_type: 'ticket' })
    .first<{ status_id: string }>('status_id');

  if (!status) {
    const statusId = uuidv4();
    await tenantTableFor(db, tenantId, 'statuses').insert({
      status_id: statusId,
      tenant: tenantId,
      name: 'Test Ticket Status',
      status_type: 'ticket',
      order_number: 1,
      created_by: createdByUserId,
      created_at: db.fn.now(),
      is_closed: false,
      is_default: true
    });
    status = { status_id: statusId };
  }

  let priority = await tenantTableFor(db, tenantId, 'priorities')
    .where({ tenant: tenantId })
    .first<{ priority_id: string }>('priority_id');

  if (!priority) {
    const priorityId = uuidv4();
    await tenantTableFor(db, tenantId, 'priorities').insert({
      priority_id: priorityId,
      tenant: tenantId,
      priority_name: 'Test Priority',
      created_by: createdByUserId,
      created_at: db.fn.now()
    });
    priority = { priority_id: priorityId };
  }

  return {
    statusId: status.status_id,
    priorityId: priority.priority_id
  };
}

/**
 * Helper function to set up test data
 */
async function setupTestData(
  db: Knex,
  tenantId: string,
  options: {
    skipService?: boolean;
    skipContract?: boolean;
    allowWithoutContract?: boolean;
  } = {}
): Promise<{
  clientId: string;
  contactId: string;
  serviceId?: string;
  serviceTypeId?: string;
  clientUserId: string;
  technicianUserId: string;
  contractId?: string;
  clientContractId?: string;
}> {
  // Create client
  const clientId = uuidv4();
  await tenantTableFor(db, tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Test Client ${clientId.slice(0, 8)}`,
    billing_cycle: 'monthly',
    is_tax_exempt: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  // Create contact
  const contactId = uuidv4();
  await tenantTableFor(db, tenantId, 'contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    client_id: clientId,
    full_name: 'Test Contact',
    email: `contact-${contactId.slice(0, 8)}@test.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  // Create client user
  const clientUserId = uuidv4();
  await tenantTableFor(db, tenantId, 'users').insert({
    tenant: tenantId,
    user_id: clientUserId,
    username: `client_${clientId.slice(0, 8)}`,
    first_name: 'Client',
    last_name: 'User',
    email: `client-${clientUserId.slice(0, 8)}@test.com`,
    hashed_password: 'hashed',
    user_type: 'client',
    contact_id: contactId,
    is_inactive: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  // Create technician user
  const technicianUserId = uuidv4();
  await tenantTableFor(db, tenantId, 'users').insert({
    tenant: tenantId,
    user_id: technicianUserId,
    username: `tech_${clientId.slice(0, 8)}`,
    first_name: 'Technician',
    last_name: 'User',
    email: `tech-${technicianUserId.slice(0, 8)}@test.com`,
    hashed_password: 'hashed',
    user_type: 'internal',
    is_inactive: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  let serviceId: string | undefined;
  let serviceTypeId: string | undefined;
  let contractId: string | undefined;
  let clientContractId: string | undefined;

  if (!options.skipService) {
    // Create service type
    serviceTypeId = uuidv4();
    await insertServiceType(db, {
      id: serviceTypeId,
      tenant: tenantId,
      name: `Service Type ${serviceTypeId.slice(0, 8)}`,
      order_number: Math.floor(Math.random() * 1000000)
    });

    // Create service
    serviceId = uuidv4();
    await tenantTableFor(db, tenantId, 'service_catalog').insert({
      tenant: tenantId,
      service_id: serviceId!,
      service_name: 'Test Service',
      description: 'Service for testing',
      billing_method: 'fixed',
      default_rate: 10000,
      custom_service_type_id: serviceTypeId
    });

    // Create availability setting for service
    const availabilitySettingId = uuidv4();
    await tenantTableFor(db, tenantId, 'availability_settings').insert({
      availability_setting_id: availabilitySettingId,
      tenant: tenantId,
      setting_type: 'service_rules',
      service_id: serviceId!,
      is_available: true,
      allow_without_contract: options.allowWithoutContract || false,
      advance_booking_days: 30,
      minimum_notice_hours: 24,
      config_json: { default_duration: 60 },
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    createdIds.availabilitySettingIds.push(availabilitySettingId);

    // Create user availability settings for technician
    const userAvailSettingId = uuidv4();
    await tenantTableFor(db, tenantId, 'availability_settings').insert({
      availability_setting_id: userAvailSettingId,
      tenant: tenantId,
      setting_type: 'user_hours',
      user_id: technicianUserId,
      day_of_week: 1, // Monday
      start_time: '09:00',
      end_time: '17:00',
      is_available: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });
    createdIds.availabilitySettingIds.push(userAvailSettingId);

    // Create contract if not skipped
    if (!options.skipContract && !options.allowWithoutContract) {
      // Create contract
      contractId = uuidv4();
      await tenantTableFor(db, tenantId, 'contracts').insert({
        tenant: tenantId,
        contract_id: contractId,
        contract_name: 'Test Contract',
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      });

      // Create client contract
      clientContractId = uuidv4();
      await tenantTableFor(db, tenantId, 'client_contracts').insert({
        tenant: tenantId,
        client_contract_id: clientContractId,
        client_id: clientId,
        contract_id: contractId,
        start_date: new Date('2025-01-01'),
        is_active: true,
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      });

      // Create contract line
      const contractLineId = uuidv4();
      await tenantTableFor(db, tenantId, 'contract_lines').insert({
        tenant: tenantId,
        contract_line_id: contractLineId,
        contract_id: contractId,
        contract_line_name: 'Test Contract Line',
        description: 'Contract line for testing',
        billing_frequency: 'monthly',
        is_custom: false,
        is_active: true,
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      });

      // Create contract line service
      await tenantTableFor(db, tenantId, 'contract_line_services').insert({
        tenant: tenantId,
        contract_line_id: contractLineId,
        service_id: serviceId!,
        quantity: 1
      });
    }
  }

  return {
    clientId,
    contactId,
    serviceId,
    serviceTypeId,
    clientUserId,
    technicianUserId,
    contractId,
    clientContractId
  };
}

/**
 * Helper function to clean up created records
 */
async function cleanupCreatedRecords(db: Knex, tenantId: string, ids: CreatedIds) {
  if (!ids) {
    return;
  }

  const safeDelete = async (table: string, where: Record<string, unknown>) => {
    try {
      await tenantTableFor(db, tenantId, table).where(where).del();
    } catch {
      // Ignore cleanup issues
    }
  };

  const safeDeleteIn = async (table: string, column: string, values: string[]) => {
    if (!values || values.length === 0) {
      return;
    }
    try {
      await tenantTableFor(db, tenantId, table).whereIn(column, values).andWhere({ tenant: tenantId }).del();
    } catch {
      // Ignore cleanup issues
    }
  };

  // Artifacts reference online_meetings rows, so remove them first.
  const safeDeleteArtifactsForMeetings = async (where: Record<string, unknown>) => {
    try {
      const meetings = await tenantTableFor(db, tenantId, 'online_meetings')
        .where(where)
        .select('meeting_id');
      const meetingIds = meetings.map((row: { meeting_id: string }) => row.meeting_id);
      if (meetingIds.length > 0) {
        await tenantTableFor(db, tenantId, 'online_meeting_artifacts')
          .whereIn('meeting_id', meetingIds)
          .andWhere({ tenant: tenantId })
          .del();
      }
    } catch {
      // Ignore cleanup issues
    }
  };

  // Delete appointment request and related data
  if (ids.onlineMeetingId) {
    await safeDeleteArtifactsForMeetings({
      tenant: tenantId,
      meeting_id: ids.onlineMeetingId
    });
    await safeDelete('online_meetings', {
      tenant: tenantId,
      meeting_id: ids.onlineMeetingId
    });
  }

  if (ids.scheduleEntryId) {
    await safeDelete('online_meetings', {
      tenant: tenantId,
      schedule_entry_id: ids.scheduleEntryId
    });
  }

  if (ids.scheduleEntryId) {
    await safeDelete('schedule_entry_assignees', {
      tenant: tenantId,
      entry_id: ids.scheduleEntryId
    });
    await safeDelete('schedule_entries', {
      tenant: tenantId,
      entry_id: ids.scheduleEntryId
    });
  }

  if (ids.appointmentRequestId) {
    await safeDeleteArtifactsForMeetings({
      tenant: tenantId,
      appointment_request_id: ids.appointmentRequestId
    });
    await safeDelete('online_meetings', {
      tenant: tenantId,
      appointment_request_id: ids.appointmentRequestId
    });
    await safeDelete('appointment_requests', {
      tenant: tenantId,
      appointment_request_id: ids.appointmentRequestId
    });
  }

  if (ids.interactionId) {
    await safeDelete('interactions', {
      tenant: tenantId,
      interaction_id: ids.interactionId
    });
  }

  // Delete availability settings
  await safeDeleteIn('availability_settings', 'availability_setting_id', ids.availabilitySettingIds);

  // Delete contract data
  if (ids.contractId) {
    await safeDelete('contract_line_services', { tenant: tenantId, contract_id: ids.contractId });
    await safeDelete('contract_lines', { tenant: tenantId, contract_id: ids.contractId });
    await safeDelete('client_contracts', { tenant: tenantId, contract_id: ids.contractId });
    await safeDelete('contracts', { tenant: tenantId, contract_id: ids.contractId });
  }

  // Delete users
  if (ids.clientUserId) {
    await safeDelete('users', { tenant: tenantId, user_id: ids.clientUserId });
  }
  if (ids.technicianUserId) {
    await safeDelete('users', { tenant: tenantId, user_id: ids.technicianUserId });
  }

  // Delete contact
  if (ids.contactId) {
    await safeDelete('contacts', { tenant: tenantId, contact_name_id: ids.contactId });
  }

  // Delete client
  if (ids.clientId) {
    await safeDelete('clients', { tenant: tenantId, client_id: ids.clientId });
  }

  // Delete service
  if (ids.serviceId) {
    await safeDelete('service_catalog', { tenant: tenantId, service_id: ids.serviceId });
  }

  // Delete service type
  if (ids.serviceTypeId) {
    await safeDelete('service_types', { tenant: tenantId, id: ids.serviceTypeId });
  }
}
