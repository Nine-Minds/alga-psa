/**
 * Canonical Contact Interfaces
 * These are the canonical definitions for contact-related types used across the codebase.
 * All references should use these definitions unless there's a specific reason not to.
 */

/**
 * Core contact entity interface
 */
export interface IContact {
  contact_name_id: string;
  tenant?: string;
  full_name: string;
  client_id: string | null;
  phone_number: string | null;
  email: string | null;
  role: string | null;
  notes: string | null;
  is_inactive: boolean | null;
  created_at: string;
  updated_at: string;
  [key: string]: any; // Allow additional properties for database fields
}

/**
 * Input type for creating a new contact
 */
export interface CreateContactInput {
  full_name: string;
  email?: string;
  phone_number?: string;
  client_id?: string;
  role?: string;
  notes?: string;
  is_inactive?: boolean;
}

/**
 * Input type for updating an existing contact
 */
export interface UpdateContactInput {
  full_name?: string;
  email?: string;
  phone_number?: string;
  client_id?: string;
  role?: string;
  notes?: string;
  is_inactive?: boolean;
}