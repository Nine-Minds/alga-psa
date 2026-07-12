import crypto from 'node:crypto';
import { ApplicationFailure } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import { verifyLicense } from '@alga-psa/licensing';

const DEFAULT_SERVICE_URL = 'https://license.nineminds.com';
const NON_RETRYABLE_CODES = new Set([
  'invalid_claim_code', 'expired_claim_code', 'consumed_claim_code', 'superseded_claim_code',
]);

function fail(message: string, code: string): never {
  throw ApplicationFailure.nonRetryable(message, code);
}

function tenantFromToken(token: unknown): string | null {
  if (typeof token !== 'string' || !token) return null;
  const verified = verifyLicense(token);
  return verified.valid ? verified.claims.aud ?? null : null;
}

function serviceUrl(row: any): string {
  if (process.env.ALGA_LICENSE_SERVICE_URL) return process.env.ALGA_LICENSE_SERVICE_URL.replace(/\/$/, '');
  try { return new URL(row.check_in_url).origin; } catch { return DEFAULT_SERVICE_URL; }
}

async function context(knex: any) {
  const row = await knex('license_state').orderBy('id').first();
  if (!row) fail('Not a self-hosted install', 'not_self_host');
  const tokenTenant = tenantFromToken(row.license_token);
  const tenantRow = tokenTenant ? null : await knex('tenants').select('tenant').first();
  const tenantId = tokenTenant ?? tenantRow?.tenant ?? null;
  const applianceId = row.appliance_id
    ?? `appliance-${row.id}-${crypto.createHash('sha256').update(String(row.id)).digest('hex').slice(0, 8)}`;
  return { row, tenantId, applianceId };
}

export async function applianceLicenseRedeemActivity(input: { claimCode: string }) {
  const knex = await getAdminConnection();
  const { row, tenantId, applianceId } = await context(knex);
  const baseUrl = serviceUrl(row);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        claim_code: String(input.claimCode || '').trim().toUpperCase().replace(/[\s-]/g, ''),
        appliance_id: applianceId, tenant_id: tenantId,
      }),
    });
  } catch (error) { throw error; }
  if (response.status >= 500) throw new Error(`License service failed: HTTP ${response.status}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { code?: string; error?: string };
    const code = body.code || body.error || 'registration_rejected';
    if (NON_RETRYABLE_CODES.has(code) || code.includes('superseded')) fail('Claim code was rejected', code);
    fail('Claim code registration was rejected', code);
  }
  const body = await response.json() as any;
  if (body.tenant_id && tenantId && body.tenant_id !== tenantId) fail('Claim code belongs to a different tenant', 'tenant_mismatch');
  const verified = verifyLicense(body.first_jwt || '');
  if (!verified.valid) fail('License service returned an invalid license', 'invalid_license_response');
  await knex('license_state').where({ id: row.id }).update({
    license_token: body.first_jwt, appliance_id: applianceId,
    check_in_url: body.check_in_url, appliance_credential: body.appliance_credential,
    last_checkin_at: knex.fn.now(), updated_at: knex.fn.now(),
  });
  return {
    edition: body.edition || verified.claims.tier, tenantId: body.tenant_id || tenantId,
    licenseToken: body.first_jwt, applianceCredential: body.appliance_credential,
    checkInUrl: body.check_in_url, applianceId,
  };
}

export async function applianceLicenseApplyActivity(input: { licenseKey: string }) {
  const knex = await getAdminConnection();
  const { row, tenantId } = await context(knex);
  const token = String(input.licenseKey || '').trim();
  const verified = verifyLicense(token);
  if (!verified.valid) fail(`License is invalid: ${verified.reason}`, 'invalid_license');
  if (verified.claims.exp * 1000 <= Date.now()) fail('License has expired', 'expired_license');
  if (verified.claims.aud && tenantId && verified.claims.aud !== tenantId) fail('License belongs to a different tenant', 'tenant_mismatch');
  await knex('license_state').where({ id: row.id }).update({ license_token: token, updated_at: knex.fn.now() });
  return { edition: verified.claims.tier, expiresAt: new Date(verified.claims.exp * 1000).toISOString() };
}
