import { TenantEntity } from '.';
import { ITaggable } from './tag.interfaces';
export interface IContact extends TenantEntity, ITaggable {
  contact_name_id: string;
  full_name: string;
  company_id: string | null;
  phone_number: string;
  email: string;
  role: string;
  date_of_birth?: string;
  created_at: string;
  updated_at: string;
  is_inactive: boolean;
  notes?: string;
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
  | 'date_of_birth'
  | 'company_name'
  | 'role'
  | 'notes'
  | 'tags';
