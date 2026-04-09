'use server';

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withAdminTransaction } from '@alga-psa/db';
import { hashPassword } from '@alga-psa/core/encryption';
import type { Knex } from 'knex';

const require = createRequire(import.meta.url);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const APPLIANCE_CLAIM_TOKEN_TTL_HOURS = Number(process.env.APPLIANCE_CLAIM_TOKEN_TTL_HOURS || '72');

export type ApplianceClaimVerifyStatus =
  | 'valid'
  | 'missing_token'
  | 'appliance_mode_disabled'
  | 'invalid_token'
  | 'expired_token'
  | 'already_used'
  | 'already_claimed'
  | 'bootstrap_state_inconsistent';

export interface ApplianceClaimVerifyResult {
  status: ApplianceClaimVerifyStatus;
}

export interface CompleteApplianceClaimInput {
  token: string;
  fullName: string;
  email: string;
  organizationName: string;
  password: string;
  confirmPassword: string;
}

export interface CompleteApplianceClaimResult {
  success: boolean;
  status: ApplianceClaimVerifyStatus;
  username?: string;
  error?: string;
}

interface ApplianceClaimTokenRow {
  id: string;
  token_hash: string;
  expires_at: Date;
  claimed_at: Date | null;
  claimed_user_id: string | null;
  claimed_tenant_id: string | null;
  created_at: Date;
  metadata?: Record<string, unknown> | null;
}

function isApplianceModeEnabled(): boolean {
  return process.env.APPLIANCE_MODE === 'true';
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

async function hasAnyInternalUser(trx: Knex.Transaction): Promise<boolean> {
  const row = await trx('users')
    .where({ user_type: 'internal', is_inactive: false })
    .first('user_id');
  return Boolean(row);
}

async function ensureTenantRow(
  trx: Knex.Transaction,
  organizationName: string,
  adminEmail: string
): Promise<string> {
  const existingTenant = await trx('tenants').select('tenant').orderBy('created_at', 'asc').first();
  if (existingTenant?.tenant) {
    return existingTenant.tenant;
  }

  const [createdTenant] = await trx('tenants')
    .insert({
      client_name: organizationName,
      email: adminEmail,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    })
    .returning(['tenant']);

  return createdTenant.tenant;
}

async function ensureDefaultClient(
  trx: Knex.Transaction,
  tenantId: string,
  organizationName: string
): Promise<void> {
  const existingClient = await trx('clients')
    .where({ tenant: tenantId, is_inactive: false })
    .first('client_id');

  if (existingClient) {
    return;
  }

  await trx('clients').insert({
    tenant: tenantId,
    client_name: organizationName,
    is_inactive: false,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now(),
  });
}

async function ensureTenantSettingsRow(trx: Knex.Transaction, tenantId: string): Promise<void> {
  await trx('tenant_settings')
    .insert({
      tenant: tenantId,
      onboarding_completed: false,
      onboarding_skipped: false,
      onboarding_data: null,
      settings: null,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    })
    .onConflict('tenant')
    .ignore();
}

async function runOnboardingSeed(
  trx: Knex.Transaction,
  tenantId: string,
  seedFileName: string
): Promise<void> {
  const candidatePaths = [
    path.resolve(process.cwd(), 'ee/server/seeds/onboarding', seedFileName),
    path.resolve(process.cwd(), '..', 'ee/server/seeds/onboarding', seedFileName),
    path.resolve(moduleDir, '../../../../../ee/server/seeds/onboarding', seedFileName),
    path.resolve(moduleDir, '../../../../../../ee/server/seeds/onboarding', seedFileName),
  ];
  const seedPath = candidatePaths.find((candidate) => existsSync(candidate));
  if (!seedPath) {
    throw new Error(`Unable to resolve onboarding seed "${seedFileName}"`);
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const seedModule = require(seedPath);
  if (!seedModule?.seed || typeof seedModule.seed !== 'function') {
    throw new Error(`Invalid onboarding seed module: ${seedFileName}`);
  }

  await seedModule.seed(trx, tenantId);
}

async function ensureOnboardingRolesAndPermissions(
  trx: Knex.Transaction,
  tenantId: string
): Promise<void> {
  await runOnboardingSeed(trx, tenantId, '01_roles.cjs');
  await runOnboardingSeed(trx, tenantId, '02_permissions.cjs');
  await runOnboardingSeed(trx, tenantId, '03_role_permissions.cjs');
}

async function ensureMspAdminRole(trx: Knex.Transaction, tenantId: string): Promise<string> {
  const role = await trx('roles')
    .where({ tenant: tenantId, role_name: 'Admin', msp: true })
    .first('role_id');

  if (role?.role_id) {
    return role.role_id;
  }

  const [createdRole] = await trx('roles')
    .insert({
      tenant: tenantId,
      role_name: 'Admin',
      description: 'Full system administrator access',
      msp: true,
      client: false,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    })
    .returning(['role_id']);

  return createdRole.role_id;
}

async function verifyTokenForClaim(
  trx: Knex.Transaction,
  rawToken: string
): Promise<{ status: ApplianceClaimVerifyStatus; tokenRow?: ApplianceClaimTokenRow }> {
  if (!rawToken) {
    return { status: 'missing_token' };
  }

  if (!isApplianceModeEnabled()) {
    return { status: 'appliance_mode_disabled' };
  }

  if (await hasAnyInternalUser(trx)) {
    return { status: 'already_claimed' };
  }

  const tokenHash = hashToken(rawToken);
  const tokenRow = await trx('appliance_claim_tokens')
    .where({ token_hash: tokenHash })
    .orderBy('created_at', 'desc')
    .first();

  if (!tokenRow) {
    return { status: 'invalid_token' };
  }

  if (tokenRow.claimed_at) {
    return { status: 'already_used' };
  }

  if (!tokenRow.expires_at || new Date(tokenRow.expires_at).getTime() <= Date.now()) {
    return { status: 'expired_token' };
  }

  return { status: 'valid', tokenRow };
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const normalized = fullName.trim();
  if (!normalized) {
    return { firstName: '', lastName: '' };
  }
  const parts = normalized.split(/\s+/);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  };
}

export async function verifyApplianceClaimToken(token: string): Promise<ApplianceClaimVerifyResult> {
  return withAdminTransaction(async (trx) => {
    const result = await verifyTokenForClaim(trx, token);
    return { status: result.status };
  });
}

export async function completeApplianceClaim(
  input: CompleteApplianceClaimInput
): Promise<CompleteApplianceClaimResult> {
  const normalizedToken = input.token?.trim() || '';
  const normalizedEmail = normalizeEmail(input.email || '');
  const fullName = input.fullName?.trim() || '';
  const organizationName = input.organizationName?.trim() || '';
  const password = input.password || '';
  const confirmPassword = input.confirmPassword || '';

  if (!fullName || !normalizedEmail || !organizationName || !password || !confirmPassword) {
    return {
      success: false,
      status: 'bootstrap_state_inconsistent',
      error: 'All fields are required.',
    };
  }

  if (password !== confirmPassword) {
    return {
      success: false,
      status: 'bootstrap_state_inconsistent',
      error: 'Password confirmation does not match.',
    };
  }

  if (password.length < 8) {
    return {
      success: false,
      status: 'bootstrap_state_inconsistent',
      error: 'Password must be at least 8 characters.',
    };
  }

  return withAdminTransaction(async (trx) => {
    return trx.transaction(async (innerTrx) => {
      const verification = await verifyTokenForClaim(innerTrx, normalizedToken);
      if (verification.status !== 'valid' || !verification.tokenRow) {
        return {
          success: false,
          status: verification.status,
        };
      }

      const lockedToken = await innerTrx('appliance_claim_tokens')
        .where({ id: verification.tokenRow.id })
        .forUpdate()
        .first();

      if (!lockedToken) {
        return {
          success: false,
          status: 'invalid_token',
        };
      }

      if (lockedToken.claimed_at) {
        return {
          success: false,
          status: 'already_used',
        };
      }

      if (new Date(lockedToken.expires_at).getTime() <= Date.now()) {
        return {
          success: false,
          status: 'expired_token',
        };
      }

      if (await hasAnyInternalUser(innerTrx)) {
        return {
          success: false,
          status: 'already_claimed',
        };
      }

      const existingEmail = await innerTrx('users')
        .where({ email: normalizedEmail })
        .first('user_id');
      if (existingEmail) {
        return {
          success: false,
          status: 'bootstrap_state_inconsistent',
          error: 'Email is already in use.',
        };
      }

      const tenantId = await ensureTenantRow(innerTrx, organizationName, normalizedEmail);
      await ensureTenantSettingsRow(innerTrx, tenantId);
      await ensureDefaultClient(innerTrx, tenantId, organizationName);
      await ensureOnboardingRolesAndPermissions(innerTrx, tenantId);

      const adminRoleId = await ensureMspAdminRole(innerTrx, tenantId);
      const { firstName, lastName } = splitName(fullName);
      const hashedPassword = await hashPassword(password);

      const [createdUser] = await innerTrx('users')
        .insert({
          tenant: tenantId,
          username: normalizedEmail,
          email: normalizedEmail,
          first_name: firstName || null,
          last_name: lastName || null,
          hashed_password: hashedPassword,
          user_type: 'internal',
          is_inactive: false,
          two_factor_enabled: false,
          is_google_user: false,
          created_at: innerTrx.fn.now(),
          updated_at: innerTrx.fn.now(),
        })
        .returning(['user_id']);

      await innerTrx('user_roles').insert({
        tenant: tenantId,
        user_id: createdUser.user_id,
        role_id: adminRoleId,
        created_at: innerTrx.fn.now(),
      });

      const updated = await innerTrx('appliance_claim_tokens')
        .where({ id: lockedToken.id })
        .whereNull('claimed_at')
        .update({
          claimed_at: innerTrx.fn.now(),
          claimed_user_id: createdUser.user_id,
          claimed_tenant_id: tenantId,
          metadata: innerTrx.raw(
            "coalesce(metadata, '{}'::jsonb) || ?::jsonb",
            [JSON.stringify({ claim_source: 'web' })]
          ),
        });

      if (updated !== 1) {
        return {
          success: false,
          status: 'already_used',
        };
      }

      return {
        success: true,
        status: 'valid',
        username: normalizedEmail,
      };
    });
  });
}

export function getApplianceClaimTokenTtlHours(): number {
  return APPLIANCE_CLAIM_TOKEN_TTL_HOURS;
}
