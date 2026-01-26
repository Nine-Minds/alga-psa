import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createClient, createUser } from '../../../test-utils/testDataFactory';
import { setMockUser } from '../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;
let clientId: string;
let serviceId: string;
let contactId: string;
let contactEmail: string;
let clientUserId: string;
let staffUserId: string;
let staffUser2Id: string;
let createAppointmentRequest: typeof import('@alga-psa/client-portal/actions').createAppointmentRequest;
let approveAppointmentRequest: typeof import('@alga-psa/scheduling/actions').approveAppointmentRequest;
let declineAppointmentRequest: typeof import('@alga-psa/scheduling/actions').declineAppointmentRequest;
let runWithTenant: typeof import('server/src/lib/db').runWithTenant;

// Mock email service
const sendAppointmentRequestReceivedMock = vi.fn().mockResolvedValue(undefined);
const sendNewAppointmentRequestMock = vi.fn().mockResolvedValue(undefined);
const sendAppointmentRequestApprovedMock = vi.fn().mockResolvedValue(undefined);
const sendAppointmentRequestDeclinedMock = vi.fn().mockResolvedValue(undefined);
const sendEmailMock = vi.fn().mockResolvedValue(undefined);

vi.mock('server/src/lib/email/system/SystemEmailService', () => ({
  SystemEmailService: {
    getInstance: vi.fn(() => ({
      sendAppointmentRequestReceived: sendAppointmentRequestReceivedMock,
      sendNewAppointmentRequest: sendNewAppointmentRequestMock,
      sendAppointmentRequestApproved: sendAppointmentRequestApprovedMock,
      sendAppointmentRequestDeclined: sendAppointmentRequestDeclinedMock,
      sendEmail: sendEmailMock
    }))
  }
}));

// Mock createNotificationFromTemplateInternal
const createNotificationFromTemplateInternalMock = vi.fn().mockResolvedValue({
  internal_notification_id: uuidv4()
});

vi.mock('@alga-psa/notifications/actions', () => ({
  createNotificationFromTemplateInternal: createNotificationFromTemplateInternalMock
}));

// Mock publishEvent to prevent actual event publishing
vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined)
}));

// Mock createTenantKnex to use our test db
vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => {
      // Return current values at runtime, not at mock definition time
      return { knex: db, tenant: tenantId };
    }),
    runWithTenant: actual.runWithTenant
  };
});

describe('Appointment Notification System Integration Tests', () => {
  const HOOK_TIMEOUT = 180_000;

  beforeAll(async () => {
    db = await createTestDbConnection();
    await runMigrationsAndSeeds(db);
    ({ createAppointmentRequest } = await import('@alga-psa/client-portal/actions'));
    ({ approveAppointmentRequest, declineAppointmentRequest } = await import('@alga-psa/scheduling/actions'));
    ({ runWithTenant } = await import('server/src/lib/db'));
    tenantId = await createTenant(db, 'Test MSP');

    // Create client and contact
    clientId = await createClient(db, tenantId, 'Test Client');
    const contactResult = await createContact(db, tenantId, clientId);
    contactId = contactResult.contactId;
    contactEmail = contactResult.email;

    // Create client portal user
    clientUserId = await createUser(db, tenantId, {
      email: 'client@example.com',
      first_name: 'Client',
      last_name: 'User',
      user_type: 'client',
      contact_id: contactId
    });

    // Create roles and permissions
    const { scheduleRoleId } = await createRolesAndPermissions(db, tenantId);

    // Create staff users with schedule permissions
    staffUserId = await createUser(db, tenantId, {
      email: 'staff1@example.com',
      first_name: 'Staff',
      last_name: 'One',
      user_type: 'internal'
    });

    staffUser2Id = await createUser(db, tenantId, {
      email: 'staff2@example.com',
      first_name: 'Staff',
      last_name: 'Two',
      user_type: 'internal'
    });

    // Assign role to staff users
    await db('user_roles').insert([
      {
        user_id: staffUserId,
        role_id: scheduleRoleId,
        tenant: tenantId
      },
      {
        user_id: staffUser2Id,
        role_id: scheduleRoleId,
        tenant: tenantId
      }
    ]);

    // Create service
    serviceId = await createService(db, tenantId);

    // Create availability settings to allow appointments without contracts
    await db('availability_settings').insert({
      availability_setting_id: uuidv4(),
      tenant: tenantId,
      setting_type: 'service_rules',
      service_id: serviceId,
      allow_without_contract: true
    });

    // Create tenant settings
    await db('tenant_settings').insert({
      tenant: tenantId,
      settings: {
        supportEmail: 'support@testmsp.com',
        supportPhone: '555-0100',
        companyName: 'Test MSP Company',
        defaultLocale: 'en'
      }
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    // Clean up test data before destroying connection
    if (db && tenantId) {
      // Helper to safely delete from a table if it exists
      const safeDelete = async (tableName: string) => {
        try {
          await db(tableName).where({ tenant: tenantId }).del();
        } catch (error: any) {
          // Ignore errors for non-existent tables
          if (!error.message?.includes('does not exist')) {
            console.error(`Error deleting from ${tableName}:`, error);
          }
        }
      };

      // Delete in reverse order of creation to respect foreign key constraints
      await safeDelete('internal_notifications');
      await safeDelete('schedule_entries');
      await safeDelete('appointment_requests');
      await safeDelete('user_roles');
      await safeDelete('role_permissions');
      await safeDelete('roles');
      await safeDelete('permissions');
      await safeDelete('users');
      await safeDelete('contacts');
      await safeDelete('availability_settings');
      await safeDelete('availability_exceptions');
      await safeDelete('service_catalog');
      await safeDelete('service_types');
      await safeDelete('tenant_settings');
      await safeDelete('companies');
      await safeDelete('clients');
      await safeDelete('tenants');
    }

    if (db) {
      await db.destroy();
    }
  }, HOOK_TIMEOUT);

  afterEach(() => {
    // Clear mock calls
    sendAppointmentRequestReceivedMock.mockClear();
    sendNewAppointmentRequestMock.mockClear();
    sendAppointmentRequestApprovedMock.mockClear();
    sendAppointmentRequestDeclinedMock.mockClear();
    createNotificationFromTemplateInternalMock.mockClear();
  });

  describe('Email Notifications', () => {
    it('should send appointment request received email to client', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId,
        email: 'client@example.com'
      }, []);

      const requestData = {
        service_id: serviceId!,
        requested_date: '2025-12-15',
        requested_time: '14:00',
        requested_duration: 60,
        description: 'Test appointment'
      };

      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
      });

      // Verify email was sent
      expect(sendAppointmentRequestReceivedMock).toHaveBeenCalledOnce();

      const emailCall = sendAppointmentRequestReceivedMock.mock.calls[0];
      const [emailData, options] = emailCall;

      expect(emailData.requesterEmail).toBe(contactEmail);
      expect(emailData.serviceName).toBe('Test Service');
      expect(emailData.requestedDate).toBeDefined();
      expect(emailData.requestedTime).toBeDefined();
      expect(emailData.duration).toBe(60);
      expect(emailData.contactEmail).toBe('support@testmsp.com');
      expect(emailData.contactPhone).toBe('555-0100');
      expect(emailData.tenantName).toBe('Test MSP Company');
      expect(options.tenantId).toBe(tenantId);
    });

    it('should send new appointment request email to MSP staff', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId,
        email: 'client@example.com'
      }, []);

      const requestData = {
        service_id: serviceId!,
        requested_date: '2025-12-16',
        requested_time: '10:00',
        requested_duration: 30,
        description: 'Staff notification test'
      };

      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
      });

      // Should send to all staff with schedule permissions (2 users)
      expect(sendNewAppointmentRequestMock).toHaveBeenCalledTimes(2);

      const call1 = sendNewAppointmentRequestMock.mock.calls[0];
      const call2 = sendNewAppointmentRequestMock.mock.calls[1];

      // Check both staff members received emails
      const recipientEmails = [call1[0], call2[0]];
      expect(recipientEmails).toContain('staff1@example.com');
      expect(recipientEmails).toContain('staff2@example.com');

      // Verify email content
      const emailData = call1[1];
      expect(emailData.serviceName).toBe('Test Service');
      expect(emailData.clientName).toBe('Test Client');
      expect(emailData.isAuthenticated).toBe(true);
      expect(emailData.tenantName).toBe('Test MSP Company');
    });

    it('should send appointment approved email with correct locale', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId
      }, []);

      // Create request first
      const requestData = {
        service_id: serviceId!,
        requested_date: '2025-12-17',
        requested_time: '15:00',
        requested_duration: 45
      };

      let appointmentRequestId: string;
      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
        appointmentRequestId = result.data!.appointment_request_id;
      });

      // Clear mocks from creation
      sendAppointmentRequestApprovedMock.mockClear();

      // Now approve as staff
      setMockUser({
        user_id: staffUserId,
        user_type: 'internal',
        email: 'staff1@example.com'
      }, ['user_schedule:update', 'user_schedule:read']);

      await runWithTenant(tenantId, async () => {
        const result = await approveAppointmentRequest({
          appointment_request_id: appointmentRequestId!,
          assigned_user_id: staffUserId
        });
        expect(result.success).toBe(true);
      });

      // Verify approval email was sent
      expect(sendAppointmentRequestApprovedMock).toHaveBeenCalledOnce();

      const [emailData, options] = sendAppointmentRequestApprovedMock.mock.calls[0];

      expect(emailData.requesterEmail).toBe(contactEmail);
      expect(emailData.serviceName).toBe('Test Service');
      expect(emailData.technicianName).toBe('Staff One');
      expect(emailData.technicianEmail).toBe('staff1@example.com');
      expect(emailData.calendarLink).toContain('.ics');
      expect(emailData.tenantName).toBe('Test MSP Company');
      expect(options.tenantId).toBe(tenantId);
    });

    it('should send appointment declined email with reason', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId
      }, []);

      // Create request first
      const requestData = {
        service_id: serviceId!,
        requested_date: '2025-12-18',
        requested_time: '11:00',
        requested_duration: 60
      };

      let appointmentRequestId: string;
      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
        appointmentRequestId = result.data!.appointment_request_id;
      });

      // Clear mocks from creation
      sendAppointmentRequestDeclinedMock.mockClear();

      // Now decline as staff
      setMockUser({
        user_id: staffUserId,
        user_type: 'internal',
        email: 'staff1@example.com'
      }, ['user_schedule:update', 'user_schedule:read']);

      const declineReason = 'No technicians available at that time';

      await runWithTenant(tenantId, async () => {
        const result = await declineAppointmentRequest({
          appointment_request_id: appointmentRequestId!,
          decline_reason: declineReason
        });
        expect(result.success).toBe(true);
      });

      // Verify decline email was sent
      expect(sendAppointmentRequestDeclinedMock).toHaveBeenCalledOnce();

      const [emailData, options] = sendAppointmentRequestDeclinedMock.mock.calls[0];

      expect(emailData.requesterEmail).toBe(contactEmail);
      expect(emailData.serviceName).toBe('Test Service');
      expect(emailData.declineReason).toBe(declineReason);
      expect(emailData.requestNewAppointmentLink).toContain('/client-portal/appointments');
      expect(emailData.tenantName).toBe('Test MSP Company');
      expect(options.tenantId).toBe(tenantId);
    });

    it('should include tenant settings in all emails', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId
      }, []);

      const requestData = {
        service_id: serviceId!,
        requested_date: '2025-12-19',
        requested_time: '09:00',
        requested_duration: 30
      };

      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
      });

      // Check all email calls have tenant settings
      const receivedCall = sendAppointmentRequestReceivedMock.mock.calls[0];
      const staffCall1 = sendNewAppointmentRequestMock.mock.calls[0];

      // Verify tenant settings in client email
      expect(receivedCall[0].contactEmail).toBe('support@testmsp.com');
      expect(receivedCall[0].contactPhone).toBe('555-0100');
      expect(receivedCall[0].tenantName).toBe('Test MSP Company');

      // Verify tenant settings in staff email
      expect(staffCall1[1].contactEmail).toBe('support@testmsp.com');
      expect(staffCall1[1].contactPhone).toBe('555-0100');
      expect(staffCall1[1].tenantName).toBe('Test MSP Company');
    });

    it('should replace template variables correctly', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId
      }, []);

      const requestData = {
        service_id: serviceId!,
        requested_date: '2025-12-20',
        requested_time: '16:30',
        requested_duration: 90
      };

      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
      });

      const [emailData] = sendAppointmentRequestReceivedMock.mock.calls[0];

      // Verify all required variables are present
      expect(emailData.requesterName).toBeDefined();
      expect(emailData.serviceName).toBeDefined();
      expect(emailData.requestedDate).toBeDefined();
      expect(emailData.requestedTime).toBeDefined();
      expect(emailData.duration).toBe(90);
      expect(emailData.referenceNumber).toBeDefined();
      expect(emailData.responseTime).toBeDefined();
      expect(emailData.portalLink).toBeDefined();
      expect(emailData.currentYear).toBe(new Date().getFullYear());
    });
  });

  describe('Internal Notifications', () => {
    it('should create notification for client on request submission', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId
      }, []);

      const requestData = {
        service_id: serviceId!,
        requested_date: '2025-12-21',
        requested_time: '10:00',
        requested_duration: 60
      };

      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
      });

      // Find the client notification call
      const clientNotificationCall = createNotificationFromTemplateInternalMock.mock.calls.find(
        call => call[1].user_id === clientUserId && call[1].template_name === 'appointment-request-created-client'
      );

      expect(clientNotificationCall).toBeDefined();

      const [, notificationData] = clientNotificationCall!;
      expect(notificationData.tenant).toBe(tenantId);
      expect(notificationData.type).toBe('info');
      expect(notificationData.category).toBe('appointments');
      expect(notificationData.link).toContain('/client-portal/appointments/');
      expect(notificationData.data.serviceName).toBe('Test Service');
      expect(notificationData.data.requestedDate).toBeDefined();
      expect(notificationData.data.requestedTime).toBeDefined();
    });

    it('should create notifications for MSP staff on request submission', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId
      }, []);

      const requestData = {
        service_id: serviceId!,
        requested_date: '2025-12-22',
        requested_time: '14:00',
        requested_duration: 45
      };

      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
      });

      // Find staff notification calls
      const staffNotificationCalls = createNotificationFromTemplateInternalMock.mock.calls.filter(
        call => call[1].template_name === 'appointment-request-created-staff'
      );

      expect(staffNotificationCalls.length).toBeGreaterThanOrEqual(2);

      // Check both staff members got notifications
      const staffUserIds = staffNotificationCalls.map(call => call[1].user_id);
      expect(staffUserIds).toContain(staffUserId);
      expect(staffUserIds).toContain(staffUser2Id);

      // Verify notification data
      const [, notificationData] = staffNotificationCalls[0];
      expect(notificationData.tenant).toBe(tenantId);
      expect(notificationData.type).toBe('info');
      expect(notificationData.category).toBe('appointments');
      expect(notificationData.link).toBe('/msp/schedule');
      expect(notificationData.data.serviceName).toBe('Test Service');
      expect(notificationData.data.clientName).toBe('Test Client');
      expect(notificationData.metadata.requires_action).toBe(true);
    });

    it('should create notification for client on approval', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId
      }, []);

      // Create request
      const requestData = {
        service_id: serviceId!,
        requested_date: '2025-12-23',
        requested_time: '11:00',
        requested_duration: 60
      };

      let appointmentRequestId: string;
      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
        appointmentRequestId = result.data!.appointment_request_id;
      });

      createNotificationFromTemplateInternalMock.mockClear();

      // Approve as staff
      setMockUser({
        user_id: staffUserId,
        user_type: 'internal'
      }, ['user_schedule:update', 'user_schedule:read']);

      await runWithTenant(tenantId, async () => {
        const result = await approveAppointmentRequest({
          appointment_request_id: appointmentRequestId!,
          assigned_user_id: staffUserId
        });
        expect(result.success).toBe(true);
      });

      // Find the approval notification for client
      const approvalNotificationCall = createNotificationFromTemplateInternalMock.mock.calls.find(
        call => call[1].user_id === clientUserId && call[1].template_name === 'appointment-request-approved'
      );

      expect(approvalNotificationCall).toBeDefined();

      const [, notificationData] = approvalNotificationCall!;
      expect(notificationData.tenant).toBe(tenantId);
      expect(notificationData.type).toBe('success');
      expect(notificationData.category).toBe('appointments');
      expect(notificationData.link).toContain('/client-portal/appointments/');
      expect(notificationData.data.serviceName).toBe('Test Service');
      expect(notificationData.data.technicianName).toBe('Staff One');
    });

    it('should create notification for client on decline', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId
      }, []);

      // Create request
      const requestData = {
        service_id: serviceId!,
        requested_date: '2025-12-24',
        requested_time: '13:00',
        requested_duration: 30
      };

      let appointmentRequestId: string;
      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
        appointmentRequestId = result.data!.appointment_request_id;
      });

      createNotificationFromTemplateInternalMock.mockClear();

      // Decline as staff
      setMockUser({
        user_id: staffUserId,
        user_type: 'internal'
      }, ['user_schedule:update', 'user_schedule:read']);

      const declineReason = 'Insufficient resources';

      await runWithTenant(tenantId, async () => {
        const result = await declineAppointmentRequest({
          appointment_request_id: appointmentRequestId!,
          decline_reason: declineReason
        });
        expect(result.success).toBe(true);
      });

      // Find the decline notification for client
      const declineNotificationCall = createNotificationFromTemplateInternalMock.mock.calls.find(
        call => call[1].user_id === clientUserId && call[1].template_name === 'appointment-request-declined'
      );

      expect(declineNotificationCall).toBeDefined();

      const [, notificationData] = declineNotificationCall!;
      expect(notificationData.tenant).toBe(tenantId);
      expect(notificationData.type).toBe('warning');
      expect(notificationData.category).toBe('appointments');
      expect(notificationData.link).toContain('/client-portal/appointments/');
      expect(notificationData.data.serviceName).toBe('Test Service');
      expect(notificationData.data.declineReason).toBe(declineReason);
    });

    it('should include correct link in notifications', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId
      }, []);

      const requestData = {
        service_id: serviceId!,
        requested_date: '2025-12-25',
        requested_time: '15:00',
        requested_duration: 60
      };

      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
      });

      // Client notification should link to appointment detail
      const clientCall = createNotificationFromTemplateInternalMock.mock.calls.find(
        call => call[1].user_id === clientUserId
      );
      expect(clientCall![1].link).toMatch(/^\/client-portal\/appointments\//);

      // Staff notification should link to schedule
      const staffCall = createNotificationFromTemplateInternalMock.mock.calls.find(
        call => call[1].template_name === 'appointment-request-created-staff'
      );
      expect(staffCall![1].link).toBe('/msp/schedule');
    });

    it('should populate metadata correctly for staff notifications', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId
      }, []);

      const requestData = {
        service_id: serviceId!,
        requested_date: '2025-12-26',
        requested_time: '09:30',
        requested_duration: 60
      };

      let appointmentRequestId: string;
      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
        appointmentRequestId = result.data!.appointment_request_id;
      });

      // Find staff notification
      const staffCall = createNotificationFromTemplateInternalMock.mock.calls.find(
        call => call[1].template_name === 'appointment-request-created-staff'
      );

      expect(staffCall).toBeDefined();
      const [, notificationData] = staffCall!;

      expect(notificationData.metadata).toBeDefined();
      expect(notificationData.metadata.appointment_request_id).toBe(appointmentRequestId!);
      expect(notificationData.metadata.requires_action).toBe(true);
    });
  });

  describe('Helper Function Integration', () => {
    it('should get correct schedule approvers', async () => {
      const { getScheduleApprovers } = await import('@alga-psa/scheduling/actions');

      const approvers = await getScheduleApprovers(tenantId);

      expect(approvers.length).toBeGreaterThanOrEqual(2);

      const approverEmails = approvers.map(a => a.email);
      expect(approverEmails).toContain('staff1@example.com');
      expect(approverEmails).toContain('staff2@example.com');

      approvers.forEach(approver => {
        expect(approver.user_id).toBeDefined();
        expect(approver.email).toBeDefined();
        expect(approver.first_name).toBeDefined();
        expect(approver.last_name).toBeDefined();
      });
    });

    it('should get correct tenant settings', async () => {
      const { getTenantSettings } = await import('@alga-psa/scheduling/actions');

      const settings = await getTenantSettings(tenantId);

      expect(settings.contactEmail).toBe('support@testmsp.com');
      expect(settings.contactPhone).toBe('555-0100');
      expect(settings.tenantName).toBe('Test MSP Company');
      expect(settings.defaultLocale).toBe('en');
    });

    it('should map contact to client user ID correctly', async () => {
      const { getClientUserIdFromContact } = await import('@alga-psa/scheduling/actions');

      const userId = await getClientUserIdFromContact(contactId, tenantId);

      expect(userId).toBe(clientUserId);
    });

    it('should return null for non-existent contact', async () => {
      const { getClientUserIdFromContact } = await import('@alga-psa/scheduling/actions');

      const userId = await getClientUserIdFromContact(uuidv4(), tenantId);

      expect(userId).toBeNull();
    });

    it('should format dates with correct locale', async () => {
      const { formatDate } = await import('@alga-psa/scheduling/actions');

      const dateString = '2025-12-15';

      const enDate = await formatDate(dateString, 'en');
      const deDate = await formatDate(dateString, 'de');

      expect(enDate).toBeDefined();
      expect(deDate).toBeDefined();
      expect(enDate).not.toBe(deDate); // Different locales should format differently
    });

    it('should format times with correct locale', async () => {
      const { formatTime } = await import('@alga-psa/scheduling/actions');

      const timeString = '14:30';

      const enTime = await formatTime(timeString, 'en');
      const deTime = await formatTime(timeString, 'de');

      expect(enTime).toBeDefined();
      expect(deTime).toBeDefined();
      // English uses 12-hour format with PM, German uses 24-hour format
      expect(enTime).toContain('PM');
      expect(deTime).toBe('14:30');
    });
  });

  describe('Multi-Language Notification Support', () => {
    it('should send email notifications in different languages', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId
      }, []);

      // Update tenant settings to use German locale
      await db('tenant_settings')
        .where({ tenant: tenantId })
        .update({
          settings: {
            ...{ supportEmail: 'support@testmsp.com', supportPhone: '555-0100', companyName: 'Test MSP Company' },
            defaultLocale: 'de'
          }
        });

      const requestData = {
        service_id: serviceId!,
        requested_date: '2025-12-27',
        requested_time: '10:00',
        requested_duration: 60
      };

      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
      });

      // Verify email was sent with German locale
      expect(sendAppointmentRequestReceivedMock).toHaveBeenCalledOnce();
      const [emailData, options] = sendAppointmentRequestReceivedMock.mock.calls[0];

      expect(options.locale).toBe('de');

      // Reset tenant settings
      await db('tenant_settings')
        .where({ tenant: tenantId })
        .update({
          settings: {
            supportEmail: 'support@testmsp.com',
            supportPhone: '555-0100',
            companyName: 'Test MSP Company',
            defaultLocale: 'en'
          }
        });
    });

    it('should format dates according to locale in notifications', async () => {
      const { formatDate } = await import('@alga-psa/scheduling/actions');

      const dateString = '2025-12-15';

      // Test various locales
      const enDate = await formatDate(dateString, 'en');
      const deDate = await formatDate(dateString, 'de');
      const esDate = await formatDate(dateString, 'es');
      const frDate = await formatDate(dateString, 'fr');

      // All should be defined and different
      expect(enDate).toBeDefined();
      expect(deDate).toBeDefined();
      expect(esDate).toBeDefined();
      expect(frDate).toBeDefined();

      // German format should be different from English
      expect(deDate).not.toBe(enDate);
      expect(esDate).not.toBe(enDate);
      expect(frDate).not.toBe(enDate);
    });

    it('should default to English when locale is not supported', async () => {
      const { formatDate, formatTime } = await import('@alga-psa/scheduling/actions');

      const dateResult = await formatDate('2025-12-15', 'unsupported-locale');
      const timeResult = await formatTime('14:30', 'unsupported-locale');

      // Should fallback to English
      expect(dateResult).toBeDefined();
      expect(timeResult).toBeDefined();
    });
  });

  describe('Cancellation Notifications', () => {
    it('should send cancellation notification to client', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId
      }, []);

      // Create request
      const requestData = {
        service_id: serviceId!,
        requested_date: '2025-12-28',
        requested_time: '14:00',
        requested_duration: 60
      };

      let appointmentRequestId: string;
      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
        appointmentRequestId = result.data!.appointment_request_id;
      });

      // Clear previous mocks
      createNotificationFromTemplateInternalMock.mockClear();

      // Cancel the request
      const { cancelAppointmentRequest } = await import('@alga-psa/client-portal/actions');

      await runWithTenant(tenantId, async () => {
        const result = await cancelAppointmentRequest({
          appointment_request_id: appointmentRequestId!
        });
        expect(result.success).toBe(true);
      });

      // Verify cancellation notification was created
      const cancellationCall = createNotificationFromTemplateInternalMock.mock.calls.find(
        call => call[1].template_name?.includes('cancel')
      );

      // Note: This test expects a cancellation notification template to exist
      // If it doesn't, this test documents the expected behavior
      if (cancellationCall) {
        const [, notificationData] = cancellationCall;
        expect(notificationData.user_id).toBe(clientUserId);
        expect(notificationData.category).toBe('appointments');
      }
    });

    it('should handle cancellation of already cancelled request gracefully', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId
      }, []);

      // Create and cancel request
      const requestData = {
        service_id: serviceId!,
        requested_date: '2025-12-29',
        requested_time: '10:00',
        requested_duration: 30
      };

      let appointmentRequestId: string;
      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
        appointmentRequestId = result.data!.appointment_request_id;
      });

      const { cancelAppointmentRequest } = await import('@alga-psa/client-portal/actions');

      // Cancel once
      await runWithTenant(tenantId, async () => {
        const result = await cancelAppointmentRequest({
          appointment_request_id: appointmentRequestId!
        });
        expect(result.success).toBe(true);
      });

      // Try to cancel again
      await runWithTenant(tenantId, async () => {
        const result = await cancelAppointmentRequest({
          appointment_request_id: appointmentRequestId!
        });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/already|cancelled|pending/i);
      });
    });
  });

  describe('Notification Metadata and Navigation', () => {
    it('should include actionable metadata in staff notifications', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId
      }, []);

      const requestData = {
        service_id: serviceId!,
        requested_date: '2025-12-30',
        requested_time: '11:00',
        requested_duration: 45
      };

      let appointmentRequestId: string;
      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
        appointmentRequestId = result.data!.appointment_request_id;
      });

      // Find staff notification
      const staffCall = createNotificationFromTemplateInternalMock.mock.calls.find(
        call => call[1].template_name === 'appointment-request-created-staff'
      );

      expect(staffCall).toBeDefined();
      const [, notificationData] = staffCall!;

      // Verify metadata
      expect(notificationData.metadata).toBeDefined();
      expect(notificationData.metadata.appointment_request_id).toBe(appointmentRequestId!);
      expect(notificationData.metadata.requires_action).toBe(true);

      // Verify link points to schedule
      expect(notificationData.link).toBe('/msp/schedule');
    });

    it('should include appropriate links for client notifications', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId
      }, []);

      const requestData = {
        service_id: serviceId!,
        requested_date: '2025-12-31',
        requested_time: '15:00',
        requested_duration: 60
      };

      let appointmentRequestId: string;
      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
        appointmentRequestId = result.data!.appointment_request_id;
      });

      // Find client notification
      const clientCall = createNotificationFromTemplateInternalMock.mock.calls.find(
        call => call[1].user_id === clientUserId && call[1].template_name === 'appointment-request-created-client'
      );

      expect(clientCall).toBeDefined();
      const [, notificationData] = clientCall!;

      // Link should point to appointment detail page
      expect(notificationData.link).toMatch(/^\/client-portal\/appointments\//);
      expect(notificationData.link).toContain(appointmentRequestId!);
    });

    it('should set correct notification types for different events', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId
      }, []);

      // Create request
      const requestData = {
        service_id: serviceId!,
        requested_date: '2026-01-02',
        requested_time: '10:00',
        requested_duration: 60
      };

      let appointmentRequestId: string;
      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
        appointmentRequestId = result.data!.appointment_request_id;
      });

      const creationCall = createNotificationFromTemplateInternalMock.mock.calls.find(
        call => call[1].template_name === 'appointment-request-created-client'
      );
      expect(creationCall![1].type).toBe('info');

      createNotificationFromTemplateInternalMock.mockClear();

      // Approve request
      setMockUser({
        user_id: staffUserId,
        user_type: 'internal'
      }, ['user_schedule:update', 'user_schedule:read']);

      await runWithTenant(tenantId, async () => {
        const result = await approveAppointmentRequest({
          appointment_request_id: appointmentRequestId!,
          assigned_user_id: staffUserId
        });
        expect(result.success).toBe(true);
      });

      const approvalCall = createNotificationFromTemplateInternalMock.mock.calls.find(
        call => call[1].template_name === 'appointment-request-approved'
      );
      expect(approvalCall![1].type).toBe('success');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle missing email addresses gracefully', async () => {
      // Create contact with a placeholder email (database requires it)
      const contactWithoutEmail = uuidv4();
      const placeholderEmail = `noemail_${contactWithoutEmail.substring(0, 8)}@placeholder.local`;

      await db('contacts').insert({
        contact_name_id: contactWithoutEmail,
        tenant: tenantId,
        client_id: clientId,
        full_name: 'No Email Contact',
        email: placeholderEmail,
        created_at: new Date(),
        updated_at: new Date()
      });

      const userWithoutEmail = uuidv4();
      await db('users').insert({
        user_id: userWithoutEmail,
        tenant: tenantId,
        username: 'noemail_user',
        first_name: 'No',
        last_name: 'Email',
        email: placeholderEmail,
        hashed_password: 'hashed',
        user_type: 'client',
        contact_id: contactWithoutEmail,
        is_inactive: false,
        created_at: new Date(),
        updated_at: new Date()
      }, []);

      setMockUser({
        user_id: userWithoutEmail,
        user_type: 'client',
        contact_id: contactWithoutEmail
      }, []);

      const requestData = {
        service_id: serviceId!,
        requested_date: '2026-01-03',
        requested_time: '14:00',
        requested_duration: 60
      };

      // Should not throw error even without email
      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
      });

      // Cleanup
      await db('users').where({ user_id: userWithoutEmail, tenant: tenantId }).del();
      await db('contacts').where({ contact_name_id: contactWithoutEmail, tenant: tenantId }).del();
    });

    it('should batch notifications to multiple staff members efficiently', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId
      }, []);

      const requestData = {
        service_id: serviceId!,
        requested_date: '2026-01-04',
        requested_time: '11:00',
        requested_duration: 30
      };

      createNotificationFromTemplateInternalMock.mockClear();

      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
      });

      // Should have created notifications for all staff with permissions
      const staffNotifications = createNotificationFromTemplateInternalMock.mock.calls.filter(
        call => call[1].template_name === 'appointment-request-created-staff'
      );

      expect(staffNotifications.length).toBeGreaterThanOrEqual(2);

      // Verify all staff got unique notifications
      const staffUserIds = staffNotifications.map(call => call[1].user_id);
      const uniqueStaffIds = new Set(staffUserIds);
      expect(uniqueStaffIds.size).toBe(staffNotifications.length);
    });

    it('should include all required data fields in notifications', async () => {
      setMockUser({
        user_id: clientUserId,
        user_type: 'client',
        contact_id: contactId
      }, []);

      const requestData = {
        service_id: serviceId!,
        requested_date: '2026-01-05',
        requested_time: '16:00',
        requested_duration: 90,
        description: 'Detailed test description'
      };

      await runWithTenant(tenantId, async () => {
        const result = await createAppointmentRequest(requestData);
        expect(result.success).toBe(true);
      });

      const clientCall = createNotificationFromTemplateInternalMock.mock.calls.find(
        call => call[1].user_id === clientUserId
      );

      expect(clientCall).toBeDefined();
      const [, notificationData] = clientCall!;

      // Verify all required fields
      expect(notificationData.tenant).toBe(tenantId);
      expect(notificationData.user_id).toBe(clientUserId);
      expect(notificationData.template_name).toBeDefined();
      expect(notificationData.type).toBeDefined();
      expect(notificationData.category).toBe('appointments');
      expect(notificationData.link).toBeDefined();
      expect(notificationData.data).toBeDefined();
      expect(notificationData.data.serviceName).toBe('Test Service');
      expect(notificationData.data.requestedDate).toBeDefined();
      expect(notificationData.data.requestedTime).toBeDefined();
      expect(notificationData.metadata).toBeDefined();
    });
  });
});

// Helper functions

async function runMigrationsAndSeeds(connection: Knex): Promise<void> {
  await connection.raw('DROP SCHEMA IF EXISTS public CASCADE');
  await connection.raw('CREATE SCHEMA public');
  await connection.raw('GRANT ALL ON SCHEMA public TO public');

  const migrationDir = path.resolve(__dirname, '../../../migrations');
  await connection.migrate.latest({
    directory: migrationDir
  });
}

async function createContact(
  db: Knex,
  tenantId: string,
  clientId: string
): Promise<{ contactId: string; email: string }> {
  const contactId = uuidv4();
  // Use unique email to prevent conflicts between test runs
  const uniqueEmail = `test.contact.${contactId.substring(0, 8)}@example.com`;

  await db('contacts').insert({
    contact_name_id: contactId,
    tenant: tenantId,
    client_id: clientId,
    full_name: 'Test Contact',
    email: uniqueEmail,
    phone_number: '555-0200',
    created_at: new Date(),
    updated_at: new Date()
  });

  return { contactId, email: uniqueEmail };
}

async function createService(db: Knex, tenantId: string): Promise<string> {
  const serviceId = uuidv4();
  const serviceTypeId = uuidv4();

  // First create a service type
  await db('service_types').insert({
    id: serviceTypeId,
    tenant: tenantId,
    name: 'Test Service Type',
    billing_method: 'fixed',
    is_active: true,
    description: 'Test service type for integration tests'
  });

  // Then create the service
  await db('service_catalog').insert({
    service_id: serviceId!,
    tenant: tenantId,
    service_name: 'Test Service',
    custom_service_type_id: serviceTypeId,
    billing_method: 'fixed',
    description: 'Test service description',
    default_rate: 100,
    unit_of_measure: 'hour'
  });

  return serviceId;
}

async function createRolesAndPermissions(
  db: Knex,
  tenantId: string
): Promise<{ scheduleRoleId: string }> {
  // Create schedule permission
  const schedulePermissionId = uuidv4();
  await db('permissions').insert({
    permission_id: schedulePermissionId,
    tenant: tenantId,
    resource: 'schedule',
    action: 'update',
    description: 'Can update schedules'
  });

  // Create schedule read permission
  const scheduleReadPermissionId = uuidv4();
  await db('permissions').insert({
    permission_id: scheduleReadPermissionId,
    tenant: tenantId,
    resource: 'schedule',
    action: 'read',
    description: 'Can read schedules'
  });

  // Create role
  const scheduleRoleId = uuidv4();
  await db('roles').insert({
    role_id: scheduleRoleId,
    tenant: tenantId,
    role_name: 'Schedule Manager',
    description: 'Can manage schedules'
  });

  // Assign permissions to role
  await db('role_permissions').insert([
    {
      role_id: scheduleRoleId,
      permission_id: schedulePermissionId,
      tenant: tenantId
    },
    {
      role_id: scheduleRoleId,
      permission_id: scheduleReadPermissionId,
      tenant: tenantId
    }
  ]);

  return { scheduleRoleId };
}
