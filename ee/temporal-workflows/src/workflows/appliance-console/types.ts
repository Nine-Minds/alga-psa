/**
 * Inputs and results for the Appliance Console operator-action workflows.
 *
 * Mirrors ee/server/src/lib/applianceConsole/actionInputs.ts (the trigger
 * routes build these); duplicated because the worker package does not resolve
 * @ee imports. Keep both in sync.
 */

export type ApplianceEditionInput = 'essentials' | 'pro';

export interface OperatorMeta {
  userId: string;
  userEmail: string | null;
}

export interface BaseArgs {
  auditLogId: string;
  operator: OperatorMeta;
  reason: string | null;
}

export interface CreateTenantArgs extends BaseArgs {
  companyName: string;
  contactName: string | null;
  contactEmail: string;
  edition: ApplianceEditionInput;
  productCode: 'psa' | 'algadesk';
  seats: number | null;
  stripeSubId: string | null;
  comp: { endsAt: number; note: string } | null;
}

export interface CreateTenantResult {
  tenant_id: string;
  install_code: string;
  download_url: string;
  expires_at: number;
  email_sent: boolean;
  /** Present when the tenant was created with a comp grant. */
  comp?: { jwt: string; exp: number; license_sub: string; email_sent: boolean };
}

export interface UpdateTenantArgs extends BaseArgs {
  tenantId: string;
  companyName?: string;
  contactName?: string | null;
  contactEmail?: string;
}

export interface ReissueInstallCodeArgs extends BaseArgs {
  tenantId: string;
}

export interface ReissueInstallCodeResult {
  install_code: string;
  download_url: string;
  expires_at: number;
  email_sent: boolean;
}

export interface ReissueActivationCodeArgs extends BaseArgs {
  tenantId: string;
}

export interface ReissueActivationCodeResult {
  code: string;
  expires_at: number;
  email_sent: boolean;
}

export interface AirgapKeyArgs extends BaseArgs {
  tenantId: string;
}

export interface AirgapKeyResult {
  jwt: string;
  exp: number;
  email_sent: boolean;
}

export interface ExtendProArgs extends BaseArgs {
  tenantId: string;
  endsAt: number;
  seats: number | null;
}

export interface ExtendProResult {
  jwt: string;
  exp: number;
  license_sub: string;
  email_sent: boolean;
}

export type EntitlementChangeMode = 'comp' | 'billed';
export type ProrationBehavior = 'create_prorations' | 'none';

export interface ChangeEntitlementArgs extends BaseArgs {
  tenantId: string;
  mode: EntitlementChangeMode;
  /** null = unlimited (comp mode only). */
  seats: number | null;
  proration: ProrationBehavior;
}

export interface ChangeEntitlementResult {
  mode: EntitlementChangeMode;
  seats: number | null;
  stripe_updated: boolean;
}

export interface SetStatusArgs extends BaseArgs {
  tenantId: string;
  status: 'active' | 'suspended' | 'cancelled';
}

export interface SetStatusResult {
  status: 'active' | 'suspended' | 'cancelled';
  email_sent: boolean;
}

export interface RevokeArgs extends BaseArgs {
  tenantId: string;
  hard: boolean;
}

export interface RevokeApplianceArgs extends BaseArgs {
  tenantId: string;
  applianceId: string;
}

export interface RevokeApplianceResult {
  appliance_id: string;
  revoked: true;
}

export interface RevokeResult {
  revoked: true;
  hard: boolean;
  appliances_revoked: number;
}

export type PauseCollectionBehavior = 'void' | 'keep_as_draft' | 'mark_uncollectible';

export interface BillingPauseArgs extends BaseArgs {
  tenantId: string;
  resumesAt: number | null;
  behavior: PauseCollectionBehavior;
}

export interface BillingResumeArgs extends BaseArgs {
  tenantId: string;
}

export interface BillingPauseResult {
  paused: boolean;
  resumes_at: number | null;
}

export interface UpdateTenantResult {
  tenant: {
    tenant_id: string;
    company_name: string;
    contact_name: string | null;
    contact_email: string;
  };
}
