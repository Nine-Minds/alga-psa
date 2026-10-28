import type { ISO8601String } from '../lib/temporal';
import type { ProjectMaterialBillingDestination } from './material.interfaces';
import { TenantEntity } from './index';

/**
 * Project staging (alga-2026-0002683 C6): equipment a project has reserved, picked and packed ahead of
 * installation. A staging line is never billable; installing a stock line creates the project material.
 */

/** `stock`: MSP stock (claims inventory). `client_asset` / `client_item`: client-provided, never stock. */
export type ProjectStagingLineKind = 'stock' | 'client_asset' | 'client_item';

/**
 * Stock lines: reserved (soft claim) -> staged (hard claim, physically picked) -> installed (consumed).
 * Client lines: received -> staged -> installed. Either may be released before install.
 */
export type ProjectStagingLineStatus = 'received' | 'reserved' | 'staged' | 'installed' | 'released';

export interface IProjectStagingLine extends TenantEntity {
  staging_line_id: string;
  project_id: string;
  task_id?: string | null;
  kind: ProjectStagingLineKind;
  status: ProjectStagingLineStatus;
  service_id?: string | null;
  unit_id?: string | null;
  reserved_location_id?: string | null;
  asset_id?: string | null;
  description?: string | null;
  quantity: number;
  /** Planned rate in minor units, copied to the project material at install. */
  rate: number;
  currency_code?: string | null;
  billing_destination?: ProjectMaterialBillingDestination | null;
  billing_schedule_entry_id?: string | null;
  project_material_id?: string | null;
  reserved_at?: ISO8601String | null;
  reserved_by?: string | null;
  staged_at?: ISO8601String | null;
  staged_by?: string | null;
  installed_at?: ISO8601String | null;
  installed_by?: string | null;
  released_at?: ISO8601String | null;
  released_by?: string | null;
  created_by?: string | null;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

export type StagingContainerStatus = 'open' | 'sealed';

export interface IStagingContainer extends TenantEntity {
  container_id: string;
  project_id: string;
  task_id?: string | null;
  /** Per-project box number, never reused. */
  sequence: number;
  name?: string | null;
  status: StagingContainerStatus;
  stock_location_id?: string | null;
  location_note?: string | null;
  notes?: string | null;
  sealed_at?: ISO8601String | null;
  sealed_by?: string | null;
  created_by?: string | null;
  deleted_at?: ISO8601String | null;
  deleted_by?: string | null;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

export interface IStagingContainerMember extends TenantEntity {
  member_id: string;
  container_id: string;
  staging_line_id: string;
  quantity: number;
  added_by?: string | null;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}
