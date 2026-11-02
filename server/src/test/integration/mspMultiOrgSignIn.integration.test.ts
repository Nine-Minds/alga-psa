import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { authenticateUser } from '@alga-psa/auth/actions/auth';
import { hashPassword } from '@alga-psa/core/encryption';

// CM T0-5b (alga-2026-0002894): the same internal email + password in tenants A and B.
// Real PostgreSQL; only the outbound mail transport and the rate limiter are stubbed.
process.env.TEST_DB_NAME = process.env.TEST_DB_NAME || 'msp_multi_org_signin';

const sent: Array<{ to: string; infos: Array<{ tenantId: string; tenantName: string; loginUrl: string }> }> = [];
vi.mock('@alga-psa/email', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@alga-psa/email');
  return {
    ...actual,
    sendTenantRecoveryEmail: vi.fn(async (to: string, infos: any[]) => {
      sent.push({ to, infos });
    }),
  };
});
vi.mock('../../../../packages/auth/src/lib/security/rateLimiting', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../../packages/auth/src/lib/security/rateLimiting');
  return { ...actual, checkPasswordResetLimit: vi.fn(async () => ({ success: true, msBeforeNext: 0 })) };
});

const { createTestDbConnection, wireLocalTestDbEnv } = await import('../../../test-utils/dbConfig');
const { createTenant, createUser } = await import('../../../test-utils/testDataFactory');

process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

const PASSWORD = 'Correct-Horse-9!';
const OTHER_PASSWORD = 'Different-Battery-7!';
let db: Knex;
let tenantA: string;
let tenantB: string;
let email: string;

const setBPassword = async (password: string) => {
  await db('users').where({ tenant: tenantB, email }).update({ hashed_password: await hashPassword(password) });
};

const slugOf = async (tenantId: string) => {
  const { getTenantSlugForTenant } = await import('@alga-psa/db');
  return getTenantSlugForTenant(tenantId);
};

describe('MSP multi-organization sign-in (same email in two tenants)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    const secret = `msp-multi-${randomUUID()}`;
    process.env.nextauth_secret = secret;
    process.env.NEXTAUTH_SECRET = secret;
    db = await createTestDbConnection();
    email = `multi.${randomUUID()}@example.com`;
    tenantA = await createTenant(db, 'Multi Org A');
    tenantB = await createTenant(db, 'Multi Org B');
    await createUser(db, tenantA, { email, user_type: 'internal', hashed_password: await hashPassword(PASSWORD) });
    await createUser(db, tenantB, { email, user_type: 'internal', hashed_password: await hashPassword(OTHER_PASSWORD) });
  }, 180_000);

  afterAll(async () => {
    // Remove the rows this file created; the database itself is a per-file TEST_DB_NAME.
    await db?.('users').whereIn('tenant', [tenantA, tenantB].filter(Boolean)).del().catch(() => undefined);
    await db?.('tenants').whereIn('tenant', [tenantA, tenantB].filter(Boolean)).del().catch(() => undefined);
    await db?.destroy().catch(() => undefined);
    const { destroyAdminConnection } = await import('@alga-psa/db/admin');
    await destroyAdminConnection().catch(() => undefined);
  });

  it('an unscoped authenticateUser reports TenantRequired when both passwords could apply', async () => {
    // Make B share A's password so the email + password pair is genuinely ambiguous.
    await setBPassword(PASSWORD);
    await expect(authenticateUser(email, PASSWORD, 'internal')).rejects.toMatchObject({ code: 'TENANT_REQUIRED' });
  });

  it("tenantSlug = A's slug returns A's user", async () => {
    const user = await authenticateUser(email, PASSWORD, 'internal', { tenantSlug: await slugOf(tenantA) });
    expect(user?.tenant).toBe(tenantA);
  });

  it("tenantSlug = B's slug returns B's user", async () => {
    await setBPassword(PASSWORD);
    const user = await authenticateUser(email, PASSWORD, 'internal', { tenantSlug: await slugOf(tenantB) });
    expect(user?.tenant).toBe(tenantB);
  });

  it("B's slug with A's (different) password returns null", async () => {
    await setBPassword(OTHER_PASSWORD);
    const user = await authenticateUser(email, PASSWORD, 'internal', { tenantSlug: await slugOf(tenantB) });
    expect(user).toBeNull();
  });

  it('the discovery action emails one scoped link per organization', async () => {
    const { requestMspSignInLinksAction } = await import('../../app/actions/tenantDiscoveryActions');
    sent.length = 0;
    const result = await requestMspSignInLinksAction(email, '/msp/dashboard');
    expect(result.success).toBe(true);
    expect(sent).toHaveLength(1);
    const urls = sent[0].infos.map((i) => i.loginUrl).join('\n');
    expect(urls).toContain(`tenant=${await slugOf(tenantA)}`);
    expect(urls).toContain(`tenant=${await slugOf(tenantB)}`);
    expect(urls).toContain('/auth/msp/signin');
  });
});
