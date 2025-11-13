'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { v4 as uuidv4 } from 'uuid';
import {
  createAppointmentRequestSchema,
  updateAppointmentRequestSchema,
  cancelAppointmentRequestSchema,
  CreateAppointmentRequestInput,
  UpdateAppointmentRequestInput,
  CancelAppointmentRequestInput,
  AppointmentRequestFilters,
  appointmentRequestFilterSchema
} from 'server/src/lib/schemas/appointmentSchemas';
import { SystemEmailService } from 'server/src/lib/email/system/SystemEmailService';
import {
  getAvailableServicesForClient,
  getServicesForPublicBooking,
  getAvailableTimeSlots as getTimeSlotsFromService,
  getAvailableDates as getDatesFromService
} from 'server/src/lib/services/availabilityService';
import {
  getTenantSettings,
  getScheduleApprovers,
  getClientUserIdFromContact,
  formatDate,
  formatTime,
  getClientCompanyName
} from '../appointmentHelpers';
import { createNotificationFromTemplateInternal } from '../internal-notification-actions/internalNotificationActions';

export interface IAppointmentRequest {
  appointment_request_id: string;
  tenant: string;
  client_id?: string;
  contact_id?: string;
  service_id: string;
  requested_date: string;
  requested_time: string;
  requested_duration: number;
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
}

export interface AppointmentRequestResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Create an authenticated appointment request from the client portal
 * Validates that user is a client and has proper access
 */
export async function createAppointmentRequest(
  data: CreateAppointmentRequestInput
): Promise<AppointmentRequestResult<IAppointmentRequest>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    if ((currentUser as any).user_type !== 'client') {
      return { success: false, error: 'Only client users can create appointment requests' };
    }

    if (!(currentUser as any).contact_id) {
      return { success: false, error: 'Contact information not found' };
    }

    // Validate input
    const validatedData = createAppointmentRequestSchema.parse(data);

    const { knex: db, tenant } = await createTenantKnex();

    if (!tenant) {
      return { success: false, error: 'Tenant not found' };
    }

    // Get client_id from contact
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({
          contact_name_id: (currentUser as any).contact_id,
          tenant
        })
        .select('client_id', 'full_name', 'email')
        .first();
    });

    if (!contact || !contact.client_id) {
      return { success: false, error: 'Client information not found' };
    }

    const clientId = contact.client_id;

    console.log('[createAppointmentRequest] Creating appointment with:', {
      tenant,
      clientId,
      contactId: (currentUser as any).contact_id,
      serviceId: validatedData.service_id
    });

    // Verify service exists and is active
    const service = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('service_catalog')
        .where({
          service_id: validatedData.service_id,
          tenant
        })
        .first();
    });

    if (!service) {
      return { success: false, error: 'Service not found' };
    }

    // Check if service allows booking without contract
    const serviceSettings = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('availability_settings')
        .where({
          tenant,
          setting_type: 'service_rules',
          service_id: validatedData.service_id
        })
        .first();
    });

    const allowWithoutContract = serviceSettings?.allow_without_contract ?? false;

    // Only check for active contract if service requires it
    if (!allowWithoutContract) {
      const hasActiveContract = await withTransaction(db, async (trx: Knex.Transaction) => {
        const now = new Date();

        const contractService = await trx('contract_line_services as cls')
          .join('contract_lines as cl', function() {
            this.on('cls.contract_line_id', 'cl.contract_line_id')
              .andOn('cls.tenant', 'cl.tenant');
          })
          .join('client_contracts as cc', function() {
            this.on('cl.contract_id', 'cc.contract_id')
              .andOn('cl.tenant', 'cc.tenant');
          })
          .where({
            'cls.service_id': validatedData.service_id,
            'cls.tenant': tenant,
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
        return await trx('tickets')
          .where({
            ticket_id: validatedData.ticket_id,
            tenant,
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
        contact_id: (currentUser as any).contact_id,
        service_id: validatedData.service_id,
        requested_date: normalizedRequestedDate,
        requested_time: normalizedRequestedTime,
        requested_duration: validatedData.requested_duration,
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

      await trx('appointment_requests').insert(newRequest);

      return await trx('appointment_requests')
        .where({
          appointment_request_id: requestId,
          tenant
        })
        .first();
    });

    console.log('[createAppointmentRequest] Appointment created successfully:', {
      appointment_request_id: appointmentRequest.appointment_request_id,
      client_id: appointmentRequest.client_id,
      status: appointmentRequest.status
    });

    // Determine who should be assigned this appointment
    let assignedUserId = validatedData.preferred_assigned_user_id;

    // If no preferred technician, assign to the default approver
    if (!assignedUserId) {
      // Get the default approver from general settings
      const approverSetting = await withTransaction(db, async (trx: Knex.Transaction) => {
        // Fall back to general default approver
        const generalSetting = await trx('availability_settings')
          .where({
            tenant,
            setting_type: 'general_settings'
          })
          .whereNotNull('config_json')
          .first();

        return generalSetting?.config_json?.default_approver_id || null;
      });

      assignedUserId = approverSetting;
    }

    // ALWAYS create a schedule entry for this appointment request
    // If no assigned user, it will still appear on the calendar as unassigned
    let scheduleEntryId: string | null = null;
    {
      scheduleEntryId = await withTransaction(db, async (trx: Knex.Transaction) => {
        const entryId = uuidv4();
        const scheduledStart = new Date(`${normalizedRequestedDate}T${normalizedRequestedTime}:00`);

        const scheduledEnd = new Date(scheduledStart);
        scheduledEnd.setMinutes(scheduledEnd.getMinutes() + validatedData.requested_duration);

        // Create schedule entry
        await trx('schedule_entries').insert({
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
          await trx('schedule_entry_assignees').insert({
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
        await trx('appointment_requests')
          .where({
            appointment_request_id: appointmentRequest.appointment_request_id,
            tenant
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

    // Send notification emails and internal notifications
    try {
      const emailService = SystemEmailService.getInstance();

      // Get tenant settings for email templates
      const tenantSettings = await getTenantSettings(tenant);

      // Send confirmation email to client using template
      await emailService.sendAppointmentRequestReceived({
        requesterName: contact.full_name || 'Customer',
        requesterEmail: contact.email || (currentUser as any).email || 'unknown@example.com',
        serviceName: service.service_name,
        requestedDate: await formatDate(validatedData.requested_date, 'en'),
        requestedTime: await formatTime(validatedData.requested_time, 'en'),
        duration: validatedData.requested_duration,
        referenceNumber: appointmentRequest.appointment_request_id.slice(0, 8).toUpperCase(),
        responseTime: '24 hours',
        portalLink: `${process.env.NEXT_PUBLIC_APP_URL}/client-portal/appointments`,
        contactEmail: tenantSettings.contactEmail,
        contactPhone: tenantSettings.contactPhone,
        tenantName: tenantSettings.tenantName,
        currentYear: new Date().getFullYear()
      }, {
        tenantId: tenant
      });

      // Get default approver for notifications
      const defaultApproverId = await withTransaction(db, async (trx: Knex.Transaction) => {
        const generalSetting = await trx('availability_settings')
          .where({
            tenant,
            setting_type: 'general_settings'
          })
          .whereNotNull('config_json')
          .first();

        return generalSetting?.config_json?.default_approver_id || null;
      });

      // Determine which staff users should receive notifications
      // Only notify: assigned user and default approver (if different)
      const notifyUserIds = new Set<string>();
      if (assignedUserId) {
        notifyUserIds.add(assignedUserId);
      }
      if (defaultApproverId) {
        notifyUserIds.add(defaultApproverId);
      }

      // Get user details for notifications
      const staffUsers = notifyUserIds.size > 0
        ? await withTransaction(db, async (trx: Knex.Transaction) => {
            return await trx('users')
              .where({ tenant })
              .whereIn('user_id', Array.from(notifyUserIds))
              .select('user_id', 'email', 'first_name', 'last_name');
          })
        : [];

      const clientCompanyName = await getClientCompanyName(clientId, tenant);

      console.log('[createAppointmentRequest] Staff users for notifications:', {
        count: staffUsers.length,
        userIds: staffUsers.map(u => u.user_id),
        assignedUserId,
        defaultApproverId
      });

      for (const staffUser of staffUsers) {
        await emailService.sendNewAppointmentRequest(staffUser.email, {
          requesterName: contact.full_name || 'Unknown',
          requesterEmail: contact.email || (currentUser as any).email || 'unknown@example.com',
          clientName: clientCompanyName,
          serviceName: service.service_name,
          requestedDate: await formatDate(validatedData.requested_date, 'en'),
          requestedTime: await formatTime(validatedData.requested_time, 'en'),
          duration: validatedData.requested_duration,
          preferredTechnician: 'Not specified',
          referenceNumber: appointmentRequest.appointment_request_id.slice(0, 8).toUpperCase(),
          submittedAt: new Date().toLocaleString(),
          isAuthenticated: true,
          approvalLink: `${process.env.NEXT_PUBLIC_APP_URL}/msp/schedule`,
          contactEmail: tenantSettings.contactEmail,
          contactPhone: tenantSettings.contactPhone,
          tenantName: tenantSettings.tenantName,
          currentYear: new Date().getFullYear()
        }, {
          tenantId: tenant
        });
      }

      // Send internal notification to client
      if ((currentUser as any).contact_id) {
        const clientUserId = await getClientUserIdFromContact((currentUser as any).contact_id, tenant);
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
              requestedTime: await formatTime(validatedData.requested_time, 'en')
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
          link: `/msp/schedule`,
          data: {
            requesterName: contact.full_name || 'Unknown',
            clientName: clientCompanyName,
            serviceName: service.service_name,
            requestedDate: await formatDate(validatedData.requested_date, 'en'),
            requestedTime: await formatTime(validatedData.requested_time, 'en')
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
      return await trx('appointment_requests')
        .where({
          appointment_request_id: appointmentRequest.appointment_request_id,
          tenant
        })
        .first();
    });

    return { success: true, data: updatedAppointmentRequest as IAppointmentRequest };
  } catch (error) {
    console.error('Error creating appointment request:', error);
    const message = error instanceof Error ? error.message : 'Failed to create appointment request';
    return { success: false, error: message };
  }
}

/**
 * Update a pending appointment request from the client portal
 */
export async function updateAppointmentRequest(
  data: UpdateAppointmentRequestInput
): Promise<AppointmentRequestResult<IAppointmentRequest>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    if ((currentUser as any).user_type !== 'client') {
      return { success: false, error: 'Only client users can update appointment requests' };
    }

    if (!(currentUser as any).contact_id) {
      return { success: false, error: 'Contact information not found' };
    }

    // Validate input
    const validatedData = updateAppointmentRequestSchema.parse(data);

    const { knex: db, tenant } = await createTenantKnex();

    if (!tenant) {
      return { success: false, error: 'Tenant not found' };
    }

    // Get client_id from contact
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({
          contact_name_id: (currentUser as any).contact_id,
          tenant
        })
        .select('client_id')
        .first();
    });

    if (!contact || !contact.client_id) {
      return { success: false, error: 'Client information not found' };
    }

    const clientId = contact.client_id;

    // Get existing appointment request
    const existingRequest = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id,
          tenant,
          client_id: clientId // Ensure user owns this request
        })
        .first();
    });

    if (!existingRequest) {
      return { success: false, error: 'Appointment request not found' };
    }

    if (existingRequest.status !== 'pending') {
      return { success: false, error: 'Only pending requests can be edited' };
    }

    // Verify service exists
    const service = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('service_catalog')
        .where({
          service_id: validatedData.service_id,
          tenant
        })
        .first();
    });

    if (!service) {
      return { success: false, error: 'Service not found' };
    }

    // Update the appointment request
    await withTransaction(db, async (trx: Knex.Transaction) => {
      await trx('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id,
          tenant
        })
        .update({
          service_id: validatedData.service_id,
          requested_date: validatedData.requested_date,
          requested_time: validatedData.requested_time,
          requested_duration: validatedData.requested_duration,
          preferred_assigned_user_id: validatedData.preferred_assigned_user_id || null,
          description: validatedData.description || null,
          ticket_id: validatedData.ticket_id || null,
          updated_at: new Date()
        });
    });

    // Update the associated schedule entry if it exists
    if (existingRequest.schedule_entry_id) {
      await withTransaction(db, async (trx: Knex.Transaction) => {
        const [startHour, startMinute] = validatedData.requested_time.split(':').map(Number);
        const scheduledStart = new Date(validatedData.requested_date);
        scheduledStart.setHours(startHour, startMinute, 0, 0);

        const scheduledEnd = new Date(scheduledStart);
        scheduledEnd.setMinutes(scheduledEnd.getMinutes() + validatedData.requested_duration);

        await trx('schedule_entries')
          .where({
            entry_id: existingRequest.schedule_entry_id,
            tenant
          })
          .update({
            title: `[Pending Request] ${service.service_name}`,
            scheduled_start: scheduledStart.toISOString(),
            scheduled_end: scheduledEnd.toISOString(),
            notes: validatedData.description || 'Appointment request from client portal',
            updated_at: new Date()
          });

        // Update assignee if changed
        if (validatedData.preferred_assigned_user_id !== existingRequest.preferred_assigned_user_id) {
          // Determine new assignee (preferred tech or default approver)
          let newAssigneeId = validatedData.preferred_assigned_user_id;

          if (!newAssigneeId) {
            // Get default approver
            const generalSetting = await trx('availability_settings')
              .where({
                tenant,
                setting_type: 'general_settings'
              })
              .whereNotNull('config_json')
              .first();

            newAssigneeId = generalSetting?.config_json?.default_approver_id || null;
          }

          if (newAssigneeId) {
            // Delete old assignee
            await trx('schedule_entry_assignees')
              .where({
                entry_id: existingRequest.schedule_entry_id,
                tenant
              })
              .delete();

            // Add new assignee
            await trx('schedule_entry_assignees').insert({
              entry_id: existingRequest.schedule_entry_id,
              user_id: newAssigneeId,
              tenant,
              created_at: new Date()
            });
          }
        }
      });
    }

    // Get updated request
    const updatedRequest = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id,
          tenant
        })
        .first();
    });

    console.log('[updateAppointmentRequest] Appointment updated successfully:', {
      appointment_request_id: updatedRequest.appointment_request_id,
      client_id: updatedRequest.client_id
    });

    return { success: true, data: updatedRequest as IAppointmentRequest };
  } catch (error) {
    console.error('Error updating appointment request:', error);
    const message = error instanceof Error ? error.message : 'Failed to update appointment request';
    return { success: false, error: message };
  }
}

/**
 * Get appointment requests for the current client user
 */
export async function getMyAppointmentRequests(
  filters?: Partial<AppointmentRequestFilters>
): Promise<AppointmentRequestResult<IAppointmentRequest[]>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    if ((currentUser as any).user_type !== 'client') {
      return { success: false, error: 'Only client users can access this endpoint' };
    }

    if (!(currentUser as any).contact_id) {
      return { success: false, error: 'Contact information not found' };
    }

    const { knex: db, tenant } = await createTenantKnex();

    if (!tenant) {
      return { success: false, error: 'Tenant not found' };
    }

    // Get client_id from contact
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({
          contact_name_id: (currentUser as any).contact_id,
          tenant
        })
        .select('client_id')
        .first();
    });

    if (!contact || !contact.client_id) {
      return { success: false, error: 'Client information not found' };
    }

    const clientId = contact.client_id;

    console.log('[getMyAppointmentRequests] Looking for appointments with:', {
      tenant,
      clientId,
      contactId: (currentUser as any).contact_id,
      filters
    });

    // Validate filters if provided (all fields are already optional in the schema)
    const validatedFilters = filters ? appointmentRequestFilterSchema.parse(filters) : {};

    const requests = await withTransaction(db, async (trx: Knex.Transaction) => {
      let query = trx('appointment_requests as ar')
        .leftJoin('service_catalog as sc', function() {
          this.on('ar.service_id', 'sc.service_id')
            .andOn('ar.tenant', 'sc.tenant');
        })
        .leftJoin('users as u', function() {
          this.on('ar.preferred_assigned_user_id', 'u.user_id')
            .andOn('ar.tenant', 'u.tenant');
        })
        .leftJoin('tickets as t', function() {
          this.on('ar.ticket_id', 't.ticket_id')
            .andOn('ar.tenant', 't.tenant');
        })
        .where({
          'ar.tenant': tenant,
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

      return await query;
    });

    console.log('[getMyAppointmentRequests] Found appointments:', requests.length);

    // Map the results to include the full technician name
    const mappedRequests = requests.map((request: any) => ({
      ...request,
      preferred_assigned_user_name: request.preferred_technician_first_name && request.preferred_technician_last_name
        ? `${request.preferred_technician_first_name} ${request.preferred_technician_last_name}`
        : undefined
    }));

    console.log('[getMyAppointmentRequests] Returning appointments:', mappedRequests.length);

    return { success: true, data: mappedRequests as IAppointmentRequest[] };
  } catch (error) {
    console.error('Error fetching appointment requests:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch appointment requests';
    return { success: false, error: message };
  }
}

/**
 * Get details of a specific appointment request
 */
export async function getAppointmentRequestDetails(
  requestId: string
): Promise<AppointmentRequestResult<IAppointmentRequest>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    if ((currentUser as any).user_type !== 'client') {
      return { success: false, error: 'Only client users can access this endpoint' };
    }

    if (!(currentUser as any).contact_id) {
      return { success: false, error: 'Contact information not found' };
    }

    const { knex: db, tenant } = await createTenantKnex();

    if (!tenant) {
      return { success: false, error: 'Tenant not found' };
    }

    // Get client_id from contact
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({
          contact_name_id: (currentUser as any).contact_id,
          tenant
        })
        .select('client_id')
        .first();
    });

    if (!contact || !contact.client_id) {
      return { success: false, error: 'Client information not found' };
    }

    const clientId = contact.client_id;

    const request = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('appointment_requests as ar')
        .leftJoin('service_catalog as sc', function() {
          this.on('ar.service_id', 'sc.service_id')
            .andOn('ar.tenant', 'sc.tenant');
        })
        .leftJoin('users as u', function() {
          this.on('ar.preferred_assigned_user_id', 'u.user_id')
            .andOn('ar.tenant', 'u.tenant');
        })
        .leftJoin('users as approver', function() {
          this.on('ar.approved_by_user_id', 'approver.user_id')
            .andOn('ar.tenant', 'approver.tenant');
        })
        .leftJoin('tickets as t', function() {
          this.on('ar.ticket_id', 't.ticket_id')
            .andOn('ar.tenant', 't.tenant');
        })
        .where({
          'ar.appointment_request_id': requestId,
          'ar.tenant': tenant,
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
        .first();
    });

    if (!request) {
      return { success: false, error: 'Appointment request not found' };
    }

    return { success: true, data: request as IAppointmentRequest };
  } catch (error) {
    console.error('Error fetching appointment request details:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch appointment request details';
    return { success: false, error: message };
  }
}

/**
 * Cancel a pending appointment request
 */
export async function cancelAppointmentRequest(
  data: CancelAppointmentRequestInput
): Promise<AppointmentRequestResult<void>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    if ((currentUser as any).user_type !== 'client') {
      return { success: false, error: 'Only client users can cancel appointment requests' };
    }

    if (!(currentUser as any).contact_id) {
      return { success: false, error: 'Contact information not found' };
    }

    // Validate input
    const validatedData = cancelAppointmentRequestSchema.parse(data);

    const { knex: db, tenant } = await createTenantKnex();

    if (!tenant) {
      return { success: false, error: 'Tenant not found' };
    }

    // Get client_id from contact
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({
          contact_name_id: (currentUser as any).contact_id,
          tenant
        })
        .select('client_id', 'full_name', 'email')
        .first();
    });

    if (!contact || !contact.client_id) {
      return { success: false, error: 'Client information not found' };
    }

    const clientId = contact.client_id;

    await withTransaction(db, async (trx: Knex.Transaction) => {
      // Verify request exists and belongs to this client
      const request = await trx('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id,
          tenant,
          client_id: clientId
        })
        .first();

      if (!request) {
        throw new Error('Appointment request not found');
      }

      // Only pending requests can be cancelled
      if (request.status !== 'pending') {
        throw new Error(`Cannot cancel appointment request with status: ${request.status}`);
      }

      const now = new Date();

      // Update request status to cancelled
      await trx('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id,
          tenant
        })
        .update({
          status: 'cancelled',
          declined_reason: validatedData.cancellation_reason || 'Cancelled by client',
          updated_at: now
        });

      // Send notification emails and internal notifications
      try {
        const emailService = SystemEmailService.getInstance();

        // Get service details for notifications
        const service = await trx('service_catalog')
          .where({
            service_id: request.service_id,
            tenant
          })
          .first();

        // Get client user_id for internal notification
        const clientUserId = await getClientUserIdFromContact(contact.contact_name_id, tenant);

        // Email to client confirming cancellation
        await emailService.sendEmail({
          to: contact.email || (currentUser as any).email || 'unknown@example.com',
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

        // Send internal notifications to MSP STAFF
        const staffUsers = await getScheduleApprovers(tenant);
        for (const staffUser of staffUsers) {
          await createNotificationFromTemplateInternal(trx, {
            tenant: tenant,
            user_id: staffUser.user_id,
            template_name: 'appointment-request-cancelled-staff',
            type: 'info',
            category: 'appointments',
            link: `/msp/schedule`,
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
    });

    return { success: true };
  } catch (error) {
    console.error('Error cancelling appointment request:', error);
    const message = error instanceof Error ? error.message : 'Failed to cancel appointment request';
    return { success: false, error: message };
  }
}

/**
 * Get available services and open tickets for appointment booking
 */
export async function getAvailableServicesAndTickets(): Promise<AppointmentRequestResult<{
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
}>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    if ((currentUser as any).user_type !== 'client') {
      return { success: false, error: 'Only client users can access this endpoint' };
    }

    if (!(currentUser as any).contact_id) {
      return { success: false, error: 'Contact information not found' };
    }

    const { knex: db, tenant } = await createTenantKnex();

    if (!tenant) {
      return { success: false, error: 'Tenant not found' };
    }

    // Get client_id from contact
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({
          contact_name_id: (currentUser as any).contact_id,
          tenant
        })
        .select('client_id')
        .first();
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
      return await trx('tickets')
        .where({
          tenant,
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
    const message = error instanceof Error ? error.message : 'Failed to fetch data';
    return { success: false, error: message };
  }
}

/**
 * Get available dates for a service (next 30 days)
 */
export async function getAvailableDatesForService(
  serviceId: string,
  userTimezone?: string
): Promise<AppointmentRequestResult<string[]>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    if ((currentUser as any).user_type !== 'client') {
      return { success: false, error: 'Only client users can access this endpoint' };
    }

    const { tenant } = await createTenantKnex();

    if (!tenant) {
      return { success: false, error: 'Tenant not found' };
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
    const message = error instanceof Error ? error.message : 'Failed to fetch available dates';
    return { success: false, error: message };
  }
}

/**
 * Get appointment requests linked to a specific ticket (client portal version)
 */
export async function getAppointmentRequestsByTicketId(
  ticketId: string
): Promise<AppointmentRequestResult<IAppointmentRequest[]>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    if ((currentUser as any).user_type !== 'client') {
      return { success: false, error: 'Only client users can access this endpoint' };
    }

    if (!(currentUser as any).contact_id) {
      return { success: false, error: 'Contact information not found' };
    }

    const { knex: db, tenant } = await createTenantKnex();

    if (!tenant) {
      return { success: false, error: 'Tenant not found' };
    }

    // Get client_id from contact
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({
          contact_name_id: (currentUser as any).contact_id,
          tenant
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
      return await trx('tickets')
        .where({
          ticket_id: ticketId,
          tenant,
          client_id: clientId
        })
        .first();
    });

    if (!ticket) {
      return { success: false, error: 'Ticket not found or does not belong to your organization' };
    }

    const requests = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('appointment_requests as ar')
        .leftJoin('service_catalog as sc', function() {
          this.on('ar.service_id', 'sc.service_id')
            .andOn('ar.tenant', 'sc.tenant');
        })
        .leftJoin('users as u', function() {
          this.on('ar.preferred_assigned_user_id', 'u.user_id')
            .andOn('ar.tenant', 'u.tenant');
        })
        .leftJoin('users as approver', function() {
          this.on('ar.approved_by_user_id', 'approver.user_id')
            .andOn('ar.tenant', 'approver.tenant');
        })
        .leftJoin('tickets as t', function() {
          this.on('ar.ticket_id', 't.ticket_id')
            .andOn('ar.tenant', 't.tenant');
        })
        .where('ar.tenant', tenant)
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
        .orderBy('ar.created_at', 'desc');
    });

    return { success: true, data: requests as IAppointmentRequest[] };
  } catch (error) {
    console.error('Error fetching appointment requests by ticket ID:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch appointment requests';
    return { success: false, error: message };
  }
}

/**
 * Get available time slots and technicians for a specific date
 */
export async function getAvailableTimeSlotsForDate(
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
}>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    if ((currentUser as any).user_type !== 'client') {
      return { success: false, error: 'Only client users can access this endpoint' };
    }

    const { knex: db, tenant } = await createTenantKnex();

    if (!tenant) {
      return { success: false, error: 'Tenant not found' };
    }

    // Get service-specific default duration
    const serviceSettings = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('availability_settings')
        .where({
          tenant,
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
      return await trx('availability_settings')
        .where({
          tenant,
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
          const users = await trx('users')
            .where({ tenant })
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

    // Format time slots for UI - always use SERVICE duration for display
    const timeSlots = slots.map(slot => {
      return {
        time: new Date(slot.start_time).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
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
    const message = error instanceof Error ? error.message : 'Failed to fetch time slots';
    return { success: false, error: message };
  }
}
