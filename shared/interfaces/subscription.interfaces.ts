import { ISO8601String } from '../types/temporal';

/**
 * Base tenant entity interface
 */
export interface TenantEntity {
  tenant: string;
}

/**
 * Database entity interfaces - match the database schema
 */

export interface IStripeCustomer extends TenantEntity {
  stripe_customer_id: string;
  stripe_customer_external_id: string;
  billing_tenant: string | null;
  email: string;
  name: string | null;
  metadata: Record<string, any> | null;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface IStripeProduct extends TenantEntity {
  stripe_product_id: string;
  stripe_product_external_id: string;
  billing_tenant: string | null;
  name: string;
  description: string | null;
  product_type: 'license' | 'service' | 'addon';
  is_active: boolean;
  metadata: Record<string, any> | null;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface IStripePrice extends TenantEntity {
  stripe_price_id: string;
  stripe_price_external_id: string;
  stripe_product_id: string;
  unit_amount: number; // in cents
  currency: string;
  recurring_interval: 'month' | 'year' | null;
  recurring_interval_count: number;
  is_active: boolean;
  metadata: Record<string, any> | null;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete' | 'incomplete_expired' | 'unpaid';

export interface IStripeSubscription extends TenantEntity {
  stripe_subscription_id: string;
  stripe_subscription_external_id: string;
  stripe_subscription_item_id: string | null;
  stripe_customer_id: string;
  stripe_price_id: string;
  status: SubscriptionStatus;
  quantity: number;
  current_period_start: ISO8601String | null;
  current_period_end: ISO8601String | null;
  cancel_at: ISO8601String | null;
  canceled_at: ISO8601String | null;
  metadata: Record<string, any> | null;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface IStripeWebhookEvent extends TenantEntity {
  stripe_event_id: string;
  event_type: string;
  event_data: Record<string, any>;
  processed: boolean;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  processing_error: string | null;
  processed_at: ISO8601String | null;
  created_at: ISO8601String;
}

/**
 * UI/API interfaces - used by components and server actions
 */

export interface ILicenseInfo {
  total_licenses: number | null; // null means unlimited
  active_licenses: number;
  available_licenses: number | null; // null means unlimited
  plan_name: string;
  price_per_license: number; // in dollars
}

export interface IPaymentMethod {
  card_brand: string;
  card_last4: string;
  card_exp_month: number;
  card_exp_year: number;
  billing_email: string;
}

export interface ISubscriptionInfo {
  subscription_id: string;
  status: SubscriptionStatus;
  current_period_start: ISO8601String;
  current_period_end: ISO8601String;
  next_billing_date: ISO8601String;
  monthly_amount: number; // in dollars
  quantity: number;
  cancel_at: ISO8601String | null;
  canceled_at: ISO8601String | null;
}

export interface IInvoiceInfo {
  invoice_id: string;
  invoice_number: string | null;
  period_label: string; // e.g., "October 2024"
  paid_at: ISO8601String | null;
  amount: number; // in dollars
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  invoice_pdf_url: string | null;
}

export interface IPricingInfo {
  price_id: string;
  unit_amount: number; // in dollars
  currency: string;
  interval: 'month' | 'year';
  interval_count: number;
}

export interface IScheduledLicenseChange {
  current_quantity: number;
  scheduled_quantity: number;
  effective_date: ISO8601String;
  current_monthly_cost: number; // in dollars
  scheduled_monthly_cost: number; // in dollars
  monthly_savings: number; // in dollars (can be negative for increases)
}

/**
 * Composite interfaces for the Account Management page
 */

export interface IAccountManagementData {
  license: ILicenseInfo;
  payment: IPaymentMethod | null;
  subscription: ISubscriptionInfo | null;
  pricing: IPricingInfo;
  recent_invoices: IInvoiceInfo[];
}

/**
 * Server action response types
 */

export interface IGetSubscriptionInfoResponse {
  success: boolean;
  data?: ISubscriptionInfo;
  error?: string;
}

export interface IGetPaymentMethodResponse {
  success: boolean;
  data?: IPaymentMethod;
  error?: string;
}

export interface IGetInvoicesResponse {
  success: boolean;
  data?: IInvoiceInfo[];
  error?: string;
}

export interface IGetPricingInfoResponse {
  success: boolean;
  data?: IPricingInfo;
  error?: string;
}

export interface IUpdatePaymentMethodResponse {
  success: boolean;
  data?: {
    portal_url: string; // Stripe Customer Portal URL
  };
  error?: string;
}

export interface ICancelSubscriptionResponse {
  success: boolean;
  data?: {
    subscription_id: string;
    cancel_at: ISO8601String;
  };
  error?: string;
}
