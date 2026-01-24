import type { TenantEntity } from '.';
import type { ITaggable } from './tag.interfaces';

export interface IContact extends TenantEntity, ITaggable {
  contact_name_id: string;
  full_name: string;
  client_id: string | null;
  phone_number: string;
  email: string;
  role: string;
  notes: string | null;
  notes_document_id?: string | null;
  is_inactive: boolean;
  created_at: string;
  updated_at: string;

  avatarUrl?: string | null;
  is_client_admin?: boolean;

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
  phone_number?: string;
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
  phone_number?: string;
  client_id?: string;
  role?: string;
  notes?: string;
  is_inactive?: boolean;
}
