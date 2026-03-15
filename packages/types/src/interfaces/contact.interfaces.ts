import type { TenantEntity } from '.';
import type { ITaggable } from './tag.interfaces';

export const CONTACT_PHONE_CANONICAL_TYPES = ['work', 'mobile', 'home', 'fax', 'other'] as const;

export type ContactPhoneCanonicalType = typeof CONTACT_PHONE_CANONICAL_TYPES[number];

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

export interface ContactPhoneNumberInput {
  contact_phone_number_id?: string;
  phone_number: string;
  canonical_type?: ContactPhoneCanonicalType | null;
  custom_type?: string | null;
  is_default?: boolean;
  display_order?: number;
}

export interface IContact extends TenantEntity, ITaggable {
  contact_name_id: string;
  full_name: string;
  client_id: string | null;
  phone_numbers: IContactPhoneNumber[];
  default_phone_number?: string | null;
  default_phone_type?: string | null;
  email: string | null;
  role: string | null;
  notes: string | null;
  notes_document_id?: string | null;
  is_inactive: boolean | null;
  created_at: string;
  updated_at: string;

  avatarUrl?: string | null;
  is_client_admin?: boolean;
  portal_visibility_group_id?: string | null;

  [key: string]: any;
}

export interface ICSVColumnMapping {
  csvHeader: string;
  contactField: MappableField | null;
}

export interface ICSVPreviewData {
  headers: string[];
  rows: string[][];
}

export interface ICSVImportResult {
  success: boolean;
  message: string;
  record?: string[];
  contact?: IContact;
}

export interface ICSVValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  data: {
    [K in MappableField]?: string;
  };
}

export interface ICSVImportOptions {
  updateExisting: boolean;
  skipInvalid: boolean;
  dryRun: boolean;
}

export interface ImportContactResult {
  success: boolean;
  message: string;
  contact?: IContact;
  originalData: Record<string, any>;
}

export type MappableField =
  | 'full_name'
  | 'phone_number'
  | 'email'
  | 'client'
  | 'role'
  | 'notes'
  | 'tags';

/**
 * Input type for creating a new contact.
 */
export interface CreateContactInput {
  full_name: string;
  email?: string;
  phone_numbers?: ContactPhoneNumberInput[];
  client_id?: string;
  role?: string;
  notes?: string;
  is_inactive?: boolean;
}

/**
 * Input type for updating an existing contact.
 */
export interface UpdateContactInput {
  full_name?: string;
  email?: string;
  phone_numbers?: ContactPhoneNumberInput[];
  client_id?: string;
  role?: string;
  notes?: string;
  is_inactive?: boolean;
}
