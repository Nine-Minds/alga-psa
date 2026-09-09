// Import mocks first to ensure they're hoisted
import 'server/test-utils/testMocks';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { TestContext } from 'server/test-utils/testContext';
import { setupCommonMocks } from 'server/test-utils/testMocks';

const enqueueWorkflow = vi.hoisted(() => vi.fn(async () => ({ enqueued: true })));

vi.mock('@ee/lib/portal-domains/workflowClient', () => ({
  enqueuePortalDomainWorkflow: enqueueWorkflow,
}));

import { requestPortalDomainRegistrationAction } from '@/lib/actions/tenant-actions/portalDomainActions';
import { computeCanonicalHost } from '@/models/PortalDomainModel';

/**
 * DB-backed coverage of the hosted ("temporal") portal-domain flow and its
 * permission gate. The server test runner resolves @ee to the real EE tree, so
 * the edition seam supplies the Temporal driver; the workflow client itself is
 * mocked. Requires a migrated test database.
 */
describe('Portal domain hosted actions (temporal mode)', () => {
  const { beforeAll: setupContext, beforeEach: resetContext, afterAll: cleanupContext } =
    TestContext.createHelpers();

  let context: TestContext;
  const prevProfile = process.env.DEPLOYMENT_PROFILE;

  const mockAdmin = () =>
    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      user: context.user,
      permissionCheck: () => true,
    });

  beforeAll(async () => {
    delete process.env.DEPLOYMENT_PROFILE;
    process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'https://alga.test';
    context = await setupContext({
      runSeeds: true,
      cleanupTables: ['portal_domain_session_otts', 'portal_domains'],
    });
    mockAdmin();
  }, 120000);

  afterAll(async () => {
    if (prevProfile === undefined) {
      delete process.env.DEPLOYMENT_PROFILE;
    } else {
      process.env.DEPLOYMENT_PROFILE = prevProfile;
    }
    await cleanupContext();
  });

  beforeEach(async () => {
    context = await resetContext();
    mockAdmin();
    enqueueWorkflow.mockClear();
    await context.db('portal_domain_session_otts').where({ tenant: context.tenantId }).delete();
    await context.db('portal_domains').where({ tenant: context.tenantId }).delete();
  });

  it('persists a new domain as pending_dns and enqueues the register trigger', async () => {
    const result = await requestPortalDomainRegistrationAction({ domain: 'first.example.com' });

    if (!('status' in result)) {
      throw new Error(`Expected registration to succeed, got ${JSON.stringify(result)}`);
    }
    expect(result.status.domain).toBe('first.example.com');
    expect(result.status.status).toBe('pending_dns');
    expect(result.status.mode).toBe('temporal');
    expect(result.status.isEditable).toBe(true);

    const row = await context.db('portal_domains').where({ tenant: context.tenantId }).first();
    expect(row).toBeTruthy();
    expect(row.status).toBe('pending_dns');
    expect(row.certificate_secret_name).toBeNull();
    expect(row.verification_details).toMatchObject({
      expected_cname: row.canonical_host,
      requested_domain: 'first.example.com',
    });

    expect(enqueueWorkflow).toHaveBeenCalledWith({
      tenantId: context.tenantId,
      portalDomainId: row.id,
      trigger: 'register',
    });
  });

  it('resets an existing domain and enqueues the refresh trigger when the domain changes', async () => {
    const canonicalHost = computeCanonicalHost(context.tenantId);
    await context.db('portal_domains').insert({
      tenant: context.tenantId,
      domain: 'old.example.com',
      canonical_host: canonicalHost,
      status: 'active',
      status_message: 'Active',
      verification_method: 'cname',
      verification_details: { expected_cname: canonicalHost, requested_domain: 'old.example.com' },
      last_checked_at: new Date(),
      certificate_secret_name: 'portal-domain-old',
      last_synced_resource_version: 'rv-123',
    });

    const result = await requestPortalDomainRegistrationAction({ domain: 'new.example.com' });

    if (!('status' in result)) {
      throw new Error(`Expected registration to succeed, got ${JSON.stringify(result)}`);
    }
    expect(result.status.domain).toBe('new.example.com');
    expect(result.status.status).toBe('pending_dns');
    expect(result.status.statusMessage).toContain('Updating custom domain');

    const row = await context.db('portal_domains').where({ tenant: context.tenantId }).first();
    expect(row.domain).toBe('new.example.com');
    expect(row.certificate_secret_name).toBeNull();
    expect(row.last_synced_resource_version).toBeNull();
    expect(row.verification_details).toMatchObject({
      expected_cname: canonicalHost,
      requested_domain: 'new.example.com',
      previous_domain: 'old.example.com',
    });

    expect(enqueueWorkflow).toHaveBeenCalledWith({
      tenantId: context.tenantId,
      portalDomainId: row.id,
      trigger: 'refresh',
    });
  });

  it('rejects client portal users before any write', async () => {
    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      user: { ...context.user, user_type: 'client' },
      permissionCheck: () => true,
    });

    const result = await requestPortalDomainRegistrationAction({ domain: 'not-allowed.example.com' });

    expect(result).toEqual({
      permissionError: 'Client portal users cannot manage custom domains.',
      messageKey: 'msp/settings:errors.clientPortalDomain.portalUsersNotAllowed',
    });
    const row = await context.db('portal_domains').where({ tenant: context.tenantId }).first();
    expect(row).toBeUndefined();
    expect(enqueueWorkflow).not.toHaveBeenCalled();
  });

  it('rejects internal users without settings:update', async () => {
    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      user: context.user,
      permissionCheck: (_user, resource, action) => !(resource === 'settings' && action === 'update'),
    });

    const result = await requestPortalDomainRegistrationAction({ domain: 'no-perms.example.com' });

    expect(result).toMatchObject({ messageKey: 'msp/settings:errors.clientPortalDomain.noPermission' });
    const row = await context.db('portal_domains').where({ tenant: context.tenantId }).first();
    expect(row).toBeUndefined();
    expect(enqueueWorkflow).not.toHaveBeenCalled();
  });
});
