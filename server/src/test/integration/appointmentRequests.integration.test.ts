import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { setupCommonMocks, createMockUser } from '../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;
let createAppointmentRequest: typeof import('server/src/lib/actions/client-portal-actions/appointmentRequestActions').createAppointmentRequest;
let approveAppointmentRequest: typeof import('server/src/lib/actions/appointmentRequestManagementActions').approveAppointmentRequest;
let declineAppointmentRequest: typeof import('server/src/lib/actions/appointmentRequestManagementActions').declineAppointmentRequest;

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
  contractId?: string;
  clientContractId?: string;
  contractLineId?: string;
  availabilitySettingIds: string[];
};
let createdIds: CreatedIds = { availabilitySettingIds: [] };

// Mock the database module to return test database
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

// Mock SystemEmailService to prevent actual email sending
vi.mock('server/src/lib/email/system/SystemEmailService', () => ({
  SystemEmailService: {
    getInstance: vi.fn(() => ({
      sendAppointmentRequestReceived: vi.fn(() => Promise.resolve()),
      sendNewAppointmentRequest: vi.fn(() => Promise.resolve()),
      sendAppointmentRequestApproved: vi.fn(() => Promise.resolve()),
      sendAppointmentRequestDeclined: vi.fn(() => Promise.resolve()),
      sendEmail: vi.fn(() => Promise.resolve())
    }))
  }
}));

// Mock event bus to prevent actual event publishing
vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(() => Promise.resolve())
}));

// Mock internal notification actions
vi.mock('server/src/lib/actions/internal-notification-actions/internalNotificationActions', () => ({
  createNotificationFromTemplateInternal: vi.fn(() => Promise.resolve())
}));

// Mock appointment helpers
vi.mock('server/src/lib/actions/appointmentHelpers', () => ({
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
}));

describe('Appointment Request Integration Tests', () => {
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

    db = await createTestDbConnection();
    await db.migrate.latest();
    tenantId = await ensureTenant(db);

    // Import the actions after mocks are set up
    ({ createAppointmentRequest } = await import('server/src/lib/actions/client-portal-actions/appointmentRequestActions'));
    ({ approveAppointmentRequest, declineAppointmentRequest } = await import('server/src/lib/actions/appointmentRequestManagementActions'));
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  afterEach(async () => {
    if (db && tenantId) {
      await cleanupCreatedRecords(db, tenantId, createdIds);
    }
    createdIds = { availabilitySettingIds: [] };
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
        service_id: serviceId,
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
      const scheduleEntry = await db('schedule_entries')
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
      const serviceId = uuidv4();
      await db('service_catalog').insert({
        tenant: tenantId,
        service_id: serviceId,
        service_name: 'Unavailable Service',
        description: 'Service with no availability',
        billing_method: 'fixed',
        default_rate: 5000
      });
      createdIds.serviceId = serviceId;

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const result = await createAppointmentRequest({
        service_id: serviceId,
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const result = await createAppointmentRequest({
        service_id: serviceId,
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const result = await createAppointmentRequest({
        service_id: serviceId,
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const SystemEmailService = (await import('server/src/lib/email/system/SystemEmailService')).SystemEmailService;
      const emailInstance = SystemEmailService.getInstance();

      const result = await createAppointmentRequest({
        service_id: serviceId,
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const { createNotificationFromTemplateInternal } = await import('server/src/lib/actions/internal-notification-actions/internalNotificationActions');

      const result = await createAppointmentRequest({
        service_id: serviceId,
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      expect(createResult.success).toBe(true);
      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      // Approve request as MSP staff
      const staffUser = createMockUser('internal', {
        user_id: 'staff-user-id',
        tenant: tenantId
      });
      setupCommonMocks({
        tenantId,
        userId: 'staff-user-id',
        user: staffUser,
        permissionCheck: () => true
      });

      const { getCurrentUserPermissions } = await import('server/src/lib/actions/user-actions/userActions');
      vi.mocked(getCurrentUserPermissions).mockResolvedValue(['user_schedule:update']);

      const approveResult = await approveAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        assigned_user_id: technicianUserId
      });

      expect(approveResult.success).toBe(true);
      expect(approveResult.data?.status).toBe('approved');
      expect(approveResult.data?.approved_by_user_id).toBe('staff-user-id');
      expect(approveResult.data?.schedule_entry_id).toBeDefined();

      // Verify schedule entry was updated
      const scheduleEntry = await db('schedule_entries')
        .where({
          entry_id: approveResult.data?.schedule_entry_id,
          tenant: tenantId
        })
        .first();

      expect(scheduleEntry).toBeDefined();
      expect(scheduleEntry.title).not.toContain('[Pending Request]');
      expect(scheduleEntry.title).toContain('Appointment:');

      // Verify assignee was set
      const assignee = await db('schedule_entry_assignees')
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      const staffUser = createMockUser('internal', {
        user_id: 'staff-user-id',
        tenant: tenantId
      });
      setupCommonMocks({ tenantId, userId: 'staff-user-id', user: staffUser, permissionCheck: () => true });

      const { getCurrentUserPermissions } = await import('server/src/lib/actions/user-actions/userActions');
      vi.mocked(getCurrentUserPermissions).mockResolvedValue(['user_schedule:update']);

      const SystemEmailService = (await import('server/src/lib/email/system/SystemEmailService')).SystemEmailService;
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      const staffUser = createMockUser('internal', {
        user_id: 'staff-user-id',
        tenant: tenantId
      });
      setupCommonMocks({ tenantId, userId: 'staff-user-id', user: staffUser, permissionCheck: () => true });

      const { getCurrentUserPermissions } = await import('server/src/lib/actions/user-actions/userActions');
      vi.mocked(getCurrentUserPermissions).mockResolvedValue(['user_schedule:update']);

      const { createNotificationFromTemplateInternal } = await import('server/src/lib/actions/internal-notification-actions/internalNotificationActions');

      await approveAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        assigned_user_id: technicianUserId
      });

      expect(createNotificationFromTemplateInternal).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          template_name: 'appointment-request-approved',
          type: 'success',
          category: 'appointments'
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      const staffUser = createMockUser('internal', {
        user_id: 'staff-user-id',
        tenant: tenantId
      });
      setupCommonMocks({ tenantId, userId: 'staff-user-id', user: staffUser, permissionCheck: () => true });

      const { getCurrentUserPermissions } = await import('server/src/lib/actions/user-actions/userActions');
      vi.mocked(getCurrentUserPermissions).mockResolvedValue(['user_schedule:update']);

      const approveResult = await approveAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        assigned_user_id: technicianUserId
      });

      expect(approveResult.success).toBe(true);

      // Verify the technician is assigned to the schedule entry
      const assignees = await db('schedule_entry_assignees')
        .where({
          entry_id: approveResult.data?.schedule_entry_id,
          tenant: tenantId
        })
        .select('user_id');

      expect(assignees.length).toBe(1);
      expect(assignees[0].user_id).toBe(technicianUserId);
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      expect(createResult.success).toBe(true);
      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      const originalScheduleEntryId = createResult.data?.schedule_entry_id;

      const staffUser = createMockUser('internal', {
        user_id: 'staff-user-id',
        tenant: tenantId
      });
      setupCommonMocks({ tenantId, userId: 'staff-user-id', user: staffUser, permissionCheck: () => true });

      const { getCurrentUserPermissions } = await import('server/src/lib/actions/user-actions/userActions');
      vi.mocked(getCurrentUserPermissions).mockResolvedValue(['user_schedule:update']);

      const declineResult = await declineAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        decline_reason: 'No technician available at requested time'
      });

      expect(declineResult.success).toBe(true);

      // Verify status was updated
      const updatedRequest = await db('appointment_requests')
        .where({
          appointment_request_id: createResult.data!.appointment_request_id,
          tenant: tenantId
        })
        .first();

      expect(updatedRequest.status).toBe('declined');
      expect(updatedRequest.declined_reason).toBe('No technician available at requested time');
      expect(updatedRequest.approved_by_user_id).toBe('staff-user-id');
      expect(updatedRequest.schedule_entry_id).toBeNull();

      // Verify schedule entry was deleted
      const scheduleEntry = await db('schedule_entries')
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;

      const staffUser = createMockUser('internal', {
        user_id: 'staff-user-id',
        tenant: tenantId
      });
      setupCommonMocks({ tenantId, userId: 'staff-user-id', user: staffUser, permissionCheck: () => true });

      const { getCurrentUserPermissions } = await import('server/src/lib/actions/user-actions/userActions');
      vi.mocked(getCurrentUserPermissions).mockResolvedValue(['user_schedule:update']);

      const SystemEmailService = (await import('server/src/lib/email/system/SystemEmailService')).SystemEmailService;
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;

      const staffUser = createMockUser('internal', {
        user_id: 'staff-user-id',
        tenant: tenantId
      });
      setupCommonMocks({ tenantId, userId: 'staff-user-id', user: staffUser, permissionCheck: () => true });

      const { getCurrentUserPermissions } = await import('server/src/lib/actions/user-actions/userActions');
      vi.mocked(getCurrentUserPermissions).mockResolvedValue(['user_schedule:update']);

      const { createNotificationFromTemplateInternal } = await import('server/src/lib/actions/internal-notification-actions/internalNotificationActions');

      await declineAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        decline_reason: 'Service temporarily unavailable'
      });

      expect(createNotificationFromTemplateInternal).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          template_name: 'appointment-request-declined',
          type: 'warning',
          category: 'appointments',
          data: expect.objectContaining({
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      expect(createResult.success).toBe(true);
      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      // Create second tenant
      const tenant2Id = uuidv4();
      await db('tenants').insert({
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
          user_id: 'staff2-user-id',
          tenant: tenant2Id
        });
        setupCommonMocks({ tenantId: tenant2Id, userId: 'staff2-user-id', user: staffUser2, permissionCheck: () => true });

        const { getCurrentUserPermissions } = await import('server/src/lib/actions/user-actions/userActions');
        vi.mocked(getCurrentUserPermissions).mockResolvedValue(['user_schedule:update']);

        const approveResult = await approveAppointmentRequest({
          appointment_request_id: createResult.data!.appointment_request_id,
          assigned_user_id: clientUserId // This user doesn't exist in tenant2
        });

        // Should fail because request doesn't exist in tenant2
        expect(approveResult.success).toBe(false);
        expect(approveResult.error).toContain('not found');
      } finally {
        // Cleanup second tenant
        await db('tenants').where({ tenant: tenant2Id }).del();
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const pastDate = yesterday.toISOString().split('T')[0];

      const result = await createAppointmentRequest({
        service_id: serviceId,
        requested_date: pastDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/past|future|invalid date/i);
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const result = await createAppointmentRequest({
        service_id: serviceId,
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const result = await createAppointmentRequest({
        service_id: serviceId,
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      // Approve it
      const staffUser = createMockUser('internal', {
        user_id: 'staff-user-id',
        tenant: tenantId
      });
      setupCommonMocks({ tenantId, userId: 'staff-user-id', user: staffUser, permissionCheck: () => true });

      const { getCurrentUserPermissions } = await import('server/src/lib/actions/user-actions/userActions');
      vi.mocked(getCurrentUserPermissions).mockResolvedValue(['user_schedule:update']);

      await approveAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        assigned_user_id: technicianUserId
      });

      // Try to update the approved request as client
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const { updateAppointmentRequest } = await import('server/src/lib/actions/client-portal-actions/appointmentRequestActions');

      const updateResult = await updateAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        requested_time: '15:00'
      });

      expect(updateResult.success).toBe(false);
      expect(updateResult.error).toMatch(/pending|cannot update|already/i);
    });

    it('should reject canceling already approved request', async () => {
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      // Approve it
      const staffUser = createMockUser('internal', {
        user_id: 'staff-user-id',
        tenant: tenantId
      });
      setupCommonMocks({ tenantId, userId: 'staff-user-id', user: staffUser, permissionCheck: () => true });

      const { getCurrentUserPermissions } = await import('server/src/lib/actions/user-actions/userActions');
      vi.mocked(getCurrentUserPermissions).mockResolvedValue(['user_schedule:update']);

      await approveAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        assigned_user_id: technicianUserId
      });

      // Try to cancel the approved request as client
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const { cancelAppointmentRequest } = await import('server/src/lib/actions/client-portal-actions/appointmentRequestActions');

      const cancelResult = await cancelAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id
      });

      expect(cancelResult.success).toBe(false);
      expect(cancelResult.error).toMatch(/pending|cannot cancel|already/i);
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      // Approve it once
      const staffUser = createMockUser('internal', {
        user_id: 'staff-user-id',
        tenant: tenantId
      });
      setupCommonMocks({ tenantId, userId: 'staff-user-id', user: staffUser, permissionCheck: () => true });

      const { getCurrentUserPermissions } = await import('server/src/lib/actions/user-actions/userActions');
      vi.mocked(getCurrentUserPermissions).mockResolvedValue(['user_schedule:update']);

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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const result = await createAppointmentRequest({
        service_id: serviceId,
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      // Create appointment request with preferred technician (system should still accept)
      const result = await createAppointmentRequest({
        service_id: serviceId,
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

      // Create a ticket
      const ticketNumber = Math.floor(Math.random() * 100000);
      const [ticketId] = await db('tickets').insert({
        tenant: tenantId,
        ticket_number: ticketNumber,
        title: 'Test Ticket',
        company_id: clientId,
        entered_by: clientUserId,
        status_id: uuidv4(),
        channel_id: uuidv4(),
        priority_id: uuidv4(),
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      }).returning('ticket_id');

      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const result = await createAppointmentRequest({
        service_id: serviceId,
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
      await db('tickets').where({ ticket_id: ticketId, tenant: tenantId }).del();
    });

    it('should allow staff to associate request to ticket during approval', async () => {
      const { clientId, contactId, serviceId, clientUserId, technicianUserId } = await setupTestData(db, tenantId);
      createdIds.clientId = clientId;
      createdIds.contactId = contactId;
      createdIds.serviceId = serviceId;
      createdIds.clientUserId = clientUserId;
      createdIds.technicianUserId = technicianUserId;

      // Create a ticket
      const ticketNumber = Math.floor(Math.random() * 100000);
      const [ticketId] = await db('tickets').insert({
        tenant: tenantId,
        ticket_number: ticketNumber,
        title: 'Test Ticket for Association',
        company_id: clientId,
        entered_by: clientUserId,
        status_id: uuidv4(),
        channel_id: uuidv4(),
        priority_id: uuidv4(),
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      }).returning('ticket_id');

      // Create appointment request without ticket
      const clientUser = createMockUser('client', {
        user_id: clientUserId,
        tenant: tenantId,
        contact_id: contactId
      });
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      // Associate ticket as staff during approval
      const staffUser = createMockUser('internal', {
        user_id: 'staff-user-id',
        tenant: tenantId
      });
      setupCommonMocks({ tenantId, userId: 'staff-user-id', user: staffUser, permissionCheck: () => true });

      const { getCurrentUserPermissions } = await import('server/src/lib/actions/user-actions/userActions');
      vi.mocked(getCurrentUserPermissions).mockResolvedValue(['user_schedule:update']);

      const { associateRequestToTicket } = await import('server/src/lib/actions/appointmentRequestManagementActions');

      const associateResult = await associateRequestToTicket({
        appointment_request_id: createResult.data!.appointment_request_id,
        ticket_id: ticketId
      });

      expect(associateResult.success).toBe(true);

      // Verify association
      const updatedRequest = await db('appointment_requests')
        .where({
          appointment_request_id: createResult.data!.appointment_request_id,
          tenant: tenantId
        })
        .first();

      expect(updatedRequest.ticket_id).toBe(ticketId);

      // Cleanup ticket
      await db('tickets').where({ ticket_id: ticketId, tenant: tenantId }).del();
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      // Update date/time as staff
      const staffUser = createMockUser('internal', {
        user_id: 'staff-user-id',
        tenant: tenantId
      });
      setupCommonMocks({ tenantId, userId: 'staff-user-id', user: staffUser, permissionCheck: () => true });

      const { getCurrentUserPermissions } = await import('server/src/lib/actions/user-actions/userActions');
      vi.mocked(getCurrentUserPermissions).mockResolvedValue(['user_schedule:update']);

      const { updateAppointmentRequestDateTime } = await import('server/src/lib/actions/appointmentRequestManagementActions');

      const updateResult = await updateAppointmentRequestDateTime({
        appointment_request_id: createResult.data!.appointment_request_id,
        requested_date: requestDate,
        requested_time: '15:30',
        requested_duration: 90
      });

      expect(updateResult.success).toBe(true);
      expect(updateResult.data?.requested_time).toBe('15:30');
      expect(updateResult.data?.requested_duration).toBe(90);

      // Verify schedule entry was also updated
      const scheduleEntry = await db('schedule_entries')
        .where({
          entry_id: createResult.data?.schedule_entry_id,
          tenant: tenantId
        })
        .first();

      expect(scheduleEntry).toBeDefined();
      const startTime = new Date(scheduleEntry.scheduled_start);
      expect(startTime.getHours()).toBe(15);
      expect(startTime.getMinutes()).toBe(30);
    });

    it('should not allow updating date/time after approval', async () => {
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
      setupCommonMocks({ tenantId, userId: clientUserId, user: clientUser, permissionCheck: () => true });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const requestDate = tomorrow.toISOString().split('T')[0];

      const createResult = await createAppointmentRequest({
        service_id: serviceId,
        requested_date: requestDate,
        requested_time: '14:00',
        requested_duration: 60
      });

      createdIds.appointmentRequestId = createResult.data?.appointment_request_id;
      createdIds.scheduleEntryId = createResult.data?.schedule_entry_id;

      // Approve it
      const staffUser = createMockUser('internal', {
        user_id: 'staff-user-id',
        tenant: tenantId
      });
      setupCommonMocks({ tenantId, userId: 'staff-user-id', user: staffUser, permissionCheck: () => true });

      const { getCurrentUserPermissions } = await import('server/src/lib/actions/user-actions/userActions');
      vi.mocked(getCurrentUserPermissions).mockResolvedValue(['user_schedule:update']);

      await approveAppointmentRequest({
        appointment_request_id: createResult.data!.appointment_request_id,
        assigned_user_id: technicianUserId
      });

      // Try to update date/time after approval
      const { updateAppointmentRequestDateTime } = await import('server/src/lib/actions/appointmentRequestManagementActions');

      const updateResult = await updateAppointmentRequestDateTime({
        appointment_request_id: createResult.data!.appointment_request_id,
        requested_date: requestDate,
        requested_time: '16:00',
        requested_duration: 60
      });

      expect(updateResult.success).toBe(false);
      expect(updateResult.error).toMatch(/pending|cannot update|already/i);
    });
  });
});

/**
 * Helper function to ensure a tenant exists in the test database
 */
async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await connection('tenants').first<{ tenant: string }>('tenant');
  if (existing?.tenant) {
    return existing.tenant;
  }

  const newTenantId = uuidv4();
  await connection('tenants').insert({
    tenant: newTenantId,
    client_name: 'Appointment Request Integration Test Tenant',
    email: 'appointment-test@test.com',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now()
  });
  return newTenantId;
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
  await db('clients').insert({
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
  await db('contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    client_id: clientId,
    full_name: 'Test Contact',
    email: 'contact@test.com',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  // Create client user
  const clientUserId = uuidv4();
  await db('users').insert({
    tenant: tenantId,
    user_id: clientUserId,
    username: `client_${clientId.slice(0, 8)}`,
    first_name: 'Client',
    last_name: 'User',
    email: 'client@test.com',
    hashed_password: 'hashed',
    user_type: 'client',
    contact_id: contactId,
    is_inactive: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  // Create technician user
  const technicianUserId = uuidv4();
  await db('users').insert({
    tenant: tenantId,
    user_id: technicianUserId,
    username: `tech_${clientId.slice(0, 8)}`,
    first_name: 'Technician',
    last_name: 'User',
    email: 'tech@test.com',
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
    await db('service_types').insert({
      id: serviceTypeId,
      tenant: tenantId,
      name: `Service Type ${serviceTypeId.slice(0, 8)}`,
      billing_method: 'fixed',
      order_number: Math.floor(Math.random() * 1000000),
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    // Create service
    serviceId = uuidv4();
    await db('service_catalog').insert({
      tenant: tenantId,
      service_id: serviceId,
      service_name: 'Test Service',
      description: 'Service for testing',
      billing_method: 'fixed',
      default_rate: 10000,
      custom_service_type_id: serviceTypeId
    });

    // Create availability setting for service
    const availabilitySettingId = uuidv4();
    await db('availability_settings').insert({
      availability_setting_id: availabilitySettingId,
      tenant: tenantId,
      setting_type: 'service_rules',
      service_id: serviceId,
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
    await db('availability_settings').insert({
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
      await db('contracts').insert({
        tenant: tenantId,
        contract_id: contractId,
        contract_name: 'Test Contract',
        description: 'Contract for testing',
        start_date: new Date('2025-01-01'),
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      });

      // Create client contract
      clientContractId = uuidv4();
      await db('client_contracts').insert({
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
      await db('contract_lines').insert({
        tenant: tenantId,
        contract_line_id: contractLineId,
        contract_id: contractId,
        line_type: 'Service',
        start_date: new Date('2025-01-01'),
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      });

      // Create contract line service
      await db('contract_line_services').insert({
        tenant: tenantId,
        contract_line_id: contractLineId,
        service_id: serviceId,
        quantity: 1,
        created_at: db.fn.now()
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
      await db(table).where(where).del();
    } catch {
      // Ignore cleanup issues
    }
  };

  const safeDeleteIn = async (table: string, column: string, values: string[]) => {
    if (!values || values.length === 0) {
      return;
    }
    try {
      await db(table).whereIn(column, values).andWhere({ tenant: tenantId }).del();
    } catch {
      // Ignore cleanup issues
    }
  };

  // Delete appointment request and related data
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
    await safeDelete('appointment_requests', {
      tenant: tenantId,
      appointment_request_id: ids.appointmentRequestId
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
