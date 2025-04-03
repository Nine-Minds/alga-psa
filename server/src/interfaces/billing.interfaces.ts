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

type ChargeType = 'fixed' | 'time' | 'usage' | 'bucket' | 'product' | 'license';
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
  is_taxable?: boolean;
  company_bundle_id?: string; // Reference to the company plan bundle
  bundle_name?: string; // Name of the bundle
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
  company_bundle_id?: string; // Reference to the company plan bundle
  // Added fields from join with billing_plans
  plan_name?: string;
  billing_frequency?: string;
}

export interface ICompanyBillingCycle extends TenantEntity {
  billing_cycle_id?: string;
  company_id: string;
  billing_cycle: string;
  effective_date: ISO8601String;
  period_start_date: ISO8601String;
  period_end_date: ISO8601String; // Exclusive - equals start of next period
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
  tenant: string;
}

export interface IServiceCategory extends TenantEntity {
  category_id: string | null;
  category_name: string;
  description?: string;
}

export interface IProductCharge extends IBillingCharge, TenantEntity {
  serviceId: string;
  serviceName: string;
  quantity: number;
  rate: number;
  total: number;
  type: 'product';
}

export interface ILicenseCharge extends IBillingCharge, TenantEntity {
  serviceId: string;
  serviceName: string;
  quantity: number;
  rate: number;
  total: number;
  type: 'license';
  period_start?: ISO8601String;
  period_end?: ISO8601String;
}

export interface IService extends TenantEntity {
  service_id: string;
  service_name: string;
  service_type_id: string; // Changed from service_type: string
  service_type_billing_method?: 'fixed' | 'per_unit' | null; // Billing method from the standard type (optional, allow null)
  billing_method: 'fixed' | 'per_unit' | null; // Billing method specific to this service instance (Allow null temporarily)
  default_rate: number;
  category_id: string | null;
  unit_of_measure: string;
  is_taxable?: boolean;
  tax_region?: string | null;
  sku?: string;               // For products
  inventory_count?: number;   // For products
  seat_limit?: number;        // For licenses
  license_term?: string;      // For licenses (e.g., 'monthly', 'annual')
}

// New interface for standard service types (cross-tenant)
export interface IStandardServiceType {
  id: string;
  name: string;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

// New interface for tenant-specific service types
export interface IServiceType extends TenantEntity {
  id: string;
  name: string;
  standard_service_type_id?: string | null; // Link to standard type if applicable
  is_active: boolean;
  description?: string | null;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface IBillingPlan extends TenantEntity {
  plan_id?: string;
  plan_name: string;
  billing_frequency: string;
  is_custom: boolean;
  service_category?: string;
  plan_type: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket';
  // Add potentially existing hourly fields (to be deprecated for Hourly type)
  hourly_rate?: number | null;
  minimum_billable_time?: number | null;
  round_up_to_nearest?: number | null;
  // Add other plan-wide fields that might exist (like overtime, etc.)
  enable_overtime?: boolean | null;
  overtime_rate?: number | null;
  overtime_threshold?: number | null; // Assuming threshold is numeric
  enable_after_hours_rate?: boolean | null;
  after_hours_multiplier?: number | null;
  // user_type_rates might be handled differently (e.g., separate table/JSON)
  // If it's a JSONB column in billing_plans, it could be:
  // user_type_rates?: Record<string, number> | null;
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
  // bucket_plan_id: string; // Removed as it's deprecated
  plan_id?: string; // Added plan_id, assuming it might be needed here now
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

export interface IProductCharge extends IBillingCharge, TenantEntity {
  type: 'product';
  serviceId: string;
  serviceName: string;
  quantity: number;
  rate: number;
  total: number;
}

export interface ILicenseCharge extends IBillingCharge, TenantEntity {
  type: 'license';
  serviceId: string;
  serviceName: string;
  quantity: number;
  rate: number;
  total: number;
  period_start?: ISO8601String;
  period_end?: ISO8601String;
}

export type BillingCycleType = 'weekly' | 'bi-weekly' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually';

export type TransactionType =
  | 'credit_application'
  | 'credit_issuance'
  | 'credit_adjustment'
  | 'credit_expiration'
  | 'credit_transfer'
  | 'credit_issuance_from_negative_invoice'
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
  expiration_date?: ISO8601String;
  related_transaction_id?: string;
}

export interface ICreditTracking extends TenantEntity {
  credit_id: string;
  tenant: string;
  company_id: string;
  transaction_id: string;
  amount: number;
  remaining_amount: number;
  created_at: ISO8601String;
  expiration_date?: ISO8601String;
  is_expired: boolean;
  updated_at?: ISO8601String;
}

export interface ICreditExpirationSettings {
  enable_credit_expiration: boolean;
  credit_expiration_days?: number;
  credit_expiration_notification_days?: number[];
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

export interface IDefaultBillingSettings extends TenantEntity {
  zero_dollar_invoice_handling: 'normal' | 'finalized';
  suppress_zero_dollar_invoices: boolean;
  enable_credit_expiration: boolean;
  credit_expiration_days: number;
  credit_expiration_notification_days: number[];
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface ICompanyBillingSettings extends TenantEntity {
  company_id: string;
  zero_dollar_invoice_handling: 'normal' | 'finalized';
  suppress_zero_dollar_invoices: boolean;
  enable_credit_expiration?: boolean;
  credit_expiration_days?: number;
  credit_expiration_notification_days?: number[];
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export type ReconciliationStatus = 'open' | 'in_review' | 'resolved';

export interface ICreditReconciliationReport extends TenantEntity {
  report_id: string;
  company_id: string;
  expected_balance: number;
  actual_balance: number;
  difference: number;
  detection_date: ISO8601String;
  status: ReconciliationStatus;
  resolution_date?: ISO8601String;
  resolution_user?: string;
  resolution_notes?: string;
  resolution_transaction_id?: string;
  created_at: ISO8601String;
  updated_at: ISO8601String;
  metadata?: Record<string, any>; // For storing additional information about the reconciliation issue
}
