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
  tier: 'pro';
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
  tier: 'pro';
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
    await db.table('client_contracts')
      .where({ client_contract_id: existing.client_contract_id })
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
  await db.table('contracts').insert({
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
  await db.table('client_contracts').insert({
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
  await db.table('contract_lines').insert({
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
  const db = tenantDb(knex, tenant);
  const inbound = await db.table('inbound_ticket_defaults')
    .where({ is_active: true })
    .whereNotNull('entered_by')
    .orderBy('updated_at', 'desc')
    .first('entered_by')
    .catch(() => undefined);
  if (inbound?.entered_by) return inbound.entered_by as string;

  const user = await db.table('users')
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
  const db = tenantDb(knex, input.tenant);
  const documentId = uuidv4();
  const expDate = new Date(input.exp * 1000).toISOString().split('T')[0];

  const systemUserId = await resolveSystemUserId(knex, input.tenant);
  if (!systemUserId) {
    throw new Error(`No user available to attribute the license document (tenant ${input.tenant})`);
  }

  // documents requires user_id + created_by (real users); content is inline text;
  // the timestamp column is entered_at (there is no created_at on documents).
  await db.table('documents').insert({
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
  await db.table('document_associations').insert({
    association_id: uuidv4(),
    tenant: input.tenant,
    document_id: documentId,
    entity_id: input.clientId,
    entity_type: 'client',
    created_at: knex.fn.now(),
  });

  // Also associate to contract (for bookkeeping)
  if (input.contractId) {
    await db.table('document_associations').insert({
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
  const db = tenantDb(knex, input.tenant);
  const licenseExpiry = new Date(input.exp * 1000).toISOString().split('T')[0];
  const notes = input.transport.startsWith('connected')
    ? `License claim code: ${input.claimCode} (paste into /msp/licenses → Connect this appliance)`
    : `License JWT delivered. Paste into /msp/licenses → Enter license key. Expires: ${licenseExpiry}`;

  await db.table('service_request_submissions')
    .where({ submission_id: input.submissionId })
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
  const db = tenantDb(knex, input.tenant);
  const matches = await db.table('contracts')
    .where({ owner_client_id: input.clientId })
    .whereRaw('contract_description LIKE ?', [`%stripe_sub:${input.stripeSubId}%`])
    .select('contract_id');
  const contractIds = matches.map((m: { contract_id: string }) => m.contract_id);
  if (contractIds.length === 0) return;

  await db.table('contracts')
    .whereIn('contract_id', contractIds)
    .update({ status: 'terminated', updated_at: knex.fn.now() });

  await db.table('client_contracts')
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

/** Appliance setup walkthrough, linked from the install-code email. */
const APPLIANCE_SETUP_VIDEO_URL = 'https://youtu.be/-YtaT2OvoIQ';

/** Absolute site base for links that leave the inbox. */
function applianceSiteBaseUrl(): string {
  return (process.env.NM_STORE_BASE_URL || 'https://www.nineminds.com').replace(/\/$/, '');
}

const POPPINS = "'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const INTER = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

/**
 * Kept deliberately in step with nm-store's `installCodeEmailHtml`
 * (packages/nm-store/src/lib/appliance/applianceRegistration.ts) — this renders
 * the free Essentials path, that one renders paid + re-issue. Edit both together.
 *
 * Shell (purple band, white card, #faf8ff callouts, dark footer) mirrors the
 * tenant welcome email in email-activities.ts so the two read as one family.
 */
function renderEssentialsInstallEmail(input: DeliverEssentialsInstallEmailInput): string {
  const base = applianceSiteBaseUrl();
  const videoUrl = process.env.APPLIANCE_SETUP_VIDEO_URL || APPLIANCE_SETUP_VIDEO_URL;
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0;padding:0;background-color:#f8fafc;font-family:${INTER};">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" bgcolor="#f8fafc" style="border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" bgcolor="#ffffff" style="width:600px;max-width:600px;border-collapse:separate;border-spacing:0;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.07);">

            <tr>
              <td align="center" bgcolor="#8a4dea" style="background:linear-gradient(135deg,#8a4dea 0%,#a366f0 100%);background-color:#8a4dea;padding:40px 24px;text-align:center;border-radius:12px 12px 0 0;">
                <h1 style="font-family:${POPPINS};font-weight:700;font-size:28px;color:#ffffff;margin:0 0 8px 0;line-height:1.2;">Your AlgaPSA appliance is ready to install</h1>
                <p style="font-family:${INTER};font-size:16px;color:#ffffff;margin:0;opacity:0.95;">${escapeApplianceHtml(input.companyName)} &middot; Essentials edition</p>
              </td>
            </tr>

            <tr>
              <td bgcolor="#ffffff" style="background-color:#ffffff;padding:40px 32px;">

                <h2 style="color:#0f172a;font-family:${POPPINS};font-size:22px;font-weight:600;margin:0 0 12px 0;line-height:1.3;">Your install code</h2>
                <p style="color:#334155;font-family:${INTER};line-height:1.6;font-size:16px;margin:0 0 20px 0;">You enter this in the appliance setup wizard. It binds the appliance to your registration.</p>

                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:separate;margin:0 0 32px 0;">
                  <tr>
                    <td bgcolor="#faf8ff" align="center" style="background-color:#faf8ff;border:1px solid #e9e5f5;border-left:4px solid #8a4dea;border-radius:8px;padding:24px;text-align:center;">
                      <p style="font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:26px;font-weight:600;letter-spacing:0.15em;color:#0f172a;margin:0;">${escapeApplianceHtml(input.installCode)}</p>
                      <p style="color:#64748b;font-family:${INTER};font-size:13px;line-height:1.6;margin:12px 0 0 0;">Single-use, and valid for <b style="color:#334155;">30 days</b> &mdash; install whenever you are ready.</p>
                    </td>
                  </tr>
                </table>

                <h3 style="color:#0f172a;font-family:${POPPINS};font-size:18px;font-weight:600;margin:0 0 16px 0;">Installing, in three steps</h3>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 8px 0;">
                  <tr>
                    <td style="color:#334155;font-family:${INTER};padding-bottom:12px;line-height:1.6;font-size:15px;"><b style="color:#8a4dea;">1.</b> <b style="color:#0f172a;font-weight:600;">Download the appliance ISO</b> &mdash; the button below.</td>
                  </tr>
                  <tr>
                    <td style="color:#334155;font-family:${INTER};padding-bottom:12px;line-height:1.6;font-size:15px;"><b style="color:#8a4dea;">2.</b> <a href="${base}/documentation/installing-the-appliance-os" style="color:#8a4dea;text-decoration:underline;">Install the operating system</a> on your hardware or VM.</td>
                  </tr>
                  <tr>
                    <td style="color:#334155;font-family:${INTER};padding-bottom:12px;line-height:1.6;font-size:15px;"><b style="color:#8a4dea;">3.</b> <a href="${base}/documentation/appliance-setup-wizard" style="color:#8a4dea;text-decoration:underline;">Run the setup wizard</a> and enter the install code above.</td>
                  </tr>
                </table>

                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;margin:24px 0 0 0;">
                  <tr>
                    <td align="center">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;">
                        <tr>
                          <td bgcolor="#8a4dea" align="center" style="background-color:#8a4dea;border-radius:8px;">
                            <a href="${input.downloadUrl}" style="background-color:#8a4dea;color:#ffffff;display:inline-block;padding:14px 28px;font-family:${POPPINS};font-size:15px;font-weight:600;text-align:center;text-decoration:none;border-radius:8px;-webkit-text-size-adjust:none;">Download the appliance ISO</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
                ${
                  videoUrl
                    ? `<p style="color:#334155;font-family:${INTER};font-size:14px;line-height:1.6;text-align:center;margin:16px 0 0 0;"><a href="${videoUrl}" style="color:#8a4dea;text-decoration:underline;">Watch the setup walkthrough</a> if you would rather follow along on video.</p>`
                    : ''
                }

                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;">
                  <tr>
                    <td style="padding:32px 0 24px 0;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;">
                        <tr><td style="height:1px;background-color:#e2e8f0;font-size:1px;line-height:1px;">&nbsp;</td></tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:separate;">
                  <tr>
                    <td bgcolor="#f0fbff" style="background-color:#f0fbff;border:1px solid #bae6fd;border-left:4px solid #40cff9;border-radius:8px;padding:24px;">
                      <h4 style="color:#0284c7;font-family:${POPPINS};font-size:16px;font-weight:600;margin:0 0 12px 0;">Expired, lost, or reinstalling?</h4>
                      <p style="color:#334155;font-family:${INTER};font-size:14px;line-height:1.6;margin:0;">Getting a fresh code is free and takes a moment &mdash; <a href="${base}/order/appliance/reissue" style="color:#0284c7;text-decoration:underline;">re-issue it here</a>, or sign in to your <a href="${base}/portal" style="color:#0284c7;text-decoration:underline;">licensing portal</a> with this email address (no password).</p>
                    </td>
                  </tr>
                </table>

                <p style="color:#64748b;font-family:${INTER};font-size:14px;line-height:1.6;margin:24px 0 0 0;">Planning to buy Pro later? That uses a separate <i>activation code</i>, and your appliance upgrades in place from <b style="color:#334155;font-weight:600;">Settings &rarr; License</b> &mdash; no reinstall, no data migration. <a href="${base}/documentation/licensing-portal" style="color:#8a4dea;text-decoration:underline;">How licensing works</a>.</p>

              </td>
            </tr>

            <tr>
              <td align="center" bgcolor="#1e293b" style="background-color:#1e293b;color:#cbd5e1;padding:32px 24px;text-align:center;font-size:14px;line-height:1.6;border-radius:0 0 12px 12px;">
                <p style="color:#cbd5e1;font-family:${INTER};margin:0 0 8px 0;">This email was sent automatically when your appliance was registered.</p>
                <p style="color:#cbd5e1;font-family:${INTER};margin:0 0 16px 0;">If you did not request an appliance, please contact support.</p>
                <p style="color:#94a3b8;font-family:${INTER};font-size:13px;margin:0;">&copy; ${year} Nine Minds. All rights reserved.</p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
