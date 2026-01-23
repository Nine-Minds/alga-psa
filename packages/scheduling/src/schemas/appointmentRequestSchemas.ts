import { z } from 'zod';

// Copied from @alga-psa/client-portal appointmentSchemas.ts to avoid scheduling ↔ client-portal cycles.

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
export const dateStringSchema = z.string().regex(dateRegex, 'Date must be in YYYY-MM-DD format');

const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
export const timeStringSchema = z.string().regex(timeRegex, 'Time must be in HH:MM format (24-hour)');

export const appointmentRequestStatusSchema = z.enum(['pending', 'approved', 'declined', 'cancelled']);

export const appointmentRequestFilterSchema = z.object({
  status: appointmentRequestStatusSchema.optional().nullable(),
  service_id: z.string().uuid().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
  assigned_user_id: z.string().uuid().optional().nullable(),
  start_date: dateStringSchema.optional().nullable(),
  end_date: dateStringSchema.optional().nullable(),
  is_authenticated: z.boolean().optional().nullable(),
  search_query: z.string().optional().nullable(),
}).refine((data) => {
  if (data.start_date && data.end_date) {
    return data.start_date <= data.end_date;
  }
  return true;
}, {
  message: 'Start date must be before or equal to end date',
  path: ['start_date'],
});

export type AppointmentRequestFilters = z.infer<typeof appointmentRequestFilterSchema>;

export const approveAppointmentRequestSchema = z.object({
  appointment_request_id: z.string().uuid('Request ID must be a valid UUID'),
  final_date: dateStringSchema.optional().nullable(),
  final_time: timeStringSchema.optional().nullable(),
  assigned_user_id: z.string().uuid('Assigned user ID must be a valid UUID'),
  internal_notes: z.string().max(2000, 'Notes cannot exceed 2000 characters').optional().nullable(),
  ticket_id: z.string().uuid('Ticket ID must be a valid UUID').optional().nullable(),
});

export type ApproveAppointmentRequestInput = z.infer<typeof approveAppointmentRequestSchema>;

export const declineAppointmentRequestSchema = z.object({
  appointment_request_id: z.string().uuid('Request ID must be a valid UUID'),
  decline_reason: z.string().min(1, 'Reason for declining is required').max(2000, 'Reason cannot exceed 2000 characters'),
});

export type DeclineAppointmentRequestInput = z.infer<typeof declineAppointmentRequestSchema>;

export const updateAppointmentRequestDateTimeSchema = z.object({
  appointment_request_id: z.string().uuid('Request ID must be a valid UUID'),
  new_date: dateStringSchema,
  new_time: timeStringSchema,
  new_duration: z.number().int().min(15).max(480).optional().nullable(),
});

export type UpdateAppointmentRequestDateTimeInput = z.infer<typeof updateAppointmentRequestDateTimeSchema>;

export const associateRequestToTicketSchema = z.object({
  appointment_request_id: z.string().uuid('Request ID must be a valid UUID'),
  ticket_id: z.string().uuid('Ticket ID must be a valid UUID'),
});

export type AssociateRequestToTicketInput = z.infer<typeof associateRequestToTicketSchema>;

