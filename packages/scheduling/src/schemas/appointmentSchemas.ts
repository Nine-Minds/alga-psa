import { z } from 'zod';
import { tenantSchema } from '@alga-psa/validation';

/**
 * Shared Validation Patterns
 */

// Date validation: YYYY-MM-DD format
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
export const dateStringSchema = z.string().regex(dateRegex, 'Date must be in YYYY-MM-DD format');

// Time validation: HH:MM format (24-hour)
const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
export const timeStringSchema = z.string().regex(timeRegex, 'Time must be in HH:MM format (24-hour)');

/**
 * Appointment Request Status Schema
 */
export const appointmentRequestStatusSchema = z.enum(['pending', 'approved', 'declined', 'cancelled']);

/**
 * Availability Setting Type Schema
 */
export const availabilitySettingTypeSchema = z.enum(['user_hours', 'service_rules', 'general_settings']);

/**
 * Create Appointment Request Schema (Authenticated - Client Portal)
 * Used when logged-in clients request appointments
 */
export const createAppointmentRequestSchema = z.object({
  service_id: z.string().uuid('Service ID must be a valid UUID'),
  requested_date: dateStringSchema,
  requested_time: timeStringSchema,
  requested_duration: z.number().int().min(15, 'Duration must be at least 15 minutes').max(480, 'Duration cannot exceed 8 hours'),
  preferred_assigned_user_id: z.string().uuid('User ID must be a valid UUID').optional().nullable(),
  description: z.string().max(2000, 'Description cannot exceed 2000 characters').optional().nullable(),
  ticket_id: z.string().uuid('Ticket ID must be a valid UUID').optional().nullable(),
}).refine((data) => {
  // Validate that requested_date is not in the past
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Reset to start of day
  const requestedDate = new Date(data.requested_date);
  return requestedDate >= today;
}, {
  message: 'Requested date cannot be in the past',
  path: ['requested_date'],
});

export type CreateAppointmentRequestInput = z.infer<typeof createAppointmentRequestSchema>;

/**
 * Update Appointment Request Schema (Client Portal)
 * Used when clients edit pending appointment requests
 */
export const updateAppointmentRequestSchema = z.object({
  appointment_request_id: z.string().uuid('Request ID must be a valid UUID'),
  service_id: z.string().uuid('Service ID must be a valid UUID'),
  requested_date: dateStringSchema,
  requested_time: timeStringSchema,
  requested_duration: z.number().int().min(15, 'Duration must be at least 15 minutes').max(480, 'Duration cannot exceed 8 hours'),
  preferred_assigned_user_id: z.string().uuid('User ID must be a valid UUID').optional().nullable(),
  description: z.string().max(2000, 'Description cannot exceed 2000 characters').optional().nullable(),
  ticket_id: z.string().uuid('Ticket ID must be a valid UUID').optional().nullable(),
}).refine((data) => {
  // Validate that requested_date is not in the past
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Reset to start of day
  const requestedDate = new Date(data.requested_date);
  return requestedDate >= today;
}, {
  message: 'Requested date cannot be in the past',
  path: ['requested_date'],
});

export type UpdateAppointmentRequestInput = z.infer<typeof updateAppointmentRequestSchema>;

/**
 * Create Public Appointment Request Schema (Unauthenticated - Public API)
 * Used for public booking requests from website
 */
export const createPublicAppointmentRequestSchema = z.object({
  tenant: z.string().min(1, 'Tenant identifier is required'),
  name: z.string().min(1, 'Name is required').max(255, 'Name cannot exceed 255 characters'),
  email: z.string().email('Valid email address is required'),
  phone: z.string().min(1).max(50).optional().nullable(),
  company: z.string().max(255, 'Company name cannot exceed 255 characters').optional().nullable(),
  service_id: z.string().uuid('Service ID must be a valid UUID'),
  requested_date: dateStringSchema,
  requested_time: timeStringSchema,
  requested_duration: z.number().int().min(15, 'Duration must be at least 15 minutes').max(480, 'Duration cannot exceed 8 hours').optional(),
  message: z.string().max(2000, 'Message cannot exceed 2000 characters').optional().nullable(),
  preferred_assigned_user_id: z.string().uuid('Preferred technician ID must be a valid UUID').optional().nullable(),
});

export type CreatePublicAppointmentRequestInput = z.infer<typeof createPublicAppointmentRequestSchema>;

/**
 * Approve Appointment Request Schema
 * Used by MSP staff to approve appointment requests
 */
export const approveAppointmentRequestSchema = z.object({
  appointment_request_id: z.string().uuid('Request ID must be a valid UUID'),
  final_date: dateStringSchema.optional().nullable(),
  final_time: timeStringSchema.optional().nullable(),
  assigned_user_id: z.string().uuid('Assigned user ID must be a valid UUID'),
  internal_notes: z.string().max(2000, 'Notes cannot exceed 2000 characters').optional().nullable(),
  ticket_id: z.string().uuid('Ticket ID must be a valid UUID').optional().nullable(),
});

export type ApproveAppointmentRequestInput = z.infer<typeof approveAppointmentRequestSchema>;

/**
 * Decline Appointment Request Schema
 * Used by MSP staff to decline appointment requests
 */
export const declineAppointmentRequestSchema = z.object({
  appointment_request_id: z.string().uuid('Request ID must be a valid UUID'),
  decline_reason: z.string().min(1, 'Reason for declining is required').max(2000, 'Reason cannot exceed 2000 characters'),
});

export type DeclineAppointmentRequestInput = z.infer<typeof declineAppointmentRequestSchema>;

/**
 * Cancel Appointment Request Schema
 * Used by clients to cancel their pending requests
 */
export const cancelAppointmentRequestSchema = z.object({
  appointment_request_id: z.string().uuid('Request ID must be a valid UUID'),
  cancellation_reason: z.string().max(2000, 'Cancellation reason cannot exceed 2000 characters').optional().nullable(),
});

export type CancelAppointmentRequestInput = z.infer<typeof cancelAppointmentRequestSchema>;

/**
 * Availability Setting Schema
 * Used to create or update availability settings
 */
export const availabilitySettingSchema = z.object({
  setting_type: availabilitySettingTypeSchema,
  user_id: z.string().uuid('User ID must be a valid UUID').optional().nullable(),
  service_id: z.string().uuid('Service ID must be a valid UUID').optional().nullable(),
  day_of_week: z.number().int().min(0, 'Day of week must be 0-6').max(6, 'Day of week must be 0-6').optional().nullable(),
  start_time: timeStringSchema.optional().nullable(),
  end_time: timeStringSchema.optional().nullable(),
  is_available: z.boolean(),
  buffer_before_minutes: z.number().int().min(0).max(120, 'Buffer before cannot exceed 120 minutes').optional().nullable(),
  buffer_after_minutes: z.number().int().min(0).max(120, 'Buffer after cannot exceed 120 minutes').optional().nullable(),
  max_appointments_per_day: z.number().int().min(1).max(50, 'Max appointments per day cannot exceed 50').optional().nullable(),
  allow_without_contract: z.boolean().optional().nullable(),
  advance_booking_days: z.number().int().min(1).max(365, 'Advance booking days must be between 1-365').optional().nullable(),
  minimum_notice_hours: z.number().int().min(0).max(168, 'Minimum notice hours cannot exceed 1 week').optional().nullable(),
  config_json: z.record(z.any()).optional().nullable(),
}).refine((data) => {
  // Validate that start_time is before end_time when both are provided
  if (data.start_time && data.end_time) {
    const [startHour, startMinute] = data.start_time.split(':').map(Number);
    const [endHour, endMinute] = data.end_time.split(':').map(Number);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    return startMinutes < endMinutes;
  }
  return true;
}, {
  message: 'Start time must be before end time',
  path: ['start_time'],
});

export type AvailabilitySettingInput = z.infer<typeof availabilitySettingSchema>;

/**
 * Availability Exception Schema
 * Used to create or update availability exceptions
 */
export const availabilityExceptionSchema = z.object({
  user_id: z.string().uuid('User ID must be a valid UUID').optional().nullable(),
  date: dateStringSchema,
  is_available: z.boolean(),
  reason: z.string().max(500, 'Reason cannot exceed 500 characters').optional().nullable(),
});

export type AvailabilityExceptionInput = z.infer<typeof availabilityExceptionSchema>;

/**
 * Update Availability Setting Schema
 * Partial version for updates
 */
export const updateAvailabilitySettingSchema = z.object({
  setting_type: availabilitySettingTypeSchema.optional(),
  user_id: z.string().uuid('User ID must be a valid UUID').optional().nullable(),
  service_id: z.string().uuid('Service ID must be a valid UUID').optional().nullable(),
  day_of_week: z.number().int().min(0, 'Day of week must be 0-6').max(6, 'Day of week must be 0-6').optional().nullable(),
  start_time: timeStringSchema.optional().nullable(),
  end_time: timeStringSchema.optional().nullable(),
  is_available: z.boolean().optional(),
  buffer_before_minutes: z.number().int().min(0).max(120, 'Buffer before cannot exceed 120 minutes').optional().nullable(),
  buffer_after_minutes: z.number().int().min(0).max(120, 'Buffer after cannot exceed 120 minutes').optional().nullable(),
  max_appointments_per_day: z.number().int().min(1).max(50, 'Max appointments per day cannot exceed 50').optional().nullable(),
  allow_without_contract: z.boolean().optional().nullable(),
  advance_booking_days: z.number().int().min(1).max(365, 'Advance booking days must be between 1-365').optional().nullable(),
  minimum_notice_hours: z.number().int().min(0).max(168, 'Minimum notice hours cannot exceed 1 week').optional().nullable(),
  config_json: z.record(z.any()).optional().nullable(),
});

export type UpdateAvailabilitySettingInput = z.infer<typeof updateAvailabilitySettingSchema>;

/**
 * Update Availability Exception Schema
 * Partial version for updates
 */
export const updateAvailabilityExceptionSchema = availabilityExceptionSchema.partial();

export type UpdateAvailabilityExceptionInput = z.infer<typeof updateAvailabilityExceptionSchema>;

/**
 * Get Available Time Slots Query Schema
 * Used to fetch available time slots for a given date/service
 */
export const getAvailableTimeSlotsSchema = z.object({
  service_id: z.string().uuid('Service ID must be a valid UUID'),
  date: dateStringSchema,
  duration: z.number().int().min(15).max(480).optional(),
  user_id: z.string().uuid('User ID must be a valid UUID').optional().nullable(),
});

export type GetAvailableTimeSlotsInput = z.infer<typeof getAvailableTimeSlotsSchema>;

/**
 * Get Available Dates Query Schema
 * Used to fetch dates with availability in a date range
 */
export const getAvailableDatesSchema = z.object({
  service_id: z.string().uuid('Service ID must be a valid UUID'),
  start_date: dateStringSchema,
  end_date: dateStringSchema,
  user_id: z.string().uuid('User ID must be a valid UUID').optional().nullable(),
}).refine((data) => {
  // Validate that start_date is before or equal to end_date
  return data.start_date <= data.end_date;
}, {
  message: 'Start date must be before or equal to end date',
  path: ['start_date'],
});

export type GetAvailableDatesInput = z.infer<typeof getAvailableDatesSchema>;

/**
 * Appointment Request Filter Schema
 * Used for filtering appointment requests in list views
 */
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
  // Validate that start_date is before or equal to end_date when both are provided
  if (data.start_date && data.end_date) {
    return data.start_date <= data.end_date;
  }
  return true;
}, {
  message: 'Start date must be before or equal to end date',
  path: ['start_date'],
});

export type AppointmentRequestFilters = z.infer<typeof appointmentRequestFilterSchema>;

/**
 * Update Appointment Request DateTime Schema
 * Used by MSP staff to modify the requested date/time during approval
 */
export const updateAppointmentRequestDateTimeSchema = z.object({
  appointment_request_id: z.string().uuid('Request ID must be a valid UUID'),
  new_date: dateStringSchema,
  new_time: timeStringSchema,
  new_duration: z.number().int().min(15).max(480).optional().nullable(),
});

export type UpdateAppointmentRequestDateTimeInput = z.infer<typeof updateAppointmentRequestDateTimeSchema>;

/**
 * Associate Request to Ticket Schema
 * Used to link an appointment request to an existing ticket
 */
export const associateRequestToTicketSchema = z.object({
  appointment_request_id: z.string().uuid('Request ID must be a valid UUID'),
  ticket_id: z.string().uuid('Ticket ID must be a valid UUID'),
});

export type AssociateRequestToTicketInput = z.infer<typeof associateRequestToTicketSchema>;

/**
 * Availability Setting Filters Schema
 * Used for filtering availability settings in list views
 */
export const availabilitySettingFiltersSchema = z.object({
  setting_type: availabilitySettingTypeSchema.optional().nullable(),
  user_id: z.string().uuid().optional().nullable(),
  service_id: z.string().uuid().optional().nullable(),
  day_of_week: z.number().int().min(0).max(6).optional().nullable(),
}).optional();

export type AvailabilitySettingFilters = z.infer<typeof availabilitySettingFiltersSchema>;

/**
 * Full Appointment Request Schema (for validation of complete records)
 */
export const appointmentRequestSchema = tenantSchema.extend({
  appointment_request_id: z.string().uuid(),
  client_id: z.string().uuid().optional().nullable(),
  contact_id: z.string().uuid().optional().nullable(),
  service_id: z.string().uuid(),
  requested_date: dateStringSchema,
  requested_time: timeStringSchema,
  requested_duration: z.number().int().min(15).max(480),
  preferred_assigned_user_id: z.string().uuid().optional().nullable(),
  status: appointmentRequestStatusSchema,
  description: z.string().max(2000).optional().nullable(),
  ticket_id: z.string().uuid().optional().nullable(),
  is_authenticated: z.boolean(),
  requester_name: z.string().max(255).optional().nullable(),
  requester_email: z.string().email().optional().nullable(),
  requester_phone: z.string().max(50).optional().nullable(),
  company_name: z.string().max(255).optional().nullable(),
  schedule_entry_id: z.string().uuid().optional().nullable(),
  approved_by_user_id: z.string().uuid().optional().nullable(),
  approved_at: z.string().optional().nullable(),
  declined_reason: z.string().max(2000).optional().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type AppointmentRequest = z.infer<typeof appointmentRequestSchema>;

/**
 * Full Availability Setting Schema (for validation of complete records)
 */
export const fullAvailabilitySettingSchema = tenantSchema.extend({
  availability_setting_id: z.string().uuid(),
  setting_type: availabilitySettingTypeSchema,
  user_id: z.string().uuid().optional().nullable(),
  service_id: z.string().uuid().optional().nullable(),
  day_of_week: z.number().int().min(0).max(6).optional().nullable(),
  start_time: timeStringSchema.optional().nullable(),
  end_time: timeStringSchema.optional().nullable(),
  is_available: z.boolean(),
  buffer_before_minutes: z.number().int().min(0).max(120).optional().nullable(),
  buffer_after_minutes: z.number().int().min(0).max(120).optional().nullable(),
  max_appointments_per_day: z.number().int().min(1).max(50).optional().nullable(),
  allow_without_contract: z.boolean().optional().nullable(),
  advance_booking_days: z.number().int().min(1).max(365).optional().nullable(),
  minimum_notice_hours: z.number().int().min(0).max(168).optional().nullable(),
  config_json: z.record(z.any()).optional().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type AvailabilitySetting = z.infer<typeof fullAvailabilitySettingSchema>;

/**
 * Full Availability Exception Schema (for validation of complete records)
 */
export const fullAvailabilityExceptionSchema = tenantSchema.extend({
  exception_id: z.string().uuid(),
  user_id: z.string().uuid().optional().nullable(),
  date: dateStringSchema,
  is_available: z.boolean(),
  reason: z.string().max(500).optional().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type AvailabilityException = z.infer<typeof fullAvailabilityExceptionSchema>;
