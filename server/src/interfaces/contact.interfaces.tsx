import { TenantEntity } from '.';
import { ITaggable } from './tag.interfaces';
import { IContact as SharedIContact } from '@alga-psa/shared/interfaces/contact.interfaces';

// Extend the shared IContact interface with server-specific fields
export interface IContact extends SharedIContact, TenantEntity, ITaggable {
  // Override shared fields to match existing server expectations (non-nullable)
  phone_number: string;
  email: string;
  role: string;
  is_inactive: boolean;

  // Server-specific fields
  avatarUrl?: string | null;
  is_client_admin?: boolean;

  // Custom field values (UDFs) - stored in JSONB column
  properties?: Record<string, any> | null;
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
