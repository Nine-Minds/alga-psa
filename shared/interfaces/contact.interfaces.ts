/**
 * Canonical Contact Interfaces
 * These are the canonical definitions for contact-related types used across the codebase.
 * All references should use these definitions unless there's a specific reason not to.
 */

/**
 * Phone number type options for contacts
 */
export type PhoneNumberType = 'Office' | 'Mobile' | 'Home' | 'Fax' | 'Other';

/**
 * Contact phone number entity
 */
export interface IContactPhoneNumber {
  phone_number_id: string;
  tenant?: string;
  contact_id: string;
  phone_type: PhoneNumberType;
  phone_number: string;
  extension: string | null;
  country_code: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateContactPhoneNumberInput {
  phone_type?: PhoneNumberType;
  phone_number: string;
  extension?: string;
  country_code?: string;
  is_primary?: boolean;
}

export interface UpdateContactPhoneNumberInput {
  phone_type?: PhoneNumberType;
  phone_number?: string;
  extension?: string;
  country_code?: string;
  is_primary?: boolean;
}

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
  notes_document_id?: string | null;
  is_inactive: boolean | null;
  phone_numbers?: IContactPhoneNumber[];
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