import { TenantEntity } from './index';
import { ISO8601String } from '@alga-psa/types';
import { IService } from './billing.interfaces';

export interface IUsageRecord extends TenantEntity {
  usage_id: string;
  client_id: string;
  service_id: string;
  usage_date: ISO8601String;
  quantity: number;
  tax_region?: string;
  client_name?: string; // Joined from clients table
  service_name?: string; // Joined from service_catalog table
  contract_line_id?: string;
}

export interface ICreateUsageRecord extends Pick<IUsageRecord, 'client_id' | 'service_id' | 'quantity' | 'usage_date'> {
  comments?: string;
  contract_line_id?: string;
}

export interface IUpdateUsageRecord extends Partial<ICreateUsageRecord> {
  usage_id: string;
  contract_line_id?: string;
}

export interface IUsageFilter {
  client_id?: string;
  service_id?: string;
  start_date?: ISO8601String;
  end_date?: ISO8601String;
}