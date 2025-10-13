import { TenantEntity } from './index';
import { ISO8601String } from '../types/types.d';

/**
 * Interface for a Contract
 * Represents a collection of contract lines (formerly contract lines) assignable to clients.
 */
export interface IContract extends TenantEntity {
  contract_id: string;
  contract_name: string;
  contract_description?: string;
  billing_frequency: string;
  is_active: boolean;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

/**
 * Interface for mapping contract lines to contracts
 * Represents the many-to-many relationship between contract lines and their parent contracts.
 */
export interface IContractLineMapping extends TenantEntity {
  contract_id: string;
  contract_line_id: string;
  display_order?: number;
  custom_rate?: number;
  created_at?: ISO8601String;
}

/**
 * Interface for associating contracts with clients
 * Represents the assignment of a contract to a client.
 */
export interface IClientContract extends TenantEntity {
  client_contract_id: string;
  client_id: string;
  contract_id: string;
  billing_frequency?: string;
  start_date: ISO8601String;
  end_date: ISO8601String | null;
  is_active: boolean;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

/**
 * Interface for contract pricing schedules
 * Represents time-based pricing changes for a contract
 */
export interface IContractPricingSchedule extends TenantEntity {
  schedule_id: string;
  bundle_id: string; // TODO: rename to contract_id once DB schema is updated
  effective_date: ISO8601String;
  end_date?: ISO8601String | null;
  duration_value?: number;
  duration_unit?: 'days' | 'weeks' | 'months' | 'years';
  custom_rate?: number;
  notes?: string;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
  created_by?: string;
  updated_by?: string;
}
