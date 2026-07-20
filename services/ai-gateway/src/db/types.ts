export type DeploymentType = 'hosted' | 'appliance';

export interface AiAccountRow {
  account_id: string;
  tenant_id: string;
  deployment_type: DeploymentType;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string;
  included_balance: string;
  topup_balance: string;
  grace_limit_credits: string;
  cycle_started_at: Date | null;
  low_balance_threshold: string;
  auto_topup_enabled: boolean;
  auto_topup_threshold_credits: string | null;
  auto_topup_pack_price_id: string | null;
  auto_topup_failure_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface PricingConfigRow {
  pricing_id: string;
  model_pattern: string;
  credits_per_1k_input_tokens: string;
  credits_per_1k_output_tokens: string;
  effective_from: Date;
  created_at: Date;
}

export interface AiUsageEventRow {
  usage_id: string;
  account_id: string;
  feature: string;
  model: string;
  provider: string;
  prompt_tokens: string;
  completion_tokens: string;
  total_tokens: string;
  credits_charged: string;
  request_id: string;
  duration_ms: string;
  created_at: Date;
}

export interface ConsentRecordRow {
  consent_id: string;
  account_id: string;
  granted_by: string;
  terms_version: string;
  granted_at: Date;
  revoked_at: Date | null;
  revoked_by: string | null;
}

export type LedgerBucket = 'included' | 'topup';
export type LedgerEntryType =
  | 'grant_included'
  | 'grant_topup'
  | 'usage_debit'
  | 'expiry'
  | 'adjustment';
