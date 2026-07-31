import type { ISO8601String } from '../lib/temporal';
import { TenantEntity } from './index';

export type ProjectMaterialBillingDestination =
  | 'next_project_invoice'
  | 'schedule_entry'
  | 'separate'
  | 'project_completion'
  | 'on_hold';

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
  billing_destination: ProjectMaterialBillingDestination;
  billing_schedule_entry_id?: string | null;
  /** Read-only catalog context; never persisted on the material row. */
  catalog_unit_cost?: number | null;
  catalog_cost_currency?: string | null;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}
