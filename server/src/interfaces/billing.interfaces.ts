import { TenantEntity } from './index';
import { ISO8601String } from '../types/types.d';

export interface IBillingPeriod extends TenantEntity {
  startDate: ISO8601String;
  endDate: ISO8601String;
}

export interface IFixedPriceCharge extends IBillingCharge, TenantEntity {
  serviceId: string;
  serviceName: string;
  quantity: number;
  rate: number;
  total: number;
  type: 'fixed';
}

export interface ITimeBasedCharge extends IBillingCharge, TenantEntity {
  serviceId: string;
  serviceName: string;
  userId: string;
  duration: number;
  rate: number;
  total: number;
  type: 'time';
  entryId: string; // Added field for source time entry ID
}

export interface IUsageBasedCharge extends IBillingCharge, TenantEntity {
  serviceId: string;
  serviceName: string;
  quantity: number;
  rate: number;
  total: number;
  type: 'usage';
  usageId: string; // Added field for source usage record ID
}

type ChargeType = 'fixed' | 'time' | 'usage' | 'bucket';

export interface IBillingCharge extends TenantEntity {
  type: ChargeType;
  serviceId?: string;
  serviceName: string;
  rate: number;
  total: number;
  quantity?: number;
  duration?: number;
  userId?: string;
  tax_amount: number;
  tax_rate: number;
  tax_region?: string;
}

export interface IDiscount extends TenantEntity {
  discount_id: string;
  discount_name: string;
  discount_type: 'percentage' | 'fixed';
  value: number;
  amount?: number;
}

export interface IAdjustment extends TenantEntity {
  description: string;
  amount: number;
}

export interface IBillingResult extends TenantEntity {
  charges: IBillingCharge[];
  totalAmount: number;
  discounts: IDiscount[];
  adjustments: IAdjustment[];
  finalAmount: number;
}

export interface ICompanyBillingPlan extends TenantEntity {
  company_billing_plan_id: string;
  company_id: string;
  plan_id: string;
  service_category?: string;
  start_date: ISO8601String;
  end_date: ISO8601String | null;
  is_active: boolean;
  custom_rate?: number;
  // Added fields from join with billing_plans
  plan_name?: string;
  billing_frequency?: string;
}

export interface ICompanyBillingCycle extends TenantEntity {
  billing_cycle_id?: string;
  company_id: string;
  billing_cycle: string;
  effective_date: ISO8601String;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
  tenant: string;
}

export interface IServiceCategory extends TenantEntity {
  category_id: string;
  category_name: string;
  description?: string;
}

export type ServiceType = 'Fixed' | 'Time' | 'Usage';

export interface IService extends TenantEntity {
  service_id: string;
  service_name: string;
  service_type: ServiceType;
  default_rate: number;
  category_id: string;
  unit_of_measure: string;    
  is_taxable?: boolean;
  tax_region?: string;    
}

export interface IBillingPlan extends TenantEntity {
  plan_id?: string;
  plan_name: string;
  billing_frequency: string;
  is_custom: boolean;
  service_category?: string;
  plan_type: 'fixed' | 'time-based' | 'usage-based' | 'bucket';
}

export interface IPlanService extends TenantEntity {
  plan_id: string;
  service_id: string;
  quantity?: number;
  custom_rate?: number;
}

export interface IBucketPlan extends TenantEntity {
  bucket_plan_id: string;
  plan_id: string;
  total_hours: number;
  billing_period: string;
  overage_rate: number;
}

export interface IBucketUsage extends TenantEntity {
  usage_id: string;
  bucket_plan_id: string;
  company_id: string;
  period_start: ISO8601String;
  period_end: ISO8601String;
  hours_used: number;
  overage_hours: number;
  service_catalog_id: string;
}

export interface PaymentMethod extends TenantEntity {
  payment_method_id: string;
  company_id: string;
  type: 'credit_card' | 'bank_account';
  last4: string;
  exp_month?: string;
  exp_year?: string;
  is_default: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface IBucketCharge extends IBillingCharge, TenantEntity {
  type: 'bucket';
  hoursUsed: number;
  overageHours: number;
  overageRate: number;
  service_catalog_id: string;
}

export type BillingCycleType = 'weekly' | 'bi-weekly' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually';

export type TransactionType = 
  | 'credit_application'
  | 'credit_issuance'
  | 'credit_adjustment'
  | 'credit_expiration'
  | 'credit_transfer'
  | 'payment'
  | 'partial_payment'
  | 'prepayment'
  | 'payment_reversal'
  | 'payment_failed'
  | 'invoice_generated'
  | 'invoice_adjustment'
  | 'invoice_cancelled'
  | 'late_fee'
  | 'early_payment_discount'
  | 'refund_full'
  | 'refund_partial'
  | 'refund_reversal'
  | 'service_credit'
  | 'price_adjustment'
  | 'service_adjustment'
  | 'billing_cycle_adjustment'
  | 'currency_adjustment'
  | 'tax_adjustment';

export interface IBillingCycleInvoiceRequest {
  billing_cycle_id: string;
}

export interface ITransaction extends TenantEntity {
  transaction_id: string;
  company_id: string;
  invoice_id?: string;
  amount: number;
  type: TransactionType;
  status?: 'pending' | 'completed' | 'failed';
  parent_transaction_id?: string;
  description?: string;
  created_at: ISO8601String;
  reference_number?: string;
  metadata?: Record<string, any>;
  balance_after: number;
}

export interface ITaxRate extends TenantEntity {
  tax_rate_id?: string;
  region?: string;
  tax_percentage: number;
  description?: string;
  start_date: string;
  end_date?: string | null;
}

export interface ICompanyTaxRate extends TenantEntity {
  company_tax_rate_id?: string;
  company_id: string;
  tax_rate_id: string;
}
