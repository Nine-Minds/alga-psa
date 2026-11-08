/**
 * Canonical Contact Interfaces
 * These are the canonical definitions for contact-related types used across the codebase.
 * All references should use these definitions unless there's a specific reason not to.
 */

export const CONTACT_PHONE_CANONICAL_TYPES = ['work', 'mobile', 'home', 'fax', 'other'] as const;

export type ContactPhoneCanonicalType = typeof CONTACT_PHONE_CANONICAL_TYPES[number];

export const CONTACT_EMAIL_CANONICAL_TYPES = ['work', 'personal', 'billing', 'other'] as const;

export type ContactEmailCanonicalType = typeof CONTACT_EMAIL_CANONICAL_TYPES[number];

export const CONTACT_WORK_ARRANGEMENTS = ['on_site', 'hybrid', 'remote'] as const;

/** Where a person normally works. Null/undefined means unset. */
export type ContactWorkArrangement = typeof CONTACT_WORK_ARRANGEMENTS[number];

/**
 * A contact's link to one of its client's locations. The address fields are a read-through of
 * `client_locations`, never stored on the contact.
 */
export interface IContactLocation {
  location_id: string;
  location_name: string | null;
  is_primary: boolean;
  is_active: boolean;
  address_line1?: string | null;
  address_line2?: string | null;
  address_line3?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
  country_name?: string | null;
}

/** What a caller may write: the set of links, with at most one primary. */
export interface ContactLocationInput {
  location_id: string;
  is_primary?: boolean;
}

export interface IContactPhoneNumber {
  contact_phone_number_id: string;
  phone_number: string;
  /** Stored separately; never packed into phone_number. */
  extension?: string | null;
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
  contact_kind?: 'person' | 'shared_mailbox';
  tenant?: string;
  full_name: string;
  client_id: string | null;
  /** Reports-to: same client, acyclic. Drives portal "my staff" visibility. */
  manager_contact_id?: string | null;
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
  work_arrangement?: ContactWorkArrangement | null;
  /** Links to the client's locations, primary first; set by the loaders, not stored on the contact. */
  locations?: IContactLocation[];
  /** The primary link (or the only one), for list columns and picker rows. */
  primaryLocation?: Pick<IContactLocation, 'location_id' | 'location_name'> | null;
  created_at: string;
  updated_at: string;
  [key: string]: any; // Allow additional properties for database fields
}

/**
 * Input type for creating a new contact
 */
export interface CreateContactInput {
  contact_kind?: 'person' | 'shared_mailbox';
  full_name: string;
  email?: string;
  primary_email_canonical_type?: ContactEmailCanonicalType | null;
  primary_email_custom_type?: string | null;
  primary_email_custom_type_id?: string | null;
  additional_email_addresses?: ContactEmailAddressInput[];
  phone_numbers?: ContactPhoneNumberInput[];
  client_id?: string;
  /** null clears the manager on update; undefined leaves it unchanged. */
  manager_contact_id?: string | null;
  inbound_ticket_defaults_id?: string | null;
  role?: string;
  notes?: string;
  is_inactive?: boolean;
  work_arrangement?: ContactWorkArrangement | null;
  /** Omitted leaves links untouched; [] removes them all. */
  locations?: ContactLocationInput[];
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
  /** null clears the manager on update; undefined leaves it unchanged. */
  manager_contact_id?: string | null;
  inbound_ticket_defaults_id?: string | null;
  role?: string;
  notes?: string;
  is_inactive?: boolean;
  work_arrangement?: ContactWorkArrangement | null;
  /** Omitted leaves links untouched; [] removes them all. */
  locations?: ContactLocationInput[];
}
