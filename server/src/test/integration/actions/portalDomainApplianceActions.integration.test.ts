// Import mocks first to ensure they're hoisted
import 'server/test-utils/testMocks';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestContext } from 'server/test-utils/testContext';
import { setupCommonMocks } from 'server/test-utils/testMocks';
import {
  requestPortalDomainRegistrationAction,
  disablePortalDomainAction,
} from '@ee/lib/actions/tenant-actions/portalDomainActions';

/**
 * DB-backed coverage of the appliance ("direct") portal-domain flow (T003/T004):
 * register marks the row active with no workflow, and disable deletes the row and
 * cascades away its one-time tokens. Requires a migrated test database.
 */
describe('Portal domain appliance actions (direct mode)', () => {
  const { beforeAll: setupContext, beforeEach: resetContext, afterAll: cleanupContext } =
    TestContext.createHelpers();

  let context: TestContext;
  const prevProfile = process.env.DEPLOYMENT_PROFILE;

  beforeAll(async () => {
    process.env.DEPLOYMENT_PROFILE = 'appliance';
    process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'https://alga.test';
    context = await setupContext({
      runSeeds: true,
      cleanupTables: ['portal_domain_session_otts', 'portal_domains'],
    });
    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      user: context.user,
      permissionCheck: () => true,
    });
  }, 120000);

  afterAll(async () => {
    process.env.DEPLOYMENT_PROFILE = prevProfile;
    await cleanupContext();
  });

  beforeEach(async () => {
    context = await resetContext();
    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      user: context.user,
      permissionCheck: () => true,
    });
    await context.db('portal_domain_session_otts').where({ tenant: context.tenantId }).delete();
    await context.db('portal_domains').where({ tenant: context.tenantId }).delete();
  });

  it('register activates the row immediately and enqueues no workflow (T003)', async () => {
    const result = await requestPortalDomainRegistrationAction({ domain: 'portal.acme.com' });

    expect(result.status.status).toBe('active');
    expect(result.status.mode).toBe('direct');
    expect(result.status.verificationDetails.forward_host_header).toBe(true);

    const row = await context.db('portal_domains').where({ tenant: context.tenantId }).first();
    expect(row).toBeTruthy();
    expect(row.status).toBe('active');
    expect(row.domain).toBe('portal.acme.com');
  });

  it('disable deletes the row and cascades its session OTTs (T004)', async () => {
    await requestPortalDomainRegistrationAction({ domain: 'portal.acme.com' });
    const row = await context.db('portal_domains').where({ tenant: context.tenantId }).first();

    // Seed an outstanding one-time token referencing the domain.
    await context.db('portal_domain_session_otts').insert({
      tenant: context.tenantId,
      portal_domain_id: row.id,
      user_id: context.userId,
      token_hash: 'a'.repeat(64),
      expires_at: new Date(Date.now() + 60_000),
    });

    await disablePortalDomainAction();

    const domainAfter = await context.db('portal_domains').where({ tenant: context.tenantId }).first();
    const ottsAfter = await context.db('portal_domain_session_otts').where({ tenant: context.tenantId });
    expect(domainAfter).toBeUndefined();
    expect(ottsAfter).toHaveLength(0);
  });
});
