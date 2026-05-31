/**
 * Temporal activities for the appliance license issuance pipeline (C3).
 *
 * These activities form the exactly-once issuance pipeline triggered by a
 * Stripe checkout.session.completed webhook for a license order.
 * The C4 (alga-license) service holds the private key; we call it here.
 */

import { Context } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import { v4 as uuidv4 } from 'uuid';

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
  licenseExpiry: string; // ISO date string
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

  // Check for existing contract for this subscription
  const existing = await knex('client_contracts')
    .join('contracts', 'client_contracts.contract_id', 'contracts.contract_id')
    .where({
      'client_contracts.client_id': input.clientId,
      'client_contracts.tenant': input.tenant,
    })
    .whereRaw("contracts.contract_description LIKE ?", [`%stripe_sub:${input.stripeSubId}%`])
    .first('client_contracts.client_contract_id', 'contracts.contract_id');

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

  // Upsert a license contract_line (informational — tier + seats)
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
  }).onConflict().ignore();

  return { contractId, clientContractId };
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

  await knex('documents').insert({
    document_id: documentId,
    tenant: input.tenant,
    document_name: `Alga Appliance License — ${input.tier} (expires ${expDate})`,
    type_id: null,
    content: input.jwt,
    created_by: null, // system-generated
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });

  // Associate to client (so it shows in portal Documents)
  await knex('document_associations').insert({
    association_id: uuidv4(),
    tenant: input.tenant,
    document_id: documentId,
    entity_id: input.clientId,
    entity_type: 'client',
    created_by: null,
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
      created_by: null,
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
  const notes = input.transport.startsWith('connected')
    ? `License claim code: ${input.claimCode} (paste into /msp/licenses → Connect this appliance)`
    : `License JWT delivered. Paste into /msp/licenses → Enter license key. Expires: ${input.licenseExpiry}`;

  await knex('service_request_submissions')
    .where({ submission_id: input.submissionId, tenant: input.tenant })
    .update({
      workflow_execution_id: input.claimCode
        ? `license-issued-connected:${input.claimCode}`
        : `license-issued-airgap:${input.licenseExpiry}`,
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

  // Mark the contract terminated
  const knex = await getAdminConnection();
  await knex('client_contracts')
    .join('contracts', 'client_contracts.contract_id', 'contracts.contract_id')
    .where({
      'client_contracts.client_id': input.clientId,
      'client_contracts.tenant': input.tenant,
    })
    .whereRaw("contracts.contract_description LIKE ?", [`%stripe_sub:${input.stripeSubId}%`])
    .update({
      'client_contracts.is_active': false,
      'contracts.status': 'terminated',
      'client_contracts.updated_at': knex.fn.now(),
    });
}
