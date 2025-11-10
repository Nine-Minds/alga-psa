'use server';

import { createTenantKnex } from '../db';
import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { getCurrentUser } from './user-actions/userActions';
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

    // Check permissions
    const canRead = await hasPermission(currentUser as any, 'schedule', 'read', db);
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
        .leftJoin('companies as c', function() {
          this.on('ar.client_id', 'c.company_id')
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
          'c.company_name as client_company_name',
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
            .orWhereILike('c.company_name', searchTerm)
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

    // Check permissions
    const canUpdate = await hasPermission(currentUser as any, 'schedule', 'update', db);
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

      // Create schedule entry
      const scheduledStart = new Date(`${finalDate}T${finalTime}`);
      const scheduledEnd = new Date(scheduledStart.getTime() + request.requested_duration * 60000);

      const scheduleEntryData = {
        title: `Appointment: ${service.service_name}`,
        scheduled_start: scheduledStart,
        scheduled_end: scheduledEnd,
        work_item_type: request.ticket_id ? 'ticket' : 'ad_hoc',
        work_item_id: request.ticket_id || null,
        status: 'scheduled',
        notes: request.description || '',
        assigned_user_ids: [validatedData.assigned_user_id],
        is_recurring: false,
        is_private: false
      };

      const scheduleEntry = await ScheduleEntry.create(trx, scheduleEntryData, {
        assignedUserIds: [validatedData.assigned_user_id]
      });

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

        if (recipientEmail) {
          await emailService.sendEmail({
            to: recipientEmail,
            subject: 'Appointment Request Approved',
            html: `
              <h2>Appointment Confirmed</h2>
              <p>Dear ${recipientName || 'Customer'},</p>
              <p>Your appointment request has been approved!</p>
              <p><strong>Appointment Details:</strong></p>
              <ul>
                <li>Service: ${service.service_name}</li>
                <li>Date: ${finalDate}</li>
                <li>Time: ${finalTime}</li>
                <li>Duration: ${request.requested_duration} minutes</li>
                <li>Assigned Technician: ${assignedUser.first_name} ${assignedUser.last_name}</li>
              </ul>
              ${request.description ? `<p><strong>Notes:</strong> ${request.description}</p>` : ''}
              <p>We look forward to serving you. If you need to make any changes, please contact us.</p>
              <p>Reference Number: ${request.appointment_request_id}</p>
            `,
            tenantId: tenant
          });
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

    // Check permissions
    const canUpdate = await hasPermission(currentUser as any, 'schedule', 'update', db);
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
          updated_at: now
        });

      // Send notification email
      try {
        const emailService = SystemEmailService.getInstance();
        let recipientEmail = '';
        let recipientName = '';

        // Get service details
        const service = await trx('service_catalog')
          .where({
            service_id: request.service_id,
            tenant
          })
          .first();

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

        if (recipientEmail) {
          await emailService.sendEmail({
            to: recipientEmail,
            subject: 'Appointment Request Update',
            html: `
              <h2>Appointment Request Update</h2>
              <p>Dear ${recipientName || 'Customer'},</p>
              <p>Thank you for your interest in our services. We regret to inform you that we are unable to accommodate your appointment request at this time.</p>
              <p><strong>Original Request:</strong></p>
              <ul>
                <li>Service: ${service?.service_name || 'N/A'}</li>
                <li>Requested Date: ${request.requested_date}</li>
                <li>Requested Time: ${request.requested_time}</li>
              </ul>
              <p><strong>Reason:</strong> ${validatedData.decline_reason}</p>
              <p>We apologize for any inconvenience. Please feel free to submit a new request for alternative times, or contact us directly to discuss options.</p>
              <p>Reference Number: ${request.appointment_request_id}</p>
            `,
            tenantId: tenant
          });
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

    // Check permissions
    const canUpdate = await hasPermission(currentUser as any, 'schedule', 'update', db);
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

    // Check permissions
    const canUpdate = await hasPermission(currentUser as any, 'schedule', 'update', db);
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
