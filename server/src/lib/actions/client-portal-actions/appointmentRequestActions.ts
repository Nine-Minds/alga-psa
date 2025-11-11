'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { v4 as uuidv4 } from 'uuid';
import {
  createAppointmentRequestSchema,
  cancelAppointmentRequestSchema,
  CreateAppointmentRequestInput,
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

    if (currentUser.user_type !== 'client') {
      return { success: false, error: 'Only client users can create appointment requests' };
    }

    if (!currentUser.contact_id) {
      return { success: false, error: 'Contact information not found' };
    }

    // Validate input
    const validatedData = createAppointmentRequestSchema.parse(data);

    const { knex: db, tenant } = await createTenantKnex();

    // Get client_id from contact
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({
          contact_name_id: currentUser.contact_id,
          tenant
        })
        .select('client_id', 'full_name', 'email')
        .first();
    });

    if (!contact || !contact.client_id) {
      return { success: false, error: 'Client information not found' };
    }

    const clientId = contact.client_id;

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

    // Check if client has an active contract that includes this service
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
        requested_date: validatedData.requested_date,
        requested_time: validatedData.requested_time,
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

    // Send notification emails
    try {
      const emailService = SystemEmailService.getInstance();

      // Email to client confirming request received
      await emailService.sendEmail({
        to: contact.email || currentUser.email || '',
        subject: 'Appointment Request Received',
        html: `
          <h2>Appointment Request Received</h2>
          <p>Dear ${contact.full_name || 'Customer'},</p>
          <p>We have received your appointment request for <strong>${service.service_name}</strong>.</p>
          <p><strong>Details:</strong></p>
          <ul>
            <li>Date: ${validatedData.requested_date}</li>
            <li>Time: ${validatedData.requested_time}</li>
            <li>Duration: ${validatedData.requested_duration} minutes</li>
          </ul>
          <p>Your request is pending approval. We will notify you once it has been reviewed.</p>
          <p>Reference Number: ${appointmentRequest.appointment_request_id}</p>
          <p>Thank you for choosing our services.</p>
        `,
        tenantId: tenant
      });

      // Email to MSP staff for approval
      // Note: In production, this should query for users with appropriate permissions
      // For now, we'll log that notification should be sent
      console.log(`[AppointmentRequest] New request ${appointmentRequest.appointment_request_id} needs MSP approval`);
    } catch (emailError) {
      console.error('Error sending appointment request emails:', emailError);
      // Don't fail the request if email fails
    }

    return { success: true, data: appointmentRequest as IAppointmentRequest };
  } catch (error) {
    console.error('Error creating appointment request:', error);
    const message = error instanceof Error ? error.message : 'Failed to create appointment request';
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

    if (currentUser.user_type !== 'client') {
      return { success: false, error: 'Only client users can access this endpoint' };
    }

    if (!currentUser.contact_id) {
      return { success: false, error: 'Contact information not found' };
    }

    const { knex: db, tenant } = await createTenantKnex();

    // Get client_id from contact
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({
          contact_name_id: currentUser.contact_id,
          tenant
        })
        .select('client_id')
        .first();
    });

    if (!contact || !contact.client_id) {
      return { success: false, error: 'Client information not found' };
    }

    const clientId = contact.client_id;

    // Validate filters if provided
    const validatedFilters = filters ? appointmentRequestFilterSchema.partial().parse(filters) : {};

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
        .where({
          'ar.tenant': tenant,
          'ar.client_id': clientId
        })
        .select(
          'ar.*',
          'sc.service_name',
          'u.first_name as preferred_technician_first_name',
          'u.last_name as preferred_technician_last_name'
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

    return { success: true, data: requests as IAppointmentRequest[] };
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

    if (currentUser.user_type !== 'client') {
      return { success: false, error: 'Only client users can access this endpoint' };
    }

    if (!currentUser.contact_id) {
      return { success: false, error: 'Contact information not found' };
    }

    const { knex: db, tenant } = await createTenantKnex();

    // Get client_id from contact
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({
          contact_name_id: currentUser.contact_id,
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

    if (currentUser.user_type !== 'client') {
      return { success: false, error: 'Only client users can cancel appointment requests' };
    }

    if (!currentUser.contact_id) {
      return { success: false, error: 'Contact information not found' };
    }

    // Validate input
    const validatedData = cancelAppointmentRequestSchema.parse(data);

    const { knex: db, tenant } = await createTenantKnex();

    // Get client_id from contact
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({
          contact_name_id: currentUser.contact_id,
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

      // Send notification emails
      try {
        const emailService = SystemEmailService.getInstance();

        // Get service details for email
        const service = await trx('service_catalog')
          .where({
            service_id: request.service_id,
            tenant
          })
          .first();

        // Email to client confirming cancellation
        await emailService.sendEmail({
          to: contact.email || currentUser.email || '',
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

        console.log(`[AppointmentRequest] Request ${request.appointment_request_id} cancelled by client`);
      } catch (emailError) {
        console.error('Error sending cancellation emails:', emailError);
        // Don't fail the cancellation if email fails
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

    if (currentUser.user_type !== 'client') {
      return { success: false, error: 'Only client users can access this endpoint' };
    }

    if (!currentUser.contact_id) {
      return { success: false, error: 'Contact information not found' };
    }

    const { knex: db, tenant } = await createTenantKnex();

    // Get client_id from contact
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({
          contact_name_id: currentUser.contact_id,
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
  serviceId: string
): Promise<AppointmentRequestResult<string[]>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    if (currentUser.user_type !== 'client') {
      return { success: false, error: 'Only client users can access this endpoint' };
    }

    const { tenant } = await createTenantKnex();

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
      endDate
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
 * Get available time slots and technicians for a specific date
 */
export async function getAvailableTimeSlotsForDate(
  serviceId: string,
  date: string,
  duration: number = 60
): Promise<AppointmentRequestResult<{
  timeSlots: Array<{
    time: string;
    available: boolean;
    duration: number;
  }>;
  technicians: Array<{
    user_id: string;
    full_name: string;
  }>;
}>> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }

    if (currentUser.user_type !== 'client') {
      return { success: false, error: 'Only client users can access this endpoint' };
    }

    const { knex: db, tenant } = await createTenantKnex();

    // Get available time slots from service
    const slots = await getTimeSlotsFromService(
      tenant,
      date,
      serviceId,
      duration
    );

    // Extract unique user IDs from all slots
    const userIds = new Set<string>();
    slots.forEach(slot => {
      slot.available_users.forEach(userId => userIds.add(userId));
    });

    // Get technician details
    const technicians = userIds.size > 0
      ? await withTransaction(db, async (trx: Knex.Transaction) => {
          return await trx('users')
            .where({ tenant })
            .whereIn('user_id', Array.from(userIds))
            .select(
              'user_id',
              trx.raw("CONCAT(first_name, ' ', last_name) as full_name")
            );
        })
      : [];

    // Format time slots for UI
    const timeSlots = slots.map(slot => ({
      time: new Date(slot.start_time).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }),
      available: slot.is_available,
      duration: duration
    }));

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
