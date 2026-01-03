import { ISO8601String } from '../types/types.d';
import { TenantEntity } from './index';

export interface ITicketMaterial extends TenantEntity {
  ticket_material_id: string;
  ticket_id: string;
  client_id: string;
  service_id: string;
  service_name?: string;
  sku?: string | null;
  quantity: number;
  rate: number; // cents
  currency_code: string;
  description?: string | null;
  is_billed: boolean;
  billed_invoice_id?: string | null;
  billed_at?: ISO8601String | null;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

export interface IProjectMaterial extends TenantEntity {
  project_material_id: string;
  project_id: string;
  client_id: string;
  service_id: string;
  service_name?: string;
  sku?: string | null;
  quantity: number;
  rate: number; // cents
  currency_code: string;
  description?: string | null;
  is_billed: boolean;
  billed_invoice_id?: string | null;
  billed_at?: ISO8601String | null;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

