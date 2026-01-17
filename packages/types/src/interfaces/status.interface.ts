import { TenantEntity } from ".";

export type ItemType = 'project' | 'ticket' | 'project_task' | 'interaction';

export interface IStatus extends TenantEntity {
  status_id: string;
  name: string;
  status_type: ItemType;
  item_type?: ItemType;
  is_closed: boolean;
  is_default?: boolean;
  order_number?: number;
  created_by?: string;
  standard_status_id?: string;
  is_custom?: boolean;
  created_at?: Date;
  updated_at?: Date;
  color?: string | null; // Hex color code (e.g., '#3B82F6')
  icon?: string | null; // Lucide icon name (e.g., 'Clipboard', 'PlayCircle')
}

export interface IStandardStatus extends TenantEntity {
  standard_status_id: string;
  name: string;
  item_type: ItemType;
  display_order: number;
  is_closed: boolean;
  is_default?: boolean;
}
