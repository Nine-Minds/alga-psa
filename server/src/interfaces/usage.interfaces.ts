import { TenantEntity } from './index';
import { ISO8601String } from '../types/types.d';
import { IService } from './billing.interfaces';

export interface IUsageRecord extends TenantEntity {
  usage_id: string;
  company_id: string;
  service_id: string;
  usage_date: ISO8601String;
  quantity: number;
  tax_region?: string;
  company_name?: string; // Joined from companies table
  service_name?: string; // Joined from service_catalog table
  billing_plan_id?: string;
}

export interface ICreateUsageRecord extends Pick<IUsageRecord, 'company_id' | 'service_id' | 'quantity' | 'usage_date'> {
  comments?: string;
  billing_plan_id?: string;
}

export interface IUpdateUsageRecord extends Partial<ICreateUsageRecord> {
  usage_id: string;
  billing_plan_id?: string;
}

export interface IUsageFilter {
  company_id?: string;
  service_id?: string;
  start_date?: ISO8601String;
  end_date?: ISO8601String;
}