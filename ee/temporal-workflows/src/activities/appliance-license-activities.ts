/**
 * Temporal activities for the appliance license issuance pipeline (C3).
 *
 * These activities form the exactly-once issuance pipeline triggered by a
 * Stripe checkout.session.completed webhook for a license order.
 * The C4 (alga-license) service holds the private key; we call it here.
 */

import { Context } from '@temporalio/activity';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import { emailService } from '../services/email-service';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

const logger = () => Context.current().log;

// ── C4 client helpers ─────────────────────────────────────────────────────────

function c4BaseUrl(): string {
  const url = process.env.ALGA_LICENSE_SERVICE_URL;
  if (!url) throw new Error('ALGA_LICENSE_SERVICE_URL is not configured');
  return url.replace(/\/$/, '');
}

function c4ServiceSecret(): string {
  const secret = process.env.ALGA_LICENSE_SERVICE_SECRET;
  if (!secret) throw new Error('ALGA_LICENSE_SERVICE_SECRET is not configured');
  return secret;
}

async function c4Post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${c4BaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${c4ServiceSecret()}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`C4 ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ── Activity inputs/outputs ───────────────────────────────────────────────────

export interface SignApplianceLicenseInput {
  stripeSubId: string;
  customer: string;
  tier: 'pro' | 'premium';
  seats?: number;
  transport: 'connected' | 'airgap';
}

export interface SignApplianceLicenseResult {
  jwt: string;
  exp: number;
  sub: string;
}

export interface UpsertLicenseContractInput {
  tenant: string;
  clientId: string;
  tier: 'pro' | 'premium';
  seats?: number;
  transport: string;
  stripeSubId: string;
  exp: number; // unix seconds
}

export interface UpsertLicenseContractResult {
  contractId: string;
  clientContractId: string;
}

interface ExistingLicenseContractRow {
  client_contract_id: string;
  contract_id: string;
}

export interface StoreLicenseDocumentInput {
  tenant: string;
  clientId: string;
  contractId: string;
  jwt: string;
  tier: string;
  exp: number;
}

export interface StoreLicenseDocumentResult {
  documentId: string;
}

export interface MintClaimCodeInput {
  stripeSubId: string;
}

export interface MintClaimCodeResult {
  code: string;
  expiresAt: number;
}

export interface DeliverLicenseEmailInput {
  tenant: string;
  submissionId: string;
  transport: string;
  jwt: string;
  claimCode?: string;
  exp: number; // unix seconds — formatted to a date inside the activity
  tier: string;
}

export interface RevokeLicenseEntitlementInput {
  stripeSubId: string;
  tenant: string;
  clientId: string;
}

// ── Activities ────────────────────────────────────────────────────────────────

/** Call C4 /sign to get a signed license JWT. */
export async function signApplianceLicense(
  input: SignApplianceLicenseInput
): Promise<SignApplianceLicenseResult> {
  const log = logger();
  log.info('signApplianceLicense', { stripeSubId: input.stripeSubId, tier: input.tier });

  const result = await c4Post('/sign', {
    stripe_sub_id: input.stripeSubId,
    customer: input.customer,
    tier: input.tier,
    seats: input.seats,
    transport: input.transport,
  }) as SignApplianceLicenseResult;

  return result;
}

/** Upsert a client_contracts assignment + license contract_line. */
export async function upsertLicenseContract(
  input: UpsertLicenseContractInput
): Promise<UpsertLicenseContractResult> {
  const log = logger();
  log.info('upsertLicenseContract', { clientId: input.clientId, tier: input.tier });

  const knex = await getAdminConnection();
  const db = tenantDb(knex, input.tenant);

  // Check for existing contract for this subscription
  const existingQuery = db.table('client_contracts')
    .where({ 'client_contracts.client_id': input.clientId })
    .whereRaw("contracts.contract_description LIKE ?", [`%stripe_sub:${input.stripeSubId}%`]);
  db.tenantJoin(existingQuery, 'contracts', 'client_contracts.contract_id', 'contracts.contract_id');
  const existing = await existingQuery.first(
    'client_contracts.client_contract_id as client_contract_id',
    'contracts.contract_id as contract_id',
  ) as ExistingLicenseContractRow | undefined;

  const startDate = new Date();
  const endDate = new Date(input.exp * 1000);
  const isAirgap = input.transport === 'airgap-annual' || input.transport === 'airgap';
  const renewalMode = isAirgap ? 'manual' : 'auto';

  if (existing) {
    // Update end date + status on renewal
    await knex('client_contracts')
      .where({ client_contract_id: existing.client_contract_id, tenant: input.tenant })
      .update({
        end_date: endDate,
        renewal_mode: renewalMode,
        is_active: true,
        updated_at: knex.fn.now(),
      });
    return {
      contractId: existing.contract_id,
      clientContractId: existing.client_contract_id,
    };
  }

  // Create new contract + assignment
  const contractId = uuidv4();
  await knex('contracts').insert({
    contract_id: contractId,
    tenant: input.tenant,
    contract_name: `Alga Appliance License — ${input.tier}`,
    contract_description: `Appliance Enterprise license. tier:${input.tier} transport:${input.transport} stripe_sub:${input.stripeSubId}`,
    billing_frequency: isAirgap ? 'annually' : 'monthly',
    is_active: true,
    status: 'active',
    owner_client_id: input.clientId,
    is_template: false,
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });

  const clientContractId = uuidv4();
  await knex('client_contracts').insert({
    client_contract_id: clientContractId,
    tenant: input.tenant,
    client_id: input.clientId,
    contract_id: contractId,
    start_date: startDate,
    end_date: endDate,
    is_active: true,
    renewal_mode: renewalMode,
    renewal_term_months: isAirgap ? 12 : 1,
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });

  // Insert a license contract_line (informational — tier + seats)
  const lineId = uuidv4();
  await knex('contract_lines').insert({
    contract_line_id: lineId,
    tenant: input.tenant,
    contract_id: contractId,
    contract_line_name: `Enterprise ${input.tier} — ${input.seats ?? 'unlimited'} seats`,
    contract_line_type: 'Fixed',
    billing_frequency: isAirgap ? 'annually' : 'monthly',
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });

  return { contractId, clientContractId };
}

/**
 * Resolve a real user id to attribute system-created rows to.
 * The `documents` table requires non-null `user_id` and `created_by`, and there
 * is no dedicated service user — mirror the email-attachment background pattern:
 * prefer inbound_ticket_defaults.entered_by, else the tenant's first user.
 */
async function resolveSystemUserId(knex: Knex, tenant: string): Promise<string | null> {
  const inbound = await knex('inbound_ticket_defaults')
    .where({ tenant, is_active: true })
    .whereNotNull('entered_by')
    .orderBy('updated_at', 'desc')
    .first('entered_by')
    .catch(() => undefined);
  if (inbound?.entered_by) return inbound.entered_by as string;

  const user = await knex('users')
    .where({ tenant })
    .orderBy('created_at', 'asc')
    .first('user_id');
  return (user?.user_id as string) ?? null;
}

/** Store the signed JWT as a document attached to the client. */
export async function storeLicenseDocument(
  input: StoreLicenseDocumentInput
): Promise<StoreLicenseDocumentResult> {
  const log = logger();
  log.info('storeLicenseDocument', { clientId: input.clientId });

  const knex = await getAdminConnection();
  const documentId = uuidv4();
  const expDate = new Date(input.exp * 1000).toISOString().split('T')[0];

  const systemUserId = await resolveSystemUserId(knex, input.tenant);
  if (!systemUserId) {
    throw new Error(`No user available to attribute the license document (tenant ${input.tenant})`);
  }

  // documents requires user_id + created_by (real users); content is inline text;
  // the timestamp column is entered_at (there is no created_at on documents).
  await knex('documents').insert({
    document_id: documentId,
    tenant: input.tenant,
    document_name: `Alga Appliance License — ${input.tier} (expires ${expDate})`,
    type_id: null,
    user_id: systemUserId,
    created_by: systemUserId,
    content: input.jwt,
    entered_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });

  // Associate to client (so it shows in portal Documents). No created_by column.
  await knex('document_associations').insert({
    association_id: uuidv4(),
    tenant: input.tenant,
    document_id: documentId,
    entity_id: input.clientId,
    entity_type: 'client',
    created_at: knex.fn.now(),
  });

  // Also associate to contract (for bookkeeping)
  if (input.contractId) {
    await knex('document_associations').insert({
      association_id: uuidv4(),
      tenant: input.tenant,
      document_id: documentId,
      entity_id: input.contractId,
      entity_type: 'contract',
      created_at: knex.fn.now(),
    });
  }

  return { documentId };
}

/** Call C4 /claim-codes to mint a one-time claim code for connected transport. */
export async function mintClaimCode(
  input: MintClaimCodeInput
): Promise<MintClaimCodeResult> {
  const log = logger();
  log.info('mintClaimCode', { stripeSubId: input.stripeSubId });

  const result = await c4Post('/claim-codes', {
    stripe_sub_id: input.stripeSubId,
  }) as { code: string; expires_at: number };

  return { code: result.code, expiresAt: result.expires_at };
}

/** Send the license delivery email via the existing email activity pattern. */
export async function deliverLicenseEmail(
  input: DeliverLicenseEmailInput
): Promise<void> {
  const log = logger();
  log.info('deliverLicenseEmail', { submissionId: input.submissionId, transport: input.transport });

  // Record delivery on the submission
  const knex = await getAdminConnection();
  const licenseExpiry = new Date(input.exp * 1000).toISOString().split('T')[0];
  const notes = input.transport.startsWith('connected')
    ? `License claim code: ${input.claimCode} (paste into /msp/licenses → Connect this appliance)`
    : `License JWT delivered. Paste into /msp/licenses → Enter license key. Expires: ${licenseExpiry}`;

  await knex('service_request_submissions')
    .where({ submission_id: input.submissionId, tenant: input.tenant })
    .update({
      workflow_execution_id: input.claimCode
        ? `license-issued-connected:${input.claimCode}`
        : `license-issued-airgap:${licenseExpiry}`,
      updated_at: knex.fn.now(),
    });

  log.info('License delivery notes recorded', { submissionId: input.submissionId, notes });
  // TODO: wire to the actual email-activities once email template is designed.
}

/** Call C4 /revoke to soft-revoke an entitlement and mark the contract terminated. */
export async function revokeLicenseEntitlement(
  input: RevokeLicenseEntitlementInput
): Promise<void> {
  const log = logger();
  log.info('revokeLicenseEntitlement', { stripeSubId: input.stripeSubId });

  // Revoke in C4
  await c4Post('/revoke', { stripe_sub_id: input.stripeSubId });

  // Mark the contract terminated. PG can't UPDATE two tables at once, so resolve
  // the matching contract(s) first, then update each table separately.
  const knex = await getAdminConnection();
  const matches = await knex('contracts')
    .where({ tenant: input.tenant, owner_client_id: input.clientId })
    .whereRaw('contract_description LIKE ?', [`%stripe_sub:${input.stripeSubId}%`])
    .select('contract_id');
  const contractIds = matches.map((m: { contract_id: string }) => m.contract_id);
  if (contractIds.length === 0) return;

  await knex('contracts')
    .where({ tenant: input.tenant })
    .whereIn('contract_id', contractIds)
    .update({ status: 'terminated', updated_at: knex.fn.now() });

  await knex('client_contracts')
    .where({ tenant: input.tenant })
    .whereIn('contract_id', contractIds)
    .update({ is_active: false, updated_at: knex.fn.now() });
}

// ── Appliance Essentials (free) registration ────────────────────────────────
//
// The free Essentials order has no Stripe entitlement: it mints a registry
// tenant + a one-time install code and emails the operator. nm-store starts the
// workflow; these activities run on this worker, which already holds the
// alga-license service auth (c4Post) and the shared email service — so a
// transient Postgres 53300 on the mint is retried by Temporal, not lost.

export interface RegisterEssentialsTenantInput {
  submissionId: string;
  companyName: string;
  contactName?: string;
  contactEmail: string;
}

export interface RegisterEssentialsTenantResult {
  tenantId: string;
  installCode: string;
}

export interface DeliverEssentialsInstallEmailInput {
  to: string;
  companyName: string;
  installCode: string;
  downloadUrl: string;
}

/** Mint a registry tenant + one-time install code for the free Essentials edition. */
export async function registerEssentialsTenant(
  input: RegisterEssentialsTenantInput,
): Promise<RegisterEssentialsTenantResult> {
  const log = logger();
  log.info('registerEssentialsTenant', { submissionId: input.submissionId });

  const res = (await c4Post('/register-tenant', {
    company_name: input.companyName,
    contact_email: input.contactEmail,
    contact_name: input.contactName,
    edition: 'essentials',
  })) as { tenant_id: string; install_code: string };

  return { tenantId: res.tenant_id, installCode: res.install_code };
}

/** Email the operator their install code + ISO download link (shared email service). */
export async function deliverEssentialsInstallEmail(
  input: DeliverEssentialsInstallEmailInput,
): Promise<void> {
  const log = logger();
  log.info('deliverEssentialsInstallEmail', { to: input.to });

  const svc = await emailService;
  await svc.sendEmail({
    to: input.to,
    subject: 'Your AlgaPSA appliance install code',
    html: renderEssentialsInstallEmail(input),
    metadata: { kind: 'appliance-essentials-install-code' },
  });
}

function escapeApplianceHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

function renderEssentialsInstallEmail(input: DeliverEssentialsInstallEmailInput): string {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#111">
      <h2>Your AlgaPSA appliance is ready to install</h2>
      <p>Thanks for registering <strong>${escapeApplianceHtml(input.companyName)}</strong> for an on-prem AlgaPSA appliance (Essentials).</p>
      <p>Enter this <strong>install code</strong> on the appliance setup screen. It binds the appliance to your account:</p>
      <p style="font-family:monospace;font-size:24px;letter-spacing:0.15em;background:#f3f4f6;padding:16px 20px;border-radius:8px;text-align:center">${escapeApplianceHtml(input.installCode)}</p>
      <p><a href="${input.downloadUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Download the appliance ISO</a></p>
      <p style="color:#6b7280;font-size:13px">The install code is single-use. If you reinstall, re-issue a fresh one from your account.</p>
    </div>`;
}
