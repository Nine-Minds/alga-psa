import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createHash } from 'node:crypto';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  completeApplianceClaimAction,
  verifyApplianceClaimTokenAction,
} from '@alga-psa/auth/actions';

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

async function truncateClaimTables(db: Knex): Promise<void> {
  await db.raw(`
    TRUNCATE TABLE
      user_roles,
      role_permissions,
      users,
      roles,
      permissions,
      tenant_settings,
      clients,
      tenants,
      appliance_claim_tokens
    RESTART IDENTITY CASCADE
  `);
}

async function insertClaimToken(
  db: Knex,
  token: string,
  options?: {
    expiresAt?: Date;
    claimedAt?: Date | null;
    metadata?: Record<string, unknown> | null;
  }
): Promise<void> {
  await db('appliance_claim_tokens').insert({
    token_hash: hashToken(token),
    expires_at: options?.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
    claimed_at: options?.claimedAt ?? null,
    created_at: db.fn.now(),
    metadata: options?.metadata ? JSON.stringify(options.metadata) : null,
  });
}

describe('appliance claim integration', () => {
  let db: Knex;
  const databaseName = `test_database_appliance_claim_${Date.now()}`;
  const originalApplianceMode = process.env.APPLIANCE_MODE;

  beforeAll(async () => {
    db = await createTestDbConnection({
      databaseName,
      runSeeds: false,
    });
  });

  beforeEach(async () => {
    process.env.APPLIANCE_MODE = 'true';
    await truncateClaimTables(db);
  });

  afterAll(async () => {
    if (typeof originalApplianceMode === 'undefined') {
      delete process.env.APPLIANCE_MODE;
    } else {
      process.env.APPLIANCE_MODE = originalApplianceMode;
    }

    if (db) {
      await db.destroy();
    }
  });

  it('T002: verifies valid unexpired token by hash lookup', async () => {
    const token = 'claim-token-happy-path';
    await insertClaimToken(db, token);

    const result = await verifyApplianceClaimTokenAction(token);

    expect(result).toEqual({
      success: true,
      status: 'valid',
    });
  });

  it('T003: rejects expired, already-used, and unknown tokens without mutation', async () => {
    await insertClaimToken(db, 'expired-token', {
      expiresAt: new Date(Date.now() - 60 * 1000),
    });
    await insertClaimToken(db, 'used-token', {
      claimedAt: new Date(),
      metadata: { superseded: true },
    });

    const beforeRows = await db('appliance_claim_tokens')
      .select('id', 'claimed_at')
      .orderBy('created_at', 'asc');

    const expiredResult = await verifyApplianceClaimTokenAction('expired-token');
    const usedResult = await verifyApplianceClaimTokenAction('used-token');
    const unknownResult = await verifyApplianceClaimTokenAction('unknown-token');

    expect(expiredResult.status).toBe('expired_token');
    expect(usedResult.status).toBe('already_used');
    expect(unknownResult.status).toBe('invalid_token');

    const afterRows = await db('appliance_claim_tokens')
      .select('id', 'claimed_at')
      .orderBy('created_at', 'asc');
    expect(afterRows).toEqual(beforeRows);
  });

  it('treats a completed non-superseded claim record as already claimed even without active internal users', async () => {
    await insertClaimToken(db, 'claimed-token', {
      claimedAt: new Date(),
      metadata: { claim_source: 'web' },
    });

    const verifyResult = await verifyApplianceClaimTokenAction('claimed-token');
    expect(verifyResult.status).toBe('already_claimed');

    const completionResult = await completeApplianceClaimAction({
      token: 'claimed-token',
      fullName: 'Blocked Admin',
      email: 'blocked@example.com',
      organizationName: 'Blocked MSP',
      password: 'StrongPassword1!',
      confirmPassword: 'StrongPassword1!',
    });

    expect(completionResult.success).toBe(false);
    expect(completionResult.status).toBe('already_claimed');
  });

  it('ignores superseded claim records when validating a current unclaimed token', async () => {
    await insertClaimToken(db, 'superseded-token', {
      claimedAt: new Date(),
      metadata: { superseded: true },
    });
    await insertClaimToken(db, 'current-token');

    const result = await verifyApplianceClaimTokenAction('current-token');

    expect(result).toEqual({
      success: true,
      status: 'valid',
    });
  });

  it('T004: blocks completion when appliance mode is disabled or an MSP admin already exists', async () => {
    await insertClaimToken(db, 'mode-disabled-token');
    process.env.APPLIANCE_MODE = 'false';

    const modeDisabledResult = await completeApplianceClaimAction({
      token: 'mode-disabled-token',
      fullName: 'Mode Disabled Admin',
      email: 'mode-disabled@example.com',
      organizationName: 'Mode Disabled MSP',
      password: 'StrongPassword1!',
      confirmPassword: 'StrongPassword1!',
    });

    expect(modeDisabledResult.success).toBe(false);
    expect(modeDisabledResult.status).toBe('appliance_mode_disabled');

    process.env.APPLIANCE_MODE = 'true';
    await truncateClaimTables(db);

    const existingTenantId = '11111111-1111-4111-8111-111111111111';
    const existingUserId = '22222222-2222-4222-8222-222222222222';
    await db('tenants').insert({
      tenant: existingTenantId,
      client_name: 'Existing MSP',
      email: 'existing@example.com',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db('users').insert({
      user_id: existingUserId,
      tenant: existingTenantId,
      username: 'existing-admin@example.com',
      email: 'existing-admin@example.com',
      first_name: 'Existing',
      last_name: 'Admin',
      hashed_password: 'hash',
      user_type: 'internal',
      is_inactive: false,
      is_google_user: false,
      two_factor_enabled: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await insertClaimToken(db, 'already-claimed-token');

    const alreadyClaimedResult = await completeApplianceClaimAction({
      token: 'already-claimed-token',
      fullName: 'Blocked Admin',
      email: 'blocked@example.com',
      organizationName: 'Blocked MSP',
      password: 'StrongPassword1!',
      confirmPassword: 'StrongPassword1!',
    });

    expect(alreadyClaimedResult.success).toBe(false);
    expect(alreadyClaimedResult.status).toBe('already_claimed');
  });

  it('returns a recoverable validation error when the claim form input is user-correctable', async () => {
    await insertClaimToken(db, 'validation-token');

    const result = await completeApplianceClaimAction({
      token: 'validation-token',
      fullName: 'Validation Admin',
      email: 'validation@example.com',
      organizationName: 'Validation MSP',
      password: 'StrongPassword1!',
      confirmPassword: 'MismatchPassword1!',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('valid');
    expect(result.recoverable).toBe(true);
    expect(result.error).toBe('Password confirmation does not match.');
  });

  it('T005: redeeming a valid token creates tenant bootstrap context, first MSP admin, and role assignment', async () => {
    const token = 'redeem-success-token';
    const email = 'first-admin@example.com';
    await insertClaimToken(db, token);

    const result = await completeApplianceClaimAction({
      token,
      fullName: 'First Appliance Admin',
      email,
      organizationName: 'Acme MSP',
      password: 'StrongPassword1!',
      confirmPassword: 'StrongPassword1!',
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('valid');
    expect(result.username).toBe(email);

    const createdUser = await db('users').where({ email }).first();
    expect(createdUser).toBeTruthy();
    expect(createdUser.user_type).toBe('internal');
    expect(createdUser.hashed_password).toBeTruthy();
    expect(createdUser.hashed_password).not.toBe('StrongPassword1!');

    const tenant = await db('tenants').where({ tenant: createdUser.tenant }).first();
    expect(tenant).toBeTruthy();

    const tenantSettings = await db('tenant_settings').where({ tenant: createdUser.tenant }).first();
    expect(tenantSettings).toBeTruthy();

    const defaultClient = await db('clients')
      .where({ tenant: createdUser.tenant })
      .first();
    expect(defaultClient).toBeTruthy();

    const adminRole = await db('roles')
      .where({ tenant: createdUser.tenant, role_name: 'Admin', msp: true })
      .first();
    expect(adminRole).toBeTruthy();

    const userRole = await db('user_roles')
      .where({ tenant: createdUser.tenant, user_id: createdUser.user_id, role_id: adminRole.role_id })
      .first();
    expect(userRole).toBeTruthy();

    const tokenRow = await db('appliance_claim_tokens').where({ token_hash: hashToken(token) }).first();
    expect(tokenRow.claimed_at).toBeTruthy();
    expect(tokenRow.claimed_user_id).toBe(createdUser.user_id);
    expect(tokenRow.claimed_tenant_id).toBe(createdUser.tenant);
  });

  it('T006: concurrent redemption attempts create only one initial admin and one claimed token', async () => {
    const token = 'concurrent-token';
    await insertClaimToken(db, token);

    const [firstAttempt, secondAttempt] = await Promise.all([
      completeApplianceClaimAction({
        token,
        fullName: 'Concurrent Admin One',
        email: 'concurrent-one@example.com',
        organizationName: 'Concurrency MSP',
        password: 'StrongPassword1!',
        confirmPassword: 'StrongPassword1!',
      }),
      completeApplianceClaimAction({
        token,
        fullName: 'Concurrent Admin Two',
        email: 'concurrent-two@example.com',
        organizationName: 'Concurrency MSP',
        password: 'StrongPassword1!',
        confirmPassword: 'StrongPassword1!',
      }),
    ]);

    const successCount = [firstAttempt, secondAttempt].filter((attempt) => attempt.success).length;
    expect(successCount).toBe(1);

    const internalUsers = await db('users').where({ user_type: 'internal', is_inactive: false });
    expect(internalUsers).toHaveLength(1);

    const tokenRow = await db('appliance_claim_tokens').where({ token_hash: hashToken(token) }).first();
    expect(tokenRow.claimed_at).toBeTruthy();
    expect(tokenRow.claimed_user_id).toBeTruthy();
    expect(tokenRow.claimed_tenant_id).toBeTruthy();
  });
});
