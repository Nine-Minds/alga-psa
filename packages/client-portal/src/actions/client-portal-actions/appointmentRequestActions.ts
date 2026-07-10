'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction, normalizeIanaTimeZone, resolveEffectiveTimeZone, tenantDb } from '@alga-psa/db';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  createAppointmentRequestSchema,
  updateAppointmentRequestSchema,
  cancelAppointmentRequestSchema,
  CreateAppointmentRequestInput,
  UpdateAppointmentRequestInput,
  CancelAppointmentRequestInput,
  AppointmentRequestFilters,
  appointmentRequestFilterSchema
} from '../../schemas/appointmentSchemas';
import { SystemEmailService } from '@alga-psa/email';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildAppointmentAssignedPayload,
  buildAppointmentCanceledPayload,
  buildAppointmentCreatedPayload,
  buildAppointmentRescheduledPayload,
} from '@alga-psa/workflow-streams';
import {
  getAvailableServicesForClient,
  getServicesForPublicBooking,
  getAvailableTimeSlots as getTimeSlotsFromService,
  getAvailableDates as getDatesFromService
} from '../../services/availabilityService';
import { createNotificationFromTemplateInternal } from '@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions';
import { resolveAppointmentApproverUserIds } from '@alga-psa/msp-composition/scheduling/appointmentApprovers';
import { isValidEmail, enqueueImmediateJob } from '@alga-psa/core';
import { isEnterprise } from '@alga-psa/core/features';
import { format, type Locale } from 'date-fns';
import { de, es, fr, it, nl, enUS } from 'date-fns/locale';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';

export interface IAppointmentRequest {
  appointment_request_id: string;
  tenant: string;
  client_id?: string;
  contact_id?: string;
  service_id: string;
  requested_date: string;
  requested_time: string;
  requested_duration: number;
  requester_timezone?: string | null;
  preferred_assigned_user_id?: string;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
  description?: string;
  ticket_id?: string;
  is_authenticated: boolean;
  requester_name?: string;
  requester_email?: string;
  requester_phone?: string;
  company_name?: string;
  schedule_entry_id?: string;
  approved_by_user_id?: string;
  approved_at?: string;
  declined_reason?: string;
  created_at: Date;
  updated_at: Date;
  online_meeting_artifacts?: OnlineMeetingPortalArtifact[];
}

export interface AppointmentRequestResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  teamsMeetingWarning?: string;
}

export interface OnlineMeetingPortalArtifact {
  artifact_id: string;
  artifact_type: 'recording' | 'transcript';
  document_id: string | null;
  created_date_time: Date | null;
}

function portalAppointmentRequestErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (error instanceof Error && error.name === 'ZodError') {
    return 'Appointment request contains invalid fields. Review the details and try again.';
  }

  if (
    message === 'Appointment request not found' ||
    message.startsWith('Cannot cancel appointment request with status:')
  ) {
    return message;
  }

  return fallback;
}

type AppointmentRequestRow = IAppointmentRequest & Record<string, any>;

type OnlineMeetingArtifactRow = {
  appointment_request_id: string;
  artifact_id: string;
  artifact_type: OnlineMeetingPortalArtifact['artifact_type'];
  document_id: string | null;
  created_date_time: Date | null;
};

type ContactLookupRow = {
  contact_name_id: string;
  client_id?: string | null;
  full_name?: string | null;
  email?: string | null;
};

type OnlineMeetingRow = {
  provider?: string | null;
  provider_meeting_id?: string | null;
  provider_event_id?: string | null;
};

async function areOnlineMeetingArtifactsVisibleInPortal(trx: Knex.Transaction, tenant: string): Promise<boolean> {
  try {
    const row = await tenantDb(trx, tenant).table('teams_integrations')
      .first('expose_recordings_in_portal');
    return row?.expose_recordings_in_portal === true;
  } catch (error) {
    console.warn('[ClientPortalAppointmentRequests] Recording portal visibility setting unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function loadVisibleOnlineMeetingArtifactsForAppointments(
  trx: Knex.Transaction,
  tenant: string,
  appointmentRequestIds: string[],
): Promise<Map<string, OnlineMeetingPortalArtifact[]>> {
  const result = new Map<string, OnlineMeetingPortalArtifact[]>();
  const ids = [...new Set(appointmentRequestIds.filter(Boolean))];
  if (ids.length === 0) {
    return result;
  }

  const visible = await areOnlineMeetingArtifactsVisibleInPortal(trx, tenant);
  if (!visible) {
    return result;
  }

  const scopedDb = tenantDb(trx, tenant);
  const artifactsQuery = scopedDb.table('online_meeting_artifacts as artifact');
  scopedDb.tenantJoin(artifactsQuery, 'online_meetings as meeting', 'artifact.meeting_id', 'meeting.meeting_id');

  const rows = await artifactsQuery
    .whereIn('meeting.appointment_request_id', ids)
    .select(
      'meeting.appointment_request_id',
      'artifact.artifact_id',
      'artifact.artifact_type',
      'artifact.document_id',
      'artifact.created_date_time',
    )
    .orderBy('artifact.created_date_time', 'desc') as unknown as OnlineMeetingArtifactRow[];

  for (const row of rows) {
    const appointmentRequestId = row.appointment_request_id as string;
    const artifacts = result.get(appointmentRequestId) ?? [];
    artifacts.push({
      artifact_id: row.artifact_id,
      artifact_type: row.artifact_type,
      document_id: row.document_id ?? null,
      created_date_time: row.created_date_time ?? null,
    });
    result.set(appointmentRequestId, artifacts);
  }

  return result;
}

type TenantSettings = {
  contactEmail: string;
  contactPhone: string;
  tenantName: string;
  defaultLocale: string;
};

async function getTenantSettings(tenant: string): Promise<TenantSettings> {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx) => {
    const settings = await tenantDb(trx, tenant).table('tenant_settings').first();
    const tenantSettings = settings?.settings || {};

    let tenantName = tenantSettings.branding?.clientName;
    if (!tenantName) {
      const tenantRecord = await tenantDb(trx, tenant).table('tenants').select('client_name').first();
      tenantName = tenantRecord?.client_name;
    }
    if (!tenantName) tenantName = 'Your Service Provider';

    return {
      contactEmail: tenantSettings.supportEmail || tenantSettings.contactEmail || 'support@company.com',
      contactPhone: tenantSettings.supportPhone || tenantSettings.contactPhone || '',
      tenantName,
      defaultLocale: tenantSettings.defaultLocale || 'en',
    };
  });
}

async function getClientUserIdFromContact(contactId: string, tenant: string): Promise<string | null> {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx) => {
    const user = await tenantDb(trx, tenant).table('users')
      .where({
        contact_id: contactId,
        user_type: 'client',
      })
      .where(function () {
        this.where('is_inactive', false).orWhereNull('is_inactive');
      })
      .select('user_id')
      .first();

    return user?.user_id || null;
  });
}

async function formatDate(dateString: string, locale: string = 'en'): Promise<string> {
  try {
    const date = new Date(dateString);
    const localeMap: Record<string, Locale> = {
      en: enUS,
      de,
      es,
      fr,
      it,
      nl,
    };
    const dateFnsLocale = localeMap[locale] || enUS;
    return format(date, 'PPP', { locale: dateFnsLocale });
  } catch (error) {
    console.error('Error formatting date:', error);
    return dateString;
  }
}

async function formatTime(timeString: string, locale: string = 'en'): Promise<string> {
  try {
    const [hours, minutes] = timeString.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);

    const localeMap: Record<string, Locale> = {
      en: enUS,
      de,
      es,
      fr,
      it,
      nl,
    };
    const dateFnsLocale = localeMap[locale] || enUS;
    if (locale === 'en') {
      return format(date, 'p', { locale: dateFnsLocale });
    }
    return format(date, 'HH:mm', { locale: dateFnsLocale });
  } catch (error) {
    console.error('Error formatting time:', error);
    return timeString;
  }
}

async function getClientCompanyName(clientId: string, tenant: string): Promise<string> {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx) => {
    const client = await tenantDb(trx, tenant).table('clients')
      .where({
        client_id: clientId,
      })
      .select('client_name')
      .first();

    return client?.client_name || 'Unknown Client';
  });
}

/**
 * Enqueues the idempotent Graph cleanup job for a cancelled meeting (F019).
 * The online_meetings row stays cancel_pending until the job confirms Graph
 * deletion; the recurring Teams meeting sweep retries rows whose job was lost.
 */
async function enqueueTeamsMeetingCleanupJob(tenantId: string, meetingId: string): Promise<boolean> {
  if (!isEnterprise) {
    return false;
  }

  try {
    // Enqueue via the core DI seam rather than importing @alga-psa/jobs, which
    // would create a client-portal -> jobs cycle. The handler is idempotent
    // (404=success) and the recurring Teams meeting sweep re-enqueues any
    // cancel_pending row, so runner-level singletonKey de-duplication is not needed.
    await enqueueImmediateJob('teams-meeting-cleanup', { tenantId, meetingId });
    return true;
  } catch (error) {
    console.warn('[ClientPortalAppointmentRequests] Failed to enqueue Teams meeting cleanup job; the Teams meeting sweep will retry', {
      tenantId,
      meetingId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Create an authenticated appointment request from the client portal
 * Validates that user is a client and has proper access
 */
export const createAppointmentRequest = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  data: CreateAppointmentRequestInput
): Promise<AppointmentRequestResult<IAppointmentRequest>> => {
  try {
    if (currentUser.user_type !== 'client') {
      return { success: false, error: 'Only client users can create appointment requests' };
    }

    if (!currentUser.contact_id) {
      return { success: false, error: 'Contact information not found' };
    }

    // Validate input
    const validatedData = createAppointmentRequestSchema.parse(data);

    const { knex: db } = await createTenantKnex();

    // Get client_id from contact
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('contacts')
        .where({
          contact_name_id: currentUser.contact_id
        })
        .select('client_id', 'full_name', 'email')
        .first<ContactLookupRow>();
    });

    if (!contact || !contact.client_id) {
      return { success: false, error: 'Client information not found' };
    }

    const clientId = contact.client_id;

    console.log('[createAppointmentRequest] Creating appointment with:', {
      tenant,
      clientId,
      contactId: currentUser.contact_id,
      serviceId: validatedData.service_id
    });

    // Verify service exists and is active
    const service = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('service_catalog')
        .where({
          service_id: validatedData.service_id
        })
        .first<any>();
    });

    if (!service) {
      return { success: false, error: 'Service not found' };
    }

    // Check if service allows booking without contract
    const serviceSettings = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('availability_settings')
        .where({
          setting_type: 'service_rules',
          service_id: validatedData.service_id
        })
        .first<any>();
    });

    const allowWithoutContract = serviceSettings?.allow_without_contract ?? false;

    // Only check for active contract if service requires it
    if (!allowWithoutContract) {
      const hasActiveContract = await withTransaction(db, async (trx: Knex.Transaction) => {
        const now = new Date();

        const scopedDb = tenantDb(trx, tenant);
        const contractServiceQuery = scopedDb.table('contract_line_services as cls');
        scopedDb.tenantJoin(contractServiceQuery, 'contract_lines as cl', 'cls.contract_line_id', 'cl.contract_line_id');
        scopedDb.tenantJoin(contractServiceQuery, 'client_contracts as cc', 'cl.contract_id', 'cc.contract_id');

        const contractService = await contractServiceQuery
          .where({
            'cls.service_id': validatedData.service_id,
            'cc.client_id': clientId
          })
          .where('cc.start_date', '<=', now)
          .where(function() {
            this.whereNull('cc.end_date')
              .orWhere('cc.end_date', '>=', now);
          })
          .first();

        return !!contractService;
      });

      if (!hasActiveContract) {
        return {
          success: false,
          error: 'You do not have an active contract that includes this service'
        };
      }
    }

    // If ticket_id provided, verify it exists and belongs to the client
    if (validatedData.ticket_id) {
      const ticket = await withTransaction(db, async (trx: Knex.Transaction) => {
        return await tenantDb(trx, tenant).table('tickets')
          .where({
            ticket_id: validatedData.ticket_id,
            client_id: clientId
          })
          .first();
      });

      if (!ticket) {
        return { success: false, error: 'Ticket not found or does not belong to your organization' };
      }
    }

    // Normalize values for storage
    const normalizedRequestedDate = validatedData.requested_date;
    const normalizedRequestedTime = validatedData.requested_time.slice(0, 5);

    // Create appointment request
    const appointmentRequest = await withTransaction(db, async (trx: Knex.Transaction) => {
      const now = new Date();
      const requestId = uuidv4();

      const newRequest = {
        appointment_request_id: requestId,
        tenant,
        client_id: clientId,
        contact_id: currentUser.contact_id,
        service_id: validatedData.service_id,
        requested_date: normalizedRequestedDate,
        requested_time: normalizedRequestedTime,
        requested_duration: validatedData.requested_duration,
        requester_timezone: validatedData.requester_timezone || null,
        preferred_assigned_user_id: validatedData.preferred_assigned_user_id || null,
        status: 'pending',
        description: validatedData.description || null,
        ticket_id: validatedData.ticket_id || null,
        is_authenticated: true,
        requester_name: null,
        requester_email: null,
        requester_phone: null,
        company_name: null,
        schedule_entry_id: null,
        approved_by_user_id: null,
        approved_at: null,
        declined_reason: null,
        created_at: now,
        updated_at: now
      };

      await tenantDb(trx, tenant).table('appointment_requests').insert(newRequest);

      return await tenantDb(trx, tenant).table('appointment_requests')
        .where({
          appointment_request_id: requestId
        })
        .first<AppointmentRequestRow>();
    });

    console.log('[createAppointmentRequest] Appointment created successfully:', {
      appointment_request_id: appointmentRequest.appointment_request_id,
      client_id: appointmentRequest.client_id,
      status: appointmentRequest.status
    });

    // Determine who should be assigned this appointment.
    // Only a client-specified preferred technician is auto-assigned. When none is
    // specified the request is left unassigned for an approver to claim on approval.
    const assignedUserId = validatedData.preferred_assigned_user_id || null;

    // ALWAYS create a schedule entry for this appointment request
    // If no assigned user, it will still appear on the calendar as unassigned
    let scheduleEntryId: string | null = null;
    {
      scheduleEntryId = await withTransaction(db, async (trx: Knex.Transaction) => {
        const entryId = uuidv4();
        // requested_date/requested_time are the user's LOCAL wall-clock in requester_timezone.
        // Convert to a true UTC instant for schedule_entries.scheduled_start.
        const createTz = validatedData.requester_timezone || 'UTC';
        const scheduledStart = fromZonedTime(
          `${normalizedRequestedDate}T${normalizedRequestedTime}:00`,
          createTz
        );
        const scheduledEnd = new Date(scheduledStart.getTime() + validatedData.requested_duration * 60000);

        // Create schedule entry
        await tenantDb(trx, tenant).table('schedule_entries').insert({
          entry_id: entryId,
          tenant,
          title: `[Pending Request] ${service.service_name}`,
          work_item_type: 'appointment_request',
          work_item_id: appointmentRequest.appointment_request_id,
          scheduled_start: scheduledStart.toISOString(),
          scheduled_end: scheduledEnd.toISOString(),
          status: 'scheduled', // Will show as pending/requested in UI based on work_item_type
          notes: validatedData.description || `Appointment request from client portal`,
          created_at: new Date(),
          updated_at: new Date()
        });

        // Assign to the user if one was determined
        if (assignedUserId) {
          await tenantDb(trx, tenant).table('schedule_entry_assignees').insert({
            entry_id: entryId,
            user_id: assignedUserId,
            tenant,
            created_at: new Date()
          });

          console.log('[createAppointmentRequest] Schedule entry assigned to:', assignedUserId);
        } else {
          console.log('[createAppointmentRequest] Schedule entry created without assignee - will need manual assignment');
        }

        return entryId;
      });

      // Update the appointment request with the schedule_entry_id
      await withTransaction(db, async (trx: Knex.Transaction) => {
        await tenantDb(trx, tenant).table('appointment_requests')
          .where({
            appointment_request_id: appointmentRequest.appointment_request_id
          })
          .update({
            schedule_entry_id: scheduleEntryId,
            updated_at: new Date()
          });
      });

      console.log('[createAppointmentRequest] Schedule entry created:', {
        schedule_entry_id: scheduleEntryId,
        assigned_user_id: assignedUserId || 'unassigned'
      });
    }

    try {
      if (scheduleEntryId) {
        const eventTz = validatedData.requester_timezone || 'UTC';
        const scheduledStart = fromZonedTime(
          `${normalizedRequestedDate}T${normalizedRequestedTime}:00`,
          eventTz
        );
        const scheduledEnd = new Date(scheduledStart.getTime() + validatedData.requested_duration * 60000);
        const ticketId = appointmentRequest.ticket_id || undefined;

        const ctx = {
          tenantId: tenant,
          actor: { actorType: 'CONTACT' as const, actorContactId: (currentUser as any).contact_id as string },
        };

        await publishWorkflowEvent({
          eventType: 'APPOINTMENT_CREATED',
          ctx,
          payload: buildAppointmentCreatedPayload({
            entry: {
              entry_id: scheduleEntryId,
              work_item_type: 'appointment_request',
              work_item_id: appointmentRequest.appointment_request_id,
              scheduled_start: scheduledStart,
              scheduled_end: scheduledEnd,
              created_at: new Date(),
              assigned_user_ids: assignedUserId ? [assignedUserId] : [],
            },
            ticketId,
            timezone: 'UTC',
          }),
        });

        if (assignedUserId) {
          await publishWorkflowEvent({
            eventType: 'APPOINTMENT_ASSIGNED',
            ctx,
            payload: buildAppointmentAssignedPayload({
              appointmentId: scheduleEntryId,
              ticketId,
              newAssigneeId: assignedUserId,
            }),
          });
        }
      }
    } catch (eventError) {
      console.error('[createAppointmentRequest] Failed to publish appointment workflow events', eventError);
    }

    // Send notification emails and internal notifications
    try {
      const emailService = SystemEmailService.getInstance();

      // Get tenant settings for email templates
      const tenantSettings = await getTenantSettings(tenant);

      // requested_date/requested_time are the requester's wall-clock in requester_timezone.
      const requesterTz = normalizeIanaTimeZone(validatedData.requester_timezone || null);
      const requestInstant = fromZonedTime(
        `${validatedData.requested_date}T${validatedData.requested_time}:00`,
        requesterTz
      );
      const requesterTzLabel = ` (${formatInTimeZone(requestInstant, requesterTz, 'zzz')})`;

      // Send confirmation email to client using template
      await emailService.sendAppointmentRequestReceived({
        requesterName: contact.full_name || 'Customer',
        requesterEmail: contact.email || currentUser.email || '',
        serviceName: service.service_name,
        requestedDate: await formatDate(validatedData.requested_date, 'en'),
        requestedTime: `${await formatTime(validatedData.requested_time, 'en')}${requesterTzLabel}`,
        duration: validatedData.requested_duration,
        referenceNumber: appointmentRequest.appointment_request_id.slice(0, 8).toUpperCase(),
        responseTime: '24 hours',
        portalLink: `${process.env.NEXT_PUBLIC_APP_URL}/client-portal/appointments`,
        contactEmail: tenantSettings.contactEmail,
        contactPhone: tenantSettings.contactPhone
      }, {
        tenantId: tenant
      });

      // Resolve the configured approvers (multiple users and/or teams, expanded to
      // their current members). Falls back to the company-wide approvers when the
      // preferred technician has no per-technician override configured.
      const approverUserIds = await withTransaction(db, async (trx: Knex.Transaction) => {
        return resolveAppointmentApproverUserIds(trx, tenant, {
          preferredTechnicianId: validatedData.preferred_assigned_user_id || null
        });
      });

      // Determine which staff users should receive notifications:
      // the preferred technician (if any) plus every resolved approver.
      const notifyUserIds = new Set<string>();
      if (assignedUserId) {
        notifyUserIds.add(assignedUserId);
      }
      for (const approverId of approverUserIds) {
        notifyUserIds.add(approverId);
      }

      // Get user details for notifications
      const staffUsers = notifyUserIds.size > 0
        ? await withTransaction(db, async (trx: Knex.Transaction) => {
            return await tenantDb(trx, tenant).table('users')
              .whereIn('user_id', Array.from(notifyUserIds))
              .select('user_id', 'email', 'first_name', 'last_name', 'timezone');
          })
        : [];

      const clientCompanyName = await getClientCompanyName(clientId, tenant);

      console.log('[createAppointmentRequest] Staff users for notifications:', {
        count: staffUsers.length,
        userIds: staffUsers.map(u => u.user_id),
        assignedUserId,
        approverUserIds
      });

      // Resolve preferred technician name
      let preferredTechnicianName = 'Not specified';
      if (validatedData.preferred_assigned_user_id) {
        const techUser = staffUsers.find(u => u.user_id === validatedData.preferred_assigned_user_id);
        if (techUser) {
          preferredTechnicianName = `${techUser.first_name} ${techUser.last_name}`;
        }
      }

      const tenantDefaultTz = await resolveEffectiveTimeZone(db, tenant, null);
      const staffTzFor = (staffUser: { timezone?: string | null }) =>
        staffUser.timezone ? normalizeIanaTimeZone(staffUser.timezone) : tenantDefaultTz;

      for (const staffUser of staffUsers) {
        if (!isValidEmail(staffUser.email)) continue;
        // Staff see the request in their own timezone, labeled.
        const staffTz = staffTzFor(staffUser);
        await emailService.sendNewAppointmentRequest(staffUser.email, {
          requesterName: contact.full_name || 'Unknown',
          requesterEmail: contact.email || currentUser.email || '',
          clientName: clientCompanyName,
          serviceName: service.service_name,
          requestedDate: await formatDate(formatInTimeZone(requestInstant, staffTz, 'yyyy-MM-dd'), 'en'),
          requestedTime: `${await formatTime(formatInTimeZone(requestInstant, staffTz, 'HH:mm'), 'en')} (${formatInTimeZone(requestInstant, staffTz, 'zzz')})`,
          duration: validatedData.requested_duration,
          preferredTechnician: preferredTechnicianName,
          referenceNumber: appointmentRequest.appointment_request_id.slice(0, 8).toUpperCase(),
          submittedAt: new Date().toLocaleString(),
          isAuthenticated: true,
          approvalLink: `${process.env.NEXT_PUBLIC_APP_URL}/msp/schedule`,
          contactEmail: tenantSettings.contactEmail,
          contactPhone: tenantSettings.contactPhone
        }, {
          tenantId: tenant
        });
      }

      // Send internal notification to client
      if (currentUser.contact_id) {
        const clientUserId = await getClientUserIdFromContact(currentUser.contact_id, tenant);
        if (clientUserId) {
          await createNotificationFromTemplateInternal(db, {
            tenant: tenant,
            user_id: clientUserId,
            template_name: 'appointment-request-created-client',
            type: 'info',
            category: 'appointments',
            link: `/client-portal/appointments/${appointmentRequest.appointment_request_id}`,
            data: {
              serviceName: service.service_name,
              requestedDate: await formatDate(validatedData.requested_date, 'en'),
              requestedTime: `${await formatTime(validatedData.requested_time, 'en')}${requesterTzLabel}`
            }
          });
        }
      }

      // Send internal notifications to MSP staff
      for (const staffUser of staffUsers) {
        console.log('[createAppointmentRequest] Creating internal notification for staff user:', staffUser.user_id);
        const notification = await createNotificationFromTemplateInternal(db, {
          tenant: tenant,
          user_id: staffUser.user_id,
          template_name: 'appointment-request-created-staff',
          type: 'info',
          category: 'appointments',
          link: `/msp/schedule?requestId=${appointmentRequest.appointment_request_id}`,
          data: {
            requesterName: contact.full_name || 'Unknown',
            clientName: clientCompanyName,
            serviceName: service.service_name,
            requestedDate: await formatDate(formatInTimeZone(requestInstant, staffTzFor(staffUser), 'yyyy-MM-dd'), 'en'),
            requestedTime: `${await formatTime(formatInTimeZone(requestInstant, staffTzFor(staffUser), 'HH:mm'), 'en')} (${formatInTimeZone(requestInstant, staffTzFor(staffUser), 'zzz')})`
          },
          metadata: {
            appointment_request_id: appointmentRequest.appointment_request_id,
            requires_action: true
          }
        });

        if (notification) {
          console.log('[createAppointmentRequest] Internal notification created for staff user:', {
            userId: staffUser.user_id,
            notificationId: notification.internal_notification_id
          });
        } else {
          console.log('[createAppointmentRequest] Internal notification was NOT created for staff user (likely disabled):', staffUser.user_id);
        }
      }
    } catch (emailError) {
      console.error('Error sending appointment request emails and notifications:', emailError);
      // Don't fail the request if email/notification fails
    }

    // Re-query the appointment request to get the updated version with schedule_entry_id
    const updatedAppointmentRequest = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('appointment_requests')
        .where({
          appointment_request_id: appointmentRequest.appointment_request_id
        })
        .first<AppointmentRequestRow>();
    });

    return { success: true, data: updatedAppointmentRequest as unknown as IAppointmentRequest };
  } catch (error) {
    console.error('Error creating appointment request:', error);
    const message = portalAppointmentRequestErrorMessage(error, 'Failed to create appointment request');
    return { success: false, error: message };
  }
});

/**
 * Update a pending appointment request from the client portal
 */
export const updateAppointmentRequest = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  data: UpdateAppointmentRequestInput
): Promise<AppointmentRequestResult<IAppointmentRequest>> => {
  try {
    if (currentUser.user_type !== 'client') {
      return { success: false, error: 'Only client users can update appointment requests' };
    }

    if (!currentUser.contact_id) {
      return { success: false, error: 'Contact information not found' };
    }

    // Validate input
    const validatedData = updateAppointmentRequestSchema.parse(data);

    const { knex: db } = await createTenantKnex();

    // Get client_id from contact
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('contacts')
        .where({
          contact_name_id: currentUser.contact_id
        })
        .select('client_id')
        .first<ContactLookupRow>();
    });

    if (!contact || !contact.client_id) {
      return { success: false, error: 'Client information not found' };
    }

    const clientId = contact.client_id;

    // Get existing appointment request
    const existingRequest = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id,
          client_id: clientId // Ensure user owns this request
        })
        .first<AppointmentRequestRow>();
    });

    if (!existingRequest) {
      return { success: false, error: 'Appointment request not found' };
    }

    if (existingRequest.status !== 'pending') {
      return { success: false, error: 'Only pending requests can be edited' };
    }

    // Verify service exists
    const service = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('service_catalog')
        .where({
          service_id: validatedData.service_id
        })
        .first<any>();
    });

    if (!service) {
      return { success: false, error: 'Service not found' };
    }

    // Update the appointment request
    await withTransaction(db, async (trx: Knex.Transaction) => {
      await tenantDb(trx, tenant).table('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id
        })
        .update({
          service_id: validatedData.service_id,
          requested_date: validatedData.requested_date,
          requested_time: validatedData.requested_time,
          requested_duration: validatedData.requested_duration,
          requester_timezone: validatedData.requester_timezone ?? existingRequest.requester_timezone ?? null,
          preferred_assigned_user_id: validatedData.preferred_assigned_user_id || null,
          description: validatedData.description || null,
          ticket_id: validatedData.ticket_id || null,
          updated_at: new Date()
        });
    });

    let appointmentWorkflowUpdate:
      | {
          appointmentId: string;
          beforeStart: Date;
          beforeEnd: Date;
          afterStart: Date;
          afterEnd: Date;
          previousAssigneeId?: string;
          newAssigneeId?: string;
          ticketId?: string;
        }
      | undefined;

    // Update the associated schedule entry if it exists
    const existingScheduleEntryId = existingRequest.schedule_entry_id;
    if (existingScheduleEntryId) {
      const beforeTz = existingRequest.requester_timezone || 'UTC';
      const afterTz = validatedData.requester_timezone ?? existingRequest.requester_timezone ?? 'UTC';
      // Normalize stored requested_date in case PG returns a Date object.
      const beforeDateValue = existingRequest.requested_date as unknown;
      const beforeDateStr = beforeDateValue instanceof Date
        ? beforeDateValue.toISOString().split('T')[0]
        : String(beforeDateValue).slice(0, 10);
      const beforeTimeStr = String(existingRequest.requested_time).slice(0, 5);
      const beforeStart = fromZonedTime(`${beforeDateStr}T${beforeTimeStr}:00`, beforeTz);
      const beforeEnd = new Date(beforeStart.getTime() + existingRequest.requested_duration * 60000);

      appointmentWorkflowUpdate = await withTransaction(db, async (trx: Knex.Transaction) => {
        const previousAssigneeRow = await tenantDb(trx, tenant).table('schedule_entry_assignees')
          .where({ entry_id: existingScheduleEntryId })
          .select('user_id')
          .first();

        const scheduledStart = fromZonedTime(
          `${validatedData.requested_date}T${validatedData.requested_time}:00`,
          afterTz
        );
        const scheduledEnd = new Date(scheduledStart.getTime() + validatedData.requested_duration * 60000);

        await tenantDb(trx, tenant).table('schedule_entries')
          .where({
            entry_id: existingScheduleEntryId,
          })
          .update({
            title: `[Pending Request] ${service.service_name}`,
            scheduled_start: scheduledStart.toISOString(),
            scheduled_end: scheduledEnd.toISOString(),
            notes: validatedData.description || 'Appointment request from client portal',
            updated_at: new Date(),
          });

        // Update assignee if changed. Only a preferred technician is auto-assigned;
        // clearing it leaves the request unassigned for an approver to claim.
        if (validatedData.preferred_assigned_user_id !== existingRequest.preferred_assigned_user_id) {
          const newAssigneeId = validatedData.preferred_assigned_user_id || null;

          await tenantDb(trx, tenant).table('schedule_entry_assignees')
            .where({
              entry_id: existingScheduleEntryId,
            })
            .delete();

          if (newAssigneeId) {
            await tenantDb(trx, tenant).table('schedule_entry_assignees').insert({
              entry_id: existingScheduleEntryId,
              user_id: newAssigneeId,
              tenant,
              created_at: new Date(),
            });
          }
        }

        const newAssigneeRow = await tenantDb(trx, tenant).table('schedule_entry_assignees')
          .where({ entry_id: existingScheduleEntryId })
          .select('user_id')
          .first();

        return {
          appointmentId: existingScheduleEntryId,
          beforeStart,
          beforeEnd,
          afterStart: scheduledStart,
          afterEnd: scheduledEnd,
          previousAssigneeId: previousAssigneeRow?.user_id,
          newAssigneeId: newAssigneeRow?.user_id,
          ticketId: validatedData.ticket_id || undefined,
        };
      });
    }

    if (appointmentWorkflowUpdate) {
      try {
        const ctx = {
          tenantId: tenant,
          actor: { actorType: 'CONTACT' as const, actorContactId: (currentUser as any).contact_id as string },
        };

        if (
          appointmentWorkflowUpdate.beforeStart.toISOString() !== appointmentWorkflowUpdate.afterStart.toISOString() ||
          appointmentWorkflowUpdate.beforeEnd.toISOString() !== appointmentWorkflowUpdate.afterEnd.toISOString()
        ) {
          await publishWorkflowEvent({
            eventType: 'APPOINTMENT_RESCHEDULED',
            ctx,
            payload: buildAppointmentRescheduledPayload({
              before: {
                entry_id: appointmentWorkflowUpdate.appointmentId,
                scheduled_start: appointmentWorkflowUpdate.beforeStart,
                scheduled_end: appointmentWorkflowUpdate.beforeEnd,
              },
              after: {
                entry_id: appointmentWorkflowUpdate.appointmentId,
                scheduled_start: appointmentWorkflowUpdate.afterStart,
                scheduled_end: appointmentWorkflowUpdate.afterEnd,
              },
              ticketId: appointmentWorkflowUpdate.ticketId,
              timezone: 'UTC',
            }),
          });
        }

        if (
          appointmentWorkflowUpdate.newAssigneeId &&
          appointmentWorkflowUpdate.newAssigneeId !== appointmentWorkflowUpdate.previousAssigneeId
        ) {
          await publishWorkflowEvent({
            eventType: 'APPOINTMENT_ASSIGNED',
            ctx,
            payload: buildAppointmentAssignedPayload({
              appointmentId: appointmentWorkflowUpdate.appointmentId,
              ticketId: appointmentWorkflowUpdate.ticketId,
              previousAssigneeId: appointmentWorkflowUpdate.previousAssigneeId,
              newAssigneeId: appointmentWorkflowUpdate.newAssigneeId,
            }),
          });
        }
      } catch (eventError) {
        console.error('[updateAppointmentRequest] Failed to publish appointment workflow events', eventError);
      }
    }

    // Get updated request
    const updatedRequest = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id
        })
        .first<AppointmentRequestRow>();
    });

    if (!updatedRequest) {
      return { success: false, error: 'Appointment request not found after update' };
    }

    console.log('[updateAppointmentRequest] Appointment updated successfully:', {
      appointment_request_id: updatedRequest.appointment_request_id,
      client_id: updatedRequest.client_id
    });

    return { success: true, data: updatedRequest as IAppointmentRequest };
  } catch (error) {
    console.error('Error updating appointment request:', error);
    const message = portalAppointmentRequestErrorMessage(error, 'Failed to update appointment request');
    return { success: false, error: message };
  }
});

/**
 * Get appointment requests for the current client user
 */
export const getMyAppointmentRequests = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  filters?: Partial<AppointmentRequestFilters>
): Promise<AppointmentRequestResult<IAppointmentRequest[]>> => {
  try {
    if (currentUser.user_type !== 'client') {
      return { success: false, error: 'Only client users can access this endpoint' };
    }

    if (!currentUser.contact_id) {
      return { success: false, error: 'Contact information not found' };
    }

    const { knex: db } = await createTenantKnex();

    // Get client_id from contact
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('contacts')
        .where({
          contact_name_id: currentUser.contact_id
        })
        .select('client_id')
        .first<AppointmentRequestRow>();
    });

    if (!contact || !contact.client_id) {
      return { success: false, error: 'Client information not found' };
    }

    const clientId = contact.client_id;

    console.log('[getMyAppointmentRequests] Looking for appointments with:', {
      tenant,
      clientId,
      contactId: currentUser.contact_id,
      filters
    });

    // Validate filters if provided (all fields are already optional in the schema)
    const validatedFilters = filters ? appointmentRequestFilterSchema.parse(filters) : {};

    const { requests, artifactsByAppointmentRequestId } = await withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      let query = scopedDb.table('appointment_requests as ar');
      scopedDb.tenantJoin(query, 'service_catalog as sc', 'ar.service_id', 'sc.service_id', { type: 'left' });
      scopedDb.tenantJoin(query, 'users as u', 'ar.preferred_assigned_user_id', 'u.user_id', { type: 'left' });
      scopedDb.tenantJoin(query, 'tickets as t', 'ar.ticket_id', 't.ticket_id', { type: 'left' });

      query = query
        .where({
          'ar.client_id': clientId
        })
        .select(
          'ar.*',
          'sc.service_name',
          'u.first_name as preferred_technician_first_name',
          'u.last_name as preferred_technician_last_name',
          't.ticket_number'
        )
        .orderBy('ar.created_at', 'desc');

      // Apply filters
      if (validatedFilters.status) {
        query = query.where('ar.status', validatedFilters.status);
      }

      if (validatedFilters.service_id) {
        query = query.where('ar.service_id', validatedFilters.service_id);
      }

      if (validatedFilters.start_date) {
        query = query.where('ar.requested_date', '>=', validatedFilters.start_date);
      }

      if (validatedFilters.end_date) {
        query = query.where('ar.requested_date', '<=', validatedFilters.end_date);
      }

      const rows = await query;
      const artifacts = await loadVisibleOnlineMeetingArtifactsForAppointments(
        trx,
        tenant,
        rows.map((row: any) => row.appointment_request_id),
      );

      return {
        requests: rows,
        artifactsByAppointmentRequestId: artifacts,
      };
    });

    console.log('[getMyAppointmentRequests] Found appointments:', requests.length);

    // Map the results to include the full technician name
    const mappedRequests = requests.map((request: any) => ({
      ...request,
      preferred_assigned_user_name: request.preferred_technician_first_name && request.preferred_technician_last_name
        ? `${request.preferred_technician_first_name} ${request.preferred_technician_last_name}`
        : undefined,
      online_meeting_artifacts: artifactsByAppointmentRequestId.get(request.appointment_request_id) ?? [],
    }));

    console.log('[getMyAppointmentRequests] Returning appointments:', mappedRequests.length);

    return { success: true, data: mappedRequests as IAppointmentRequest[] };
  } catch (error) {
    console.error('Error fetching appointment requests:', error);
    const message = portalAppointmentRequestErrorMessage(error, 'Failed to fetch appointment requests');
    return { success: false, error: message };
  }
});

/**
 * Get details of a specific appointment request
 */
export const getAppointmentRequestDetails = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  requestId: string
): Promise<AppointmentRequestResult<IAppointmentRequest>> => {
  try {
    if (currentUser.user_type !== 'client') {
      return { success: false, error: 'Only client users can access this endpoint' };
    }

    if (!currentUser.contact_id) {
      return { success: false, error: 'Contact information not found' };
    }

    const { knex: db } = await createTenantKnex();

    // Get client_id from contact
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('contacts')
        .where({
          contact_name_id: currentUser.contact_id
        })
        .select('client_id')
        .first<AppointmentRequestRow>();
    });

    if (!contact || !contact.client_id) {
      return { success: false, error: 'Client information not found' };
    }

    const clientId = contact.client_id;

    const request = await withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      const requestQuery = scopedDb.table('appointment_requests as ar');
      scopedDb.tenantJoin(requestQuery, 'service_catalog as sc', 'ar.service_id', 'sc.service_id', { type: 'left' });
      scopedDb.tenantJoin(requestQuery, 'users as u', 'ar.preferred_assigned_user_id', 'u.user_id', { type: 'left' });
      scopedDb.tenantJoin(requestQuery, 'users as approver', 'ar.approved_by_user_id', 'approver.user_id', { type: 'left' });
      scopedDb.tenantJoin(requestQuery, 'tickets as t', 'ar.ticket_id', 't.ticket_id', { type: 'left' });

      const row = await requestQuery
        .where({
          'ar.appointment_request_id': requestId,
          'ar.client_id': clientId
        })
        .select(
          'ar.*',
          'sc.service_name',
          'sc.description as service_description',
          'u.first_name as preferred_technician_first_name',
          'u.last_name as preferred_technician_last_name',
          'approver.first_name as approver_first_name',
          'approver.last_name as approver_last_name',
          't.title as ticket_title'
        )
        .first<AppointmentRequestRow>();

      if (!row) {
        return row;
      }

      const artifacts = await loadVisibleOnlineMeetingArtifactsForAppointments(
        trx,
        tenant,
        [row.appointment_request_id],
      );

      return {
        ...row,
        online_meeting_artifacts: artifacts.get(row.appointment_request_id) ?? [],
      };
    });

    if (!request) {
      return { success: false, error: 'Appointment request not found' };
    }

    return { success: true, data: request as unknown as IAppointmentRequest };
  } catch (error) {
    console.error('Error fetching appointment request details:', error);
    const message = portalAppointmentRequestErrorMessage(error, 'Failed to fetch appointment request details');
    return { success: false, error: message };
  }
});

/**
 * Cancel a client appointment request
 */
export const cancelAppointmentRequest = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  data: CancelAppointmentRequestInput
): Promise<AppointmentRequestResult<void>> => {
  try {
    if (currentUser.user_type !== 'client') {
      return { success: false, error: 'Only client users can cancel appointment requests' };
    }

    if (!currentUser.contact_id) {
      return { success: false, error: 'Contact information not found' };
    }

    // Validate input
    const validatedData = cancelAppointmentRequestSchema.parse(data);

    const { knex: db } = await createTenantKnex();

    // Get client_id from contact
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('contacts')
        .where({
          contact_name_id: currentUser.contact_id
        })
        .select('contact_name_id', 'client_id', 'full_name', 'email')
        .first<ContactLookupRow>();
    });

    if (!contact || !contact.client_id) {
      return { success: false, error: 'Client information not found' };
    }

    const clientId = contact.client_id;

    const cancellationContext = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Verify request exists and belongs to this client
      const request = await tenantDb(trx, tenant).table('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id,
          client_id: clientId
        })
        .first<AppointmentRequestRow>();

      if (!request) {
        throw new Error('Appointment request not found');
      }

      if (!['pending', 'approved'].includes(request.status)) {
        throw new Error(`Cannot cancel appointment request with status: ${request.status}`);
      }

      const now = new Date();
      const onlineMeeting = await tenantDb(trx, tenant).table('online_meetings')
        .where({
          appointment_request_id: request.appointment_request_id,
        })
        .first<OnlineMeetingRow>();

      if (request.schedule_entry_id) {
        await tenantDb(trx, tenant).table('schedule_entry_assignees')
          .where({
            entry_id: request.schedule_entry_id
          })
          .delete();

        await tenantDb(trx, tenant).table('schedule_entries')
          .where({
            entry_id: request.schedule_entry_id
          })
          .delete();
      }

      // Update request status to cancelled
      await tenantDb(trx, tenant).table('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id
        })
        .update({
          status: 'cancelled',
          declined_reason: validatedData.cancellation_reason || 'Cancelled by client',
          schedule_entry_id: null,
          online_meeting_provider: null,
          online_meeting_url: null,
          online_meeting_id: null,
          updated_at: now
        });

      // Live Teams meetings move to cancel_pending until the idempotent
      // cleanup job confirms Graph deletion (F019); rows without a provider
      // meeting (failed creations) are cancelled directly.
      const cleanupTargets: string[] = [];
      const meetingRows = await tenantDb(trx, tenant).table('online_meetings')
        .where({
          appointment_request_id: request.appointment_request_id,
        })
        .whereNot({ status: 'cancelled' })
        .select('meeting_id', 'provider', 'provider_meeting_id');

      for (const meetingRow of meetingRows) {
        const needsGraphCleanup = meetingRow.provider === 'teams' && meetingRow.provider_meeting_id;
        await tenantDb(trx, tenant).table('online_meetings')
          .where({ meeting_id: meetingRow.meeting_id })
          .update({
            status: needsGraphCleanup ? 'cancel_pending' : 'cancelled',
            updated_at: now,
          });
        if (needsGraphCleanup) {
          cleanupTargets.push(meetingRow.meeting_id);
        }
      }

      try {
        if (request.schedule_entry_id) {
          const ctx = {
            tenantId: tenant,
            actor: { actorType: 'CONTACT' as const, actorContactId: (currentUser as any).contact_id as string },
          };
          await publishWorkflowEvent({
            eventType: 'APPOINTMENT_CANCELED',
            ctx,
            payload: buildAppointmentCanceledPayload({
              appointmentId: request.schedule_entry_id,
              ticketId: request.ticket_id || undefined,
              reason: validatedData.cancellation_reason || 'Cancelled by client',
            }),
          });
        }
      } catch (eventError) {
        console.error('[cancelAppointmentRequest] Failed to publish APPOINTMENT_CANCELED workflow event', eventError);
      }

      // Send notification emails and internal notifications
      try {
        const emailService = SystemEmailService.getInstance();

        // Get service details for notifications
        const service = await tenantDb(trx, tenant).table('service_catalog')
          .where({
            service_id: request.service_id
          })
          .first();

        // Get client user_id for internal notification
        const clientUserId = await getClientUserIdFromContact(contact.contact_name_id, tenant);

        // Email to client confirming cancellation
        const cancellationRecipient = contact.email || currentUser.email;
        if (isValidEmail(cancellationRecipient)) {
          await emailService.sendEmail({
            to: cancellationRecipient,
            subject: 'Appointment Request Cancelled',
          html: `
            <h2>Appointment Request Cancelled</h2>
            <p>Dear ${contact.full_name || 'Customer'},</p>
            <p>Your appointment request for <strong>${service?.service_name || 'service'}</strong> has been cancelled.</p>
            <p><strong>Original Request Details:</strong></p>
            <ul>
              <li>Date: ${request.requested_date}</li>
              <li>Time: ${request.requested_time}</li>
            </ul>
            ${validatedData.cancellation_reason ? `<p>Reason: ${validatedData.cancellation_reason}</p>` : ''}
            <p>Reference Number: ${request.appointment_request_id}</p>
            <p>If you would like to reschedule, please submit a new appointment request.</p>
          `,
            tenantId: tenant
          });
        }

        // Send internal notification to CLIENT
        if (clientUserId) {
          await createNotificationFromTemplateInternal(trx, {
            tenant: tenant,
            user_id: clientUserId,
            template_name: 'appointment-request-cancelled-client',
            type: 'info',
            category: 'appointments',
            link: `/client-portal/appointments/${request.appointment_request_id}`,
            data: {
              serviceName: service?.service_name || 'service',
              requestedDate: await formatDate(request.requested_date, 'en')
            }
          });
        }

        // Send internal notifications to MSP STAFF.
        // Notify the configured approvers (users + teams, expanded to members) plus the
        // assigned technician, mirroring who was notified when the request was created.
        const cancellationApproverIds = await resolveAppointmentApproverUserIds(trx, tenant, {
          preferredTechnicianId: request.preferred_assigned_user_id || null
        });
        const cancellationNotifyIds = new Set<string>(cancellationApproverIds);
        if (request.preferred_assigned_user_id) {
          cancellationNotifyIds.add(request.preferred_assigned_user_id);
        }
        for (const staffUserId of cancellationNotifyIds) {
          await createNotificationFromTemplateInternal(trx, {
            tenant: tenant,
            user_id: staffUserId,
            template_name: 'appointment-request-cancelled-staff',
            type: 'info',
            category: 'appointments',
            link: `/msp/schedule?requestId=${request.appointment_request_id}`,
            data: {
              requesterName: contact.full_name || 'Unknown',
              serviceName: service?.service_name || 'service',
              requestedDate: await formatDate(request.requested_date, 'en')
            },
            metadata: {
              appointment_request_id: request.appointment_request_id
            }
          });
        }

        console.log(`[AppointmentRequest] Request ${request.appointment_request_id} cancelled by client`);
      } catch (emailError) {
        console.error('Error sending cancellation notifications:', emailError);
        // Don't fail the cancellation if notifications fail
      }

      return {
        appointmentRequestId: request.appointment_request_id,
        hadTeamsMeeting:
          cleanupTargets.length > 0 ||
          onlineMeeting?.provider === 'teams' ||
          request.online_meeting_provider === 'teams',
        cleanupTargets,
      };
    });

    let teamsMeetingWarning: string | undefined;

    if (cancellationContext?.cleanupTargets?.length) {
      let allEnqueued = true;
      for (const meetingId of cancellationContext.cleanupTargets) {
        const enqueued = await enqueueTeamsMeetingCleanupJob(tenant, meetingId);
        allEnqueued = allEnqueued && enqueued;
      }
      teamsMeetingWarning = allEnqueued
        ? 'The linked Microsoft Teams meeting is being cancelled; attendees will see it removed from their calendars shortly.'
        : 'Appointment cancelled, but the Microsoft Teams meeting removal could not be scheduled. It will be retried automatically.';
    } else if (cancellationContext?.hadTeamsMeeting) {
      teamsMeetingWarning = 'Appointment cancelled, but the Microsoft Teams meeting could not be removed automatically. Please remove it manually in Teams.';
    }

    return { success: true, teamsMeetingWarning };
  } catch (error) {
    console.error('Error cancelling appointment request:', error);
    const message = portalAppointmentRequestErrorMessage(error, 'Failed to cancel appointment request');
    return { success: false, error: message };
  }
});

/**
 * Get available services and open tickets for appointment booking
 */
export const getAvailableServicesAndTickets = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext
): Promise<AppointmentRequestResult<{
  services: Array<{
    service_id: string;
    service_name: string;
    description?: string;
    service_type?: string;
    default_rate?: number;
  }>;
  tickets: Array<{
    ticket_id: string;
    ticket_number: string;
    title: string;
  }>;
}>> => {
  try {
    if (currentUser.user_type !== 'client') {
      return { success: false, error: 'Only client users can access this endpoint' };
    }

    if (!currentUser.contact_id) {
      return { success: false, error: 'Contact information not found' };
    }

    const { knex: db } = await createTenantKnex();

    // Get client_id from contact
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('contacts')
        .where({
          contact_name_id: currentUser.contact_id
        })
        .select('client_id')
        .first<ContactLookupRow>();
    });

    if (!contact || !contact.client_id) {
      return { success: false, error: 'Client information not found' };
    }

    const clientId = contact.client_id;

    // Get available services for the client from two sources:
    // 1. Services from active contracts
    const contractServices = await getAvailableServicesForClient(tenant, clientId);

    // 2. Services that allow booking without a contract
    const publicServices = await getServicesForPublicBooking(tenant);

    // Combine and deduplicate services by service_id
    const servicesMap = new Map();

    // Add contract services first (they take priority)
    contractServices.forEach((service: any) => {
      servicesMap.set(service.service_id, service);
    });

    // Add public services if not already in the map
    publicServices.forEach((service: any) => {
      if (!servicesMap.has(service.service_id)) {
        servicesMap.set(service.service_id, service);
      }
    });

    const services = Array.from(servicesMap.values());

    // Get open tickets for the client
    const tickets = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('tickets')
        .where({
          client_id: clientId
        })
        .whereNull('closed_at')
        .select('ticket_id', 'ticket_number', 'title')
        .orderBy('entered_at', 'desc')
        .limit(50); // Limit to recent 50 tickets
    });

    return {
      success: true,
      data: {
        services: services.map(s => ({
          service_id: s.service_id,
          service_name: s.service_name,
          description: s.service_description,
          service_type: s.service_type,
          default_rate: s.default_rate
        })),
        tickets: tickets.map(t => ({
          ticket_id: t.ticket_id,
          ticket_number: t.ticket_number,
          title: t.title
        }))
      }
    };
  } catch (error) {
    console.error('Error fetching available services and tickets:', error);
    const message = portalAppointmentRequestErrorMessage(error, 'Failed to fetch appointment setup data');
    return { success: false, error: message };
  }
});

/**
 * Get available dates for a service (next 30 days)
 */
export const getAvailableDatesForService = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  serviceId: string,
  userTimezone?: string
): Promise<AppointmentRequestResult<string[]>> => {
  try {
    if (currentUser.user_type !== 'client') {
      return { success: false, error: 'Only client users can access this endpoint' };
    }

    // Calculate date range (next 30 days)
    const today = new Date();
    const startDate = today.toISOString().split('T')[0];

    const endDateObj = new Date(today);
    endDateObj.setDate(endDateObj.getDate() + 30);
    const endDate = endDateObj.toISOString().split('T')[0];

    // Get available dates from service
    const availableDatesData = await getDatesFromService(
      tenant,
      serviceId,
      startDate,
      endDate,
      undefined, // userId
      userTimezone
    );

    // Filter to only dates with availability
    const availableDates = availableDatesData
      .filter(d => d.has_availability)
      .map(d => d.date);

    return { success: true, data: availableDates };
  } catch (error) {
    console.error('Error fetching available dates:', error);
    const message = portalAppointmentRequestErrorMessage(error, 'Failed to fetch available dates');
    return { success: false, error: message };
  }
});

/**
 * Get appointment requests linked to a specific ticket (client portal version)
 */
export const getAppointmentRequestsByTicketId = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  ticketId: string
): Promise<AppointmentRequestResult<IAppointmentRequest[]>> => {
  try {
    if (currentUser.user_type !== 'client') {
      return { success: false, error: 'Only client users can access this endpoint' };
    }

    if (!currentUser.contact_id) {
      return { success: false, error: 'Contact information not found' };
    }

    const { knex: db } = await createTenantKnex();

    // Get client_id from contact
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('contacts')
        .where({
          contact_name_id: currentUser.contact_id
        })
        .select('client_id')
        .first();
    });

    if (!contact || !contact.client_id) {
      return { success: false, error: 'Client information not found' };
    }

    const clientId = contact.client_id;

    // Verify the ticket belongs to this client
    const ticket = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('tickets')
        .where({
          ticket_id: ticketId,
          client_id: clientId
        })
        .first();
    });

    if (!ticket) {
      return { success: false, error: 'Ticket not found or does not belong to your organization' };
    }

    const requests = await withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      const requestsQuery = scopedDb.table('appointment_requests as ar');
      scopedDb.tenantJoin(requestsQuery, 'service_catalog as sc', 'ar.service_id', 'sc.service_id', { type: 'left' });
      scopedDb.tenantJoin(requestsQuery, 'users as u', 'ar.preferred_assigned_user_id', 'u.user_id', { type: 'left' });
      scopedDb.tenantJoin(requestsQuery, 'users as approver', 'ar.approved_by_user_id', 'approver.user_id', { type: 'left' });
      scopedDb.tenantJoin(requestsQuery, 'tickets as t', 'ar.ticket_id', 't.ticket_id', { type: 'left' });

      return await requestsQuery
        .where('ar.ticket_id', ticketId)
        .where('ar.client_id', clientId) // Ensure client can only see their own requests
        .select(
          'ar.*',
          'sc.service_name',
          'u.first_name as preferred_technician_first_name',
          'u.last_name as preferred_technician_last_name',
          'approver.first_name as approver_first_name',
          'approver.last_name as approver_last_name',
          't.ticket_number'
        )
        .orderBy('ar.created_at', 'desc') as unknown as AppointmentRequestRow[];
    });

    return { success: true, data: requests as IAppointmentRequest[] };
  } catch (error) {
    console.error('Error fetching appointment requests by ticket ID:', error);
    const message = portalAppointmentRequestErrorMessage(error, 'Failed to fetch appointment requests');
    return { success: false, error: message };
  }
});

/**
 * Get available time slots and technicians for a specific date
 */
export const getAvailableTimeSlotsForDate = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  serviceId: string,
  date: string,
  duration?: number,
  userId?: string,
  userTimezone?: string
): Promise<AppointmentRequestResult<{
  timeSlots: Array<{
    time: string; // Display time in user's local timezone (HH:MM format)
    startTime: string; // ISO timestamp for backend (UTC)
    available: boolean;
    duration: number;
  }>;
  technicians: Array<{
    user_id: string;
    full_name: string;
    duration: number; // Technician-specific duration
  }>;
}>> => {
  try {
    if (currentUser.user_type !== 'client') {
      return { success: false, error: 'Only client users can access this endpoint' };
    }

    const { knex: db } = await createTenantKnex();

    // Get service-specific default duration
    const serviceSettings = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('availability_settings')
        .where({
          setting_type: 'service_rules',
          service_id: serviceId
        })
        .first();
    });

    // Use SERVICE duration for generating slots (this is the baseline for the service)
    const serviceDuration = serviceSettings?.config_json?.default_duration || 60;

    console.log('[getAvailableTimeSlotsForDate] Using service duration:', serviceDuration);
    console.log('[getAvailableTimeSlotsForDate] User timezone:', userTimezone || 'UTC (default)');
    if (userId) {
      console.log('[getAvailableTimeSlotsForDate] Filtering slots for user:', userId);
    }

    // Get available time slots from service using SERVICE duration
    // Pass userId to filter slots by specific technician availability
    // Pass userTimezone for accurate minimum notice calculation
    const slots = await getTimeSlotsFromService(
      tenant,
      date,
      serviceId,
      serviceDuration,
      userId,
      userTimezone
    );

    console.log(`[getAvailableTimeSlotsForDate] Found ${slots.length} slots for ${date}`);

    // Extract unique user IDs from all slots
    const userIds = new Set<string>();
    slots.forEach(slot => {
      slot.available_users.forEach(userId => userIds.add(userId));
    });

    console.log(`[getAvailableTimeSlotsForDate] Found ${userIds.size} unique users with slots`);

    // Get ALL user settings for users with slots
    const allUserSettings = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('availability_settings')
        .where({
          setting_type: 'user_hours'
        })
        .whereIn('user_id', Array.from(userIds))
        .select('user_id', 'config_json');
    });

    // Build map of user-specific durations
    const userDurations: Record<string, number> = {};
    allUserSettings.forEach((setting: any) => {
      if (setting.config_json?.default_duration) {
        userDurations[setting.user_id] = setting.config_json.default_duration;
      }
    });

    // Get technician details - only those with allow_client_preference enabled who have slots
    const allowedUserIds = allUserSettings
      .filter((setting: any) => setting.config_json?.allow_client_preference !== false)
      .map((setting: any) => setting.user_id);

    console.log(`[getAvailableTimeSlotsForDate] ${allowedUserIds.length} users allow client preference`);

    const technicians = allowedUserIds.length > 0
      ? await withTransaction(db, async (trx: Knex.Transaction) => {
          const users = await tenantDb(trx, tenant).table('users')
            .whereIn('user_id', allowedUserIds)
            .select(
              'user_id',
              trx.raw("CONCAT(first_name, ' ', last_name) as full_name")
            );

          // Add duration info to each technician
          return users.map((user: any) => ({
            user_id: user.user_id,
            full_name: user.full_name,
            duration: userDurations[user.user_id] || serviceDuration
          }));
        })
      : [];

    console.log(`[getAvailableTimeSlotsForDate] Returning ${technicians.length} technicians with durations:`,
      technicians.map((t: any) => `${t.full_name}: ${t.duration}min`));

    // Format time slots for UI - display in user's local timezone
    const displayTimezone = userTimezone || 'UTC';
    const timeSlots = slots.map(slot => {
      const slotTime = new Date(slot.start_time);
      return {
        time: slotTime.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: displayTimezone
        }),
        startTime: slot.start_time, // Keep the original UTC ISO timestamp for backend
        available: slot.is_available,
        duration: serviceDuration // Always use service duration for slot display
      };
    });

    return {
      success: true,
      data: {
        timeSlots,
        technicians
      }
    };
  } catch (error) {
    console.error('Error fetching time slots:', error);
    const message = portalAppointmentRequestErrorMessage(error, 'Failed to fetch time slots');
    return { success: false, error: message };
  }
});
