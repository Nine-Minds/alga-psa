import { TenantEntity } from './index';

/**
 * Appointment Request Status
 */
export type AppointmentRequestStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

/**
 * Availability Setting Type
 */
export type AvailabilitySettingType = 'user_hours' | 'service_rules' | 'general_settings';

/**
 * Interface for appointment requests
 * Supports both authenticated (client portal) and unauthenticated (public) requests
 */
export interface IAppointmentRequest extends TenantEntity {
  appointment_request_id: string;
  tenant: string;
  client_id?: string | null;
  contact_id?: string | null;
  service_id: string;
  requested_date: string; // ISO date (YYYY-MM-DD)
  requested_time: string; // HH:MM format
  requested_duration: number; // minutes
  preferred_assigned_user_id?: string | null;
  status: AppointmentRequestStatus;
  description?: string | null;
  ticket_id?: string | null;
  is_authenticated: boolean;
  requester_name?: string | null;
  requester_email?: string | null;
  requester_phone?: string | null;
  company_name?: string | null;
  schedule_entry_id?: string | null;
  approved_by_user_id?: string | null;
  approved_at?: string | null;
  declined_reason?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Interface for availability settings
 * Configures when and how appointments can be scheduled
 */
export interface IAvailabilitySetting extends TenantEntity {
  availability_setting_id: string;
  tenant: string;
  setting_type: AvailabilitySettingType;
  user_id?: string | null;
  service_id?: string | null;
  day_of_week?: number | null; // 0-6 (Sunday-Saturday)
  start_time?: string | null; // HH:MM format
  end_time?: string | null; // HH:MM format
  is_available: boolean;
  buffer_before_minutes?: number | null;
  buffer_after_minutes?: number | null;
  max_appointments_per_day?: number | null;
  allow_without_contract?: boolean | null;
  advance_booking_days?: number | null;
  minimum_notice_hours?: number | null;
  config_json?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

/**
 * Interface for availability exceptions
 * Handles holidays, time off, and other schedule exceptions
 */
export interface IAvailabilityException extends TenantEntity {
  exception_id: string;
  tenant: string;
  user_id?: string | null;
  date: string; // ISO date (YYYY-MM-DD)
  is_available: boolean;
  reason?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Interface for available time slots
 * Used when presenting booking options to clients
 */
export interface ITimeSlot {
  start_time: string; // ISO datetime
  end_time: string; // ISO datetime
  available_users: string[]; // Array of user_ids
  is_available: boolean;
}

/**
 * Interface for available dates
 * Used to show which dates have availability
 */
export interface IAvailableDate {
  date: string; // ISO date (YYYY-MM-DD)
  has_availability: boolean;
  slot_count?: number;
}

/**
 * Extended appointment request with related data for display
 */
export interface IAppointmentRequestWithDetails extends IAppointmentRequest {
  service_name?: string;
  client_name?: string;
  contact_name?: string;
  preferred_assigned_user_name?: string;
  approved_by_user_name?: string;
  ticket_number?: string;
}
