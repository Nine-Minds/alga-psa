/**
 * Canonical Contact Interfaces
 * These are the canonical definitions for contact-related types used across the codebase.
 * All references should use these definitions unless there's a specific reason not to.
 */

export const CONTACT_PHONE_CANONICAL_TYPES = ['work', 'mobile', 'home', 'fax', 'other'] as const;

export type ContactPhoneCanonicalType = typeof CONTACT_PHONE_CANONICAL_TYPES[number];

export const CONTACT_EMAIL_CANONICAL_TYPES = ['work', 'personal', 'billing', 'other'] as const;

export type ContactEmailCanonicalType = typeof CONTACT_EMAIL_CANONICAL_TYPES[number];

export interface IContactPhoneNumber {
  contact_phone_number_id: string;
  phone_number: string;
  normalized_phone_number: string;
  canonical_type: ContactPhoneCanonicalType | null;
  custom_phone_type_id?: string | null;
  custom_type: string | null;
  is_default: boolean;
  display_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface IContactEmailAddress {
  contact_additional_email_address_id: string;
  email_address: string;
  normalized_email_address: string;
  canonical_type: ContactEmailCanonicalType | null;
  custom_email_type_id?: string | null;
  custom_type: string | null;
  display_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface ContactEmailAddressInput {
  contact_additional_email_address_id?: string;
  email_address: string;
  canonical_type?: ContactEmailCanonicalType | null;
  custom_type?: string | null;
  display_order?: number;
}

export interface ContactPhoneNumberInput {
  contact_phone_number_id?: string;
  phone_number: string;
  canonical_type?: ContactPhoneCanonicalType | null;
  custom_type?: string | null;
  is_default?: boolean;
  display_order?: number;
}

/**
 * Core contact entity interface
 */
export interface IContact {
  contact_name_id: string;
  tenant?: string;
  full_name: string;
  client_id: string | null;
  phone_numbers: IContactPhoneNumber[];
  default_phone_number?: string | null;
  default_phone_type?: string | null;
  primary_email_canonical_type?: ContactEmailCanonicalType | null;
  primary_email_custom_type_id?: string | null;
  primary_email_type?: string | null;
  additional_email_addresses?: IContactEmailAddress[];
  email: string | null;
  role: string | null;
  notes: string | null;
  notes_document_id?: string | null;
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
  primary_email_canonical_type?: ContactEmailCanonicalType | null;
  primary_email_custom_type?: string | null;
  primary_email_custom_type_id?: string | null;
  additional_email_addresses?: ContactEmailAddressInput[];
  phone_numbers?: ContactPhoneNumberInput[];
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
  primary_email_canonical_type?: ContactEmailCanonicalType | null;
  primary_email_custom_type?: string | null;
  primary_email_custom_type_id?: string | null;
  additional_email_addresses?: ContactEmailAddressInput[];
  phone_numbers?: ContactPhoneNumberInput[];
  client_id?: string;
  role?: string;
  notes?: string;
  is_inactive?: boolean;
}
