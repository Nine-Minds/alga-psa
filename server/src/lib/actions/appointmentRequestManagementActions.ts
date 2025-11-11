'use server';

import { createTenantKnex } from '../db';
import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { getCurrentUser, getCurrentUserPermissions } from './user-actions/userActions';
import { hasPermission } from '../auth/rbac';
import { v4 as uuidv4 } from 'uuid';
import {
  approveAppointmentRequestSchema,
  declineAppointmentRequestSchema,
  updateAppointmentRequestDateTimeSchema,
  associateRequestToTicketSchema,
  AppointmentRequestFilters,
  appointmentRequestFilterSchema,
  ApproveAppointmentRequestInput,
  DeclineAppointmentRequestInput,
  UpdateAppointmentRequestDateTimeInput,
  AssociateRequestToTicketInput
} from '../schemas/appointmentSchemas';
import { SystemEmailService } from '../email/system/SystemEmailService';
import ScheduleEntry from '../models/scheduleEntry';
import { publishEvent } from '../eventBus/publishers';
import {
  getTenantSettings,
  generateICSLink,
  getRequestNewAppointmentLink,
  getClientUserIdFromContact,
  formatDate,
  formatTime
} from './appointmentHelpers';
import { createNotificationFromTemplateInternal } from './internal-notification-actions/internalNotificationActions';

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
 * Get all appointment requests for MSP with filtering
 */
export async function getAppointmentRequests(
  filters?: AppointmentRequestFilters
): Promise<AppointmentRequestResult<IAppointmentRequest[]>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    const { knex: db, tenant } = await createTenantKnex();

    // Check permissions - use same permission as schedule actions
    const userPermissions = await getCurrentUserPermissions();
    const canRead = userPermissions.includes('user_schedule:read') || userPermissions.includes('user_schedule:update');
    if (!canRead) {
      return { success: false, error: 'Insufficient permissions to view appointment requests' };
    }

    // Validate filters if provided
    const validatedFilters = filters ? appointmentRequestFilterSchema.parse(filters) : {};

    const requests = await withTransaction(db, async (trx: Knex.Transaction) => {
      let query = trx('appointment_requests as ar')
        .leftJoin('service_catalog as sc', function() {
          this.on('ar.service_id', 'sc.service_id')
            .andOn('ar.tenant', 'sc.tenant');
        })
        .leftJoin('clients as c', function() {
          this.on('ar.client_id', 'c.client_id')
            .andOn('ar.tenant', 'c.tenant');
        })
        .leftJoin('contacts as con', function() {
          this.on('ar.contact_id', 'con.contact_name_id')
            .andOn('ar.tenant', 'con.tenant');
        })
        .leftJoin('users as u', function() {
          this.on('ar.preferred_assigned_user_id', 'u.user_id')
            .andOn('ar.tenant', 'u.tenant');
        })
        .leftJoin('users as approver', function() {
          this.on('ar.approved_by_user_id', 'approver.user_id')
            .andOn('ar.tenant', 'approver.tenant');
        })
        .where({ 'ar.tenant': tenant })
        .select(
          'ar.*',
          'sc.service_name',
          'c.client_name as client_company_name',
          'con.full_name as contact_name',
          'con.email as contact_email',
          'u.first_name as preferred_technician_first_name',
          'u.last_name as preferred_technician_last_name',
          'approver.first_name as approver_first_name',
          'approver.last_name as approver_last_name'
        )
        .orderBy('ar.created_at', 'desc');

      // Apply filters
      if (validatedFilters.status) {
        query = query.where('ar.status', validatedFilters.status);
      }

      if (validatedFilters.service_id) {
        query = query.where('ar.service_id', validatedFilters.service_id);
      }

      if (validatedFilters.client_id) {
        query = query.where('ar.client_id', validatedFilters.client_id);
      }

      if (validatedFilters.assigned_user_id) {
        query = query.where('ar.preferred_assigned_user_id', validatedFilters.assigned_user_id);
      }

      if (validatedFilters.start_date) {
        query = query.where('ar.requested_date', '>=', validatedFilters.start_date);
      }

      if (validatedFilters.end_date) {
        query = query.where('ar.requested_date', '<=', validatedFilters.end_date);
      }

      if (validatedFilters.is_authenticated !== undefined && validatedFilters.is_authenticated !== null) {
        query = query.where('ar.is_authenticated', validatedFilters.is_authenticated);
      }

      if (validatedFilters.search_query) {
        const searchTerm = `%${validatedFilters.search_query}%`;
        query = query.where(function() {
          this.whereILike('sc.service_name', searchTerm)
            .orWhereILike('c.client_name', searchTerm)
            .orWhereILike('con.full_name', searchTerm)
            .orWhereILike('ar.requester_name', searchTerm)
            .orWhereILike('ar.description', searchTerm);
        });
      }

      return await query;
    });

    return { success: true, data: requests as IAppointmentRequest[] };
  } catch (error) {
    console.error('Error fetching appointment requests:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch appointment requests';
    return { success: false, error: message };
  }
}

/**
 * Approve an appointment request and create a schedule entry
 */
export async function approveAppointmentRequest(
  data: ApproveAppointmentRequestInput
): Promise<AppointmentRequestResult<IAppointmentRequest>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    // Validate input
    const validatedData = approveAppointmentRequestSchema.parse(data);

    const { knex: db, tenant } = await createTenantKnex();

    // Check permissions - use same permission as schedule actions
    const userPermissions = await getCurrentUserPermissions();
    const canUpdate = userPermissions.includes('user_schedule:update');
    if (!canUpdate) {
      return { success: false, error: 'Insufficient permissions to approve appointment requests' };
    }

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get the appointment request
      const request = await trx('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id,
          tenant
        })
        .first();

      if (!request) {
        throw new Error('Appointment request not found');
      }

      if (request.status !== 'pending') {
        throw new Error(`Cannot approve request with status: ${request.status}`);
      }

      // Use final date/time if provided, otherwise use requested
      const finalDate = validatedData.final_date || request.requested_date;
      const finalTime = validatedData.final_time || request.requested_time;

      // Verify assigned user exists
      const assignedUser = await trx('users')
        .where({
          user_id: validatedData.assigned_user_id,
          tenant
        })
        .first();

      if (!assignedUser) {
        throw new Error('Assigned user not found');
      }

      // Get service details
      const service = await trx('service_catalog')
        .where({
          service_id: request.service_id,
          tenant
        })
        .first();

      if (!service) {
        throw new Error('Service not found');
      }

      // Create or update schedule entry
      const scheduledStart = new Date(`${finalDate}T${finalTime}`);
      const scheduledEnd = new Date(scheduledStart.getTime() + request.requested_duration * 60000);

      let scheduleEntry;

      if (request.schedule_entry_id) {
        // Update existing schedule entry (created when request was submitted)
        await trx('schedule_entries')
          .where({
            entry_id: request.schedule_entry_id,
            tenant
          })
          .update({
            title: `Appointment: ${service.service_name}`, // Remove [Pending Request] prefix
            scheduled_start: scheduledStart.toISOString(),
            scheduled_end: scheduledEnd.toISOString(),
            notes: request.description || '',
            updated_at: new Date()
          });

        // Update assignee if changed
        const currentAssignee = await trx('schedule_entry_assignees')
          .where({
            entry_id: request.schedule_entry_id,
            tenant
          })
          .first();

        if (currentAssignee && currentAssignee.user_id !== validatedData.assigned_user_id) {
          // Remove old assignee
          await trx('schedule_entry_assignees')
            .where({
              entry_id: request.schedule_entry_id,
              tenant
            })
            .delete();

          // Add new assignee
          await trx('schedule_entry_assignees').insert({
            entry_id: request.schedule_entry_id,
            user_id: validatedData.assigned_user_id,
            tenant,
            created_at: new Date()
          });
        }

        scheduleEntry = {
          entry_id: request.schedule_entry_id
        };
      } else {
        // Create new schedule entry (fallback for old requests)
        const scheduleEntryData = {
          title: `Appointment: ${service.service_name}`,
          scheduled_start: scheduledStart,
          scheduled_end: scheduledEnd,
          work_item_type: 'appointment_request' as const,
          work_item_id: request.appointment_request_id,
          status: 'scheduled',
          notes: request.description || '',
          assigned_user_ids: [validatedData.assigned_user_id],
          is_recurring: false,
          is_private: false
        };

        scheduleEntry = await ScheduleEntry.create(trx, scheduleEntryData, {
          assignedUserIds: [validatedData.assigned_user_id]
        });
      }

      const now = new Date();

      // Update appointment request
      await trx('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id,
          tenant
        })
        .update({
          status: 'approved',
          schedule_entry_id: scheduleEntry.entry_id,
          approved_by_user_id: currentUser.user_id,
          approved_at: now,
          ticket_id: validatedData.ticket_id || request.ticket_id,
          updated_at: now
        });

      // Get updated request
      const updatedRequest = await trx('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id,
          tenant
        })
        .first();

      // Get client user ID if available
      let clientUserId: string | undefined;
      if (request.is_authenticated && request.contact_id) {
        const clientUser = await trx('users')
          .select('user_id')
          .where({
            contact_id: request.contact_id,
            tenant,
            user_type: 'client'
          })
          .first();
        clientUserId = clientUser?.user_id;
      }

      // Publish event (will trigger internal notifications automatically)
      await publishEvent({
        eventType: 'APPOINTMENT_REQUEST_APPROVED',
        payload: {
          tenantId: tenant || '',
          appointmentRequestId: request.appointment_request_id,
          clientId: request.client_id,
          contactId: request.contact_id,
          clientUserId,
          serviceId: request.service_id,
          serviceName: service.service_name,
          requestedDate: finalDate,
          requestedTime: finalTime,
          requestedDuration: request.requested_duration,
          isAuthenticated: request.is_authenticated,
          requesterEmail: request.requester_email || '',
          requesterName: request.requester_name,
          approvedByUserId: currentUser.user_id,
          assignedUserId: validatedData.assigned_user_id,
          scheduleEntryId: scheduleEntry.entry_id
        }
      });

      // Send email using SystemEmailService
      try {
        const emailService = SystemEmailService.getInstance();
        let recipientEmail = '';
        let recipientName = '';

        if (request.is_authenticated) {
          // Get contact email
          const contact = await trx('contacts')
            .where({
              contact_name_id: request.contact_id,
              tenant
            })
            .first();

          recipientEmail = contact?.email || '';
          recipientName = contact?.full_name || '';
        } else {
          // Use requester email from request
          recipientEmail = request.requester_email || '';
          recipientName = request.requester_name || '';
        }

        if (recipientEmail && tenant) {
          // Get tenant settings
          const tenantSettings = await getTenantSettings(tenant);

          // Generate calendar link
          const scheduleEntryWithDetails = await trx('schedule_entries')
            .where({
              entry_id: scheduleEntry.entry_id,
              tenant
            })
            .first();

          const calendarLink = await generateICSLink(scheduleEntryWithDetails);

          await emailService.sendAppointmentRequestApproved({
            requesterName: recipientName,
            requesterEmail: recipientEmail,
            serviceName: service.service_name,
            appointmentDate: finalDate,
            appointmentTime: finalTime,
            duration: request.requested_duration,
            technicianName: `${assignedUser.first_name} ${assignedUser.last_name}`,
            technicianEmail: assignedUser.email || '',
            technicianPhone: assignedUser.phone || '',
            calendarLink: calendarLink,
            cancellationPolicy: 'Please cancel at least 24 hours in advance.',
            minimumNoticeHours: 24,
            contactEmail: tenantSettings.contactEmail,
            contactPhone: tenantSettings.contactPhone,
            tenantName: tenantSettings.tenantName,
            currentYear: new Date().getFullYear()
          }, {
            tenantId: tenant
          });

          console.log(`[AppointmentRequest] Approval email sent to ${recipientEmail}`);
        }

        // Send internal notification to client
        if (request.contact_id && tenant) {
          const clientUserId = await getClientUserIdFromContact(request.contact_id, tenant);
          if (clientUserId) {
            await createNotificationFromTemplateInternal(trx, {
              tenant: request.tenant,
              user_id: clientUserId,
              template_name: 'appointment-request-approved',
              type: 'success',
              category: 'appointments',
              link: `/client-portal/appointments/${request.appointment_request_id}`,
              data: {
                serviceName: service.service_name,
                appointmentDate: await formatDate(finalDate, 'en'),
                appointmentTime: await formatTime(finalTime, 'en'),
                technicianName: `${assignedUser.first_name} ${assignedUser.last_name}`
              }
            });
          }
        }

        console.log(`[AppointmentRequest] Request ${request.appointment_request_id} approved by ${currentUser.user_id}`);
      } catch (emailError) {
        console.error('Error sending approval email:', emailError);
        // Don't fail the approval if email fails
      }

      return updatedRequest;
    });

    return { success: true, data: result as IAppointmentRequest };
  } catch (error) {
    console.error('Error approving appointment request:', error);
    const message = error instanceof Error ? error.message : 'Failed to approve appointment request';
    return { success: false, error: message };
  }
}

/**
 * Decline an appointment request
 */
export async function declineAppointmentRequest(
  data: DeclineAppointmentRequestInput
): Promise<AppointmentRequestResult<void>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    // Validate input
    const validatedData = declineAppointmentRequestSchema.parse(data);

    const { knex: db, tenant } = await createTenantKnex();

    // Check permissions - use same permission as schedule actions
    const userPermissions = await getCurrentUserPermissions();
    const canUpdate = userPermissions.includes('user_schedule:update');
    if (!canUpdate) {
      return { success: false, error: 'Insufficient permissions to decline appointment requests' };
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get the appointment request
      const request = await trx('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id,
          tenant
        })
        .first();

      if (!request) {
        throw new Error('Appointment request not found');
      }

      if (request.status !== 'pending') {
        throw new Error(`Cannot decline request with status: ${request.status}`);
      }

      const now = new Date();

      // Delete the schedule entry if it exists
      if (request.schedule_entry_id) {
        // Delete assignees first (foreign key constraint)
        await trx('schedule_entry_assignees')
          .where({
            entry_id: request.schedule_entry_id,
            tenant
          })
          .delete();

        // Delete the schedule entry
        await trx('schedule_entries')
          .where({
            entry_id: request.schedule_entry_id,
            tenant
          })
          .delete();
      }

      // Update request status
      await trx('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id,
          tenant
        })
        .update({
          status: 'declined',
          declined_reason: validatedData.decline_reason,
          approved_by_user_id: currentUser.user_id,
          approved_at: now,
          schedule_entry_id: null, // Clear the schedule entry reference
          updated_at: now
        });

      // Get service details
      const service = await trx('service_catalog')
        .where({
          service_id: request.service_id,
          tenant
        })
        .first();

      if (!service) {
        throw new Error('Service not found');
      }

      // Get client user ID if available
      let clientUserId: string | undefined;
      if (request.is_authenticated && request.contact_id) {
        const clientUser = await trx('users')
          .select('user_id')
          .where({
            contact_id: request.contact_id,
            tenant,
            user_type: 'client'
          })
          .first();
        clientUserId = clientUser?.user_id;
      }

      // Publish event (will trigger internal notifications automatically)
      await publishEvent({
        eventType: 'APPOINTMENT_REQUEST_DECLINED',
        payload: {
          tenantId: tenant || '',
          appointmentRequestId: request.appointment_request_id,
          clientId: request.client_id,
          contactId: request.contact_id,
          clientUserId,
          serviceId: request.service_id,
          serviceName: service.service_name,
          requestedDate: request.requested_date,
          requestedTime: request.requested_time,
          requestedDuration: request.requested_duration,
          isAuthenticated: request.is_authenticated,
          requesterEmail: request.requester_email || '',
          requesterName: request.requester_name,
          declineReason: validatedData.decline_reason
        }
      });

      // Send notification email
      try {
        const emailService = SystemEmailService.getInstance();
        let recipientEmail = '';
        let recipientName = '';

        if (request.is_authenticated) {
          // Get contact email
          const contact = await trx('contacts')
            .where({
              contact_name_id: request.contact_id,
              tenant
            })
            .first();

          recipientEmail = contact?.email || '';
          recipientName = contact?.full_name || '';
        } else {
          // Use requester email from request
          recipientEmail = request.requester_email || '';
          recipientName = request.requester_name || '';
        }

        if (recipientEmail && tenant) {
          // Get tenant settings
          const tenantSettings = await getTenantSettings(tenant);
          const requestNewAppointmentLink = await getRequestNewAppointmentLink();

          await emailService.sendAppointmentRequestDeclined({
            requesterName: recipientName,
            requesterEmail: recipientEmail,
            serviceName: service.service_name,
            requestedDate: request.requested_date,
            requestedTime: request.requested_time,
            referenceNumber: request.appointment_request_id.slice(0, 8).toUpperCase(),
            declineReason: validatedData.decline_reason,
            requestNewAppointmentLink,
            contactEmail: tenantSettings.contactEmail,
            contactPhone: tenantSettings.contactPhone,
            tenantName: tenantSettings.tenantName,
            currentYear: new Date().getFullYear()
          }, {
            tenantId: tenant
          });

          console.log(`[AppointmentRequest] Decline email sent to ${recipientEmail}`);
        }

        // Send internal notification to client
        if (request.contact_id && tenant) {
          const clientUserId = await getClientUserIdFromContact(request.contact_id, tenant);
          if (clientUserId) {
            await createNotificationFromTemplateInternal(trx, {
              tenant: request.tenant,
              user_id: clientUserId,
              template_name: 'appointment-request-declined',
              type: 'warning',
              category: 'appointments',
              link: `/client-portal/appointments/${request.appointment_request_id}`,
              data: {
                serviceName: service.service_name,
                declineReason: validatedData.decline_reason
              }
            });
          }
        }

        console.log(`[AppointmentRequest] Request ${request.appointment_request_id} declined by ${currentUser.user_id}`);
      } catch (emailError) {
        console.error('Error sending decline email:', emailError);
        // Don't fail the decline if email fails
      }
    });

    return { success: true };
  } catch (error) {
    console.error('Error declining appointment request:', error);
    const message = error instanceof Error ? error.message : 'Failed to decline appointment request';
    return { success: false, error: message };
  }
}

/**
 * Update the requested date/time before approval
 */
export async function updateAppointmentRequestDateTime(
  data: UpdateAppointmentRequestDateTimeInput
): Promise<AppointmentRequestResult<IAppointmentRequest>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    // Validate input
    const validatedData = updateAppointmentRequestDateTimeSchema.parse(data);

    const { knex: db, tenant } = await createTenantKnex();

    // Check permissions - use same permission as schedule actions
    const userPermissions = await getCurrentUserPermissions();
    const canUpdate = userPermissions.includes('user_schedule:update');
    if (!canUpdate) {
      return { success: false, error: 'Insufficient permissions to update appointment requests' };
    }

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get the appointment request
      const request = await trx('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id,
          tenant
        })
        .first();

      if (!request) {
        throw new Error('Appointment request not found');
      }

      if (request.status !== 'pending') {
        throw new Error(`Cannot update request with status: ${request.status}`);
      }

      const now = new Date();
      const updateData: any = {
        requested_date: validatedData.new_date,
        requested_time: validatedData.new_time,
        updated_at: now
      };

      if (validatedData.new_duration) {
        updateData.requested_duration = validatedData.new_duration;
      }

      // Update request
      await trx('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id,
          tenant
        })
        .update(updateData);

      // Get updated request
      const updatedRequest = await trx('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id,
          tenant
        })
        .first();

      return updatedRequest;
    });

    return { success: true, data: result as IAppointmentRequest };
  } catch (error) {
    console.error('Error updating appointment request date/time:', error);
    const message = error instanceof Error ? error.message : 'Failed to update appointment request';
    return { success: false, error: message };
  }
}

/**
 * Associate an appointment request to an existing ticket
 */
export async function associateRequestToTicket(
  data: AssociateRequestToTicketInput
): Promise<AppointmentRequestResult<void>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    // Validate input
    const validatedData = associateRequestToTicketSchema.parse(data);

    const { knex: db, tenant } = await createTenantKnex();

    // Check permissions - use same permission as schedule actions
    const userPermissions = await getCurrentUserPermissions();
    const canUpdate = userPermissions.includes('user_schedule:update');
    if (!canUpdate) {
      return { success: false, error: 'Insufficient permissions to update appointment requests' };
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get the appointment request
      const request = await trx('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id,
          tenant
        })
        .first();

      if (!request) {
        throw new Error('Appointment request not found');
      }

      // Verify ticket exists
      const ticket = await trx('tickets')
        .where({
          ticket_id: validatedData.ticket_id,
          tenant
        })
        .first();

      if (!ticket) {
        throw new Error('Ticket not found');
      }

      // For authenticated requests, verify ticket belongs to same client
      if (request.is_authenticated && request.client_id && ticket.client_id !== request.client_id) {
        throw new Error('Ticket does not belong to the same client as the appointment request');
      }

      const now = new Date();

      // Update request with ticket association
      await trx('appointment_requests')
        .where({
          appointment_request_id: validatedData.appointment_request_id,
          tenant
        })
        .update({
          ticket_id: validatedData.ticket_id,
          updated_at: now
        });

      // If request is already approved and has a schedule entry, update that too
      if (request.schedule_entry_id) {
        await trx('schedule_entries')
          .where({
            entry_id: request.schedule_entry_id,
            tenant
          })
          .update({
            work_item_id: validatedData.ticket_id,
            work_item_type: 'ticket',
            updated_at: now
          });
      }
    });

    return { success: true };
  } catch (error) {
    console.error('Error associating request to ticket:', error);
    const message = error instanceof Error ? error.message : 'Failed to associate request to ticket';
    return { success: false, error: message };
  }
}
