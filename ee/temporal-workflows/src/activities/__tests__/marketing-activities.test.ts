import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MARKETING_EXPIRE_STALE_TARGETS_JOB,
  MARKETING_FLIP_DUE_POSTS_JOB,
  MARKETING_SEND_SEQUENCE_STEPS_JOB,
} from '@alga-psa/marketing/lib/marketingJobContract';

const getAdminConnectionMock = vi.fn();
const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn();
const tenantDbMock = vi.fn();
const flipDuePostsInternalMock = vi.fn();
const expireStaleTargetsInternalMock = vi.fn();
const sendDueSequenceStepsInternalMock = vi.fn();
const logInfoMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({
      log: {
        info: logInfoMock,
        error: logErrorMock,
      },
    }),
  },
}));

vi.mock('@alga-psa/db/admin.js', () => ({
  getAdminConnection: getAdminConnectionMock,
}));

vi.mock('@alga-psa/db/tenant.js', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: tenantDbMock,
}));

vi.mock('@alga-psa/marketing/lib/posts', () => ({
  flipDuePostsInternal: flipDuePostsInternalMock,
  expireStaleTargetsInternal: expireStaleTargetsInternalMock,
}));

vi.mock('@alga-psa/marketing/lib/sequences', () => ({
  sendDueSequenceStepsInternal: sendDueSequenceStepsInternalMock,
}));

describe('marketing activities', () => {
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;
  const originalApplicationUrl = process.env.APPLICATION_URL;
  const originalNextAuthUrl = process.env.NEXTAUTH_URL;
  const originalPublicBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  const originalPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const knex = { name: 'tenant-knex' };

  beforeEach(() => {
    vi.clearAllMocks();
    createTenantKnexMock.mockResolvedValue({ knex, tenant: 'tenant-1' });
    runWithTenantMock.mockImplementation(async (_tenantId, callback) => callback());
    process.env.NEXTAUTH_SECRET = 'test-signing-secret';
    process.env.APPLICATION_URL = 'http://alga-core.msp.svc.cluster.local:3000';
    process.env.NEXTAUTH_URL = 'http://auth.msp.svc.cluster.local:3000';
    process.env.NEXT_PUBLIC_BASE_URL = 'https://public.example.test/';
    process.env.NEXT_PUBLIC_APP_URL = 'https://fallback.example.test/';
  });

  afterEach(() => {
    if (originalNextAuthSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = originalNextAuthSecret;
    if (originalApplicationUrl === undefined) delete process.env.APPLICATION_URL;
    else process.env.APPLICATION_URL = originalApplicationUrl;
    if (originalNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = originalNextAuthUrl;
    if (originalPublicBaseUrl === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
    else process.env.NEXT_PUBLIC_BASE_URL = originalPublicBaseUrl;
    if (originalPublicAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalPublicAppUrl;
  });

  it('enumerates every tenant with an explicit unscoped query in deterministic order', async () => {
    const select = vi.fn().mockResolvedValue([
      { tenant: 'tenant-a' },
      { tenant: 'tenant-b' },
    ]);
    const orderBy = vi.fn(() => ({ select }));
    const unscoped = vi.fn(() => ({ orderBy }));
    getAdminConnectionMock.mockResolvedValue({ name: 'admin-knex' });
    tenantDbMock.mockReturnValue({ unscoped });
    const { listMarketingTenantIds } = await import('../marketing-activities');

    await expect(listMarketingTenantIds()).resolves.toEqual(['tenant-a', 'tenant-b']);
    expect(unscoped).toHaveBeenCalledWith(
      'tenants',
      expect.stringContaining('enumerates every tenant'),
    );
    expect(orderBy).toHaveBeenCalledWith('tenant', 'asc');
  });

  it.each([
    [MARKETING_FLIP_DUE_POSTS_JOB, flipDuePostsInternalMock, { flipped: 2 }, [knex, 'tenant-1']],
    [
      MARKETING_EXPIRE_STALE_TARGETS_JOB,
      expireStaleTargetsInternalMock,
      { expired: 3 },
      [knex, 'tenant-1', 48],
    ],
  ])('routes %s to its tenant domain operation', async (jobName, operation, summary, expectedArgs) => {
    operation.mockResolvedValue(summary);
    const { runMarketingJobForTenant } = await import('../marketing-activities');

    const result = await runMarketingJobForTenant({ jobName, tenantId: 'tenant-1' });

    expect(runWithTenantMock).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    expect(operation).toHaveBeenCalledWith(...expectedArgs);
    expect(result).toMatchObject({
      jobName,
      tenantId: 'tenant-1',
      operation: summary,
    });
  });

  it('passes the public URL and signing secret to sequence sending', async () => {
    const summary = { sent: 1, completed: 0, stopped: 0, failed: 1, skipped: 0 };
    sendDueSequenceStepsInternalMock.mockResolvedValue(summary);
    const { runMarketingJobForTenant } = await import('../marketing-activities');

    const result = await runMarketingJobForTenant({
      jobName: MARKETING_SEND_SEQUENCE_STEPS_JOB,
      tenantId: 'tenant-1',
    });

    expect(sendDueSequenceStepsInternalMock).toHaveBeenCalledWith(knex, 'tenant-1', {
      baseUrl: 'https://public.example.test',
      signingSecret: 'test-signing-secret',
    });
    expect(result.operation).toEqual(summary);
  });

  it('falls back to NEXT_PUBLIC_APP_URL without using internal worker hosts', async () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    sendDueSequenceStepsInternalMock.mockResolvedValue({
      sent: 0,
      completed: 0,
      stopped: 0,
      failed: 0,
      skipped: 0,
    });
    const { runMarketingJobForTenant } = await import('../marketing-activities');

    await runMarketingJobForTenant({
      jobName: MARKETING_SEND_SEQUENCE_STEPS_JOB,
      tenantId: 'tenant-1',
    });

    expect(sendDueSequenceStepsInternalMock).toHaveBeenCalledWith(
      knex,
      'tenant-1',
      expect.objectContaining({ baseUrl: 'https://fallback.example.test' }),
    );
  });

  it('fails closed when only internal worker URLs are configured', async () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    const { runMarketingJobForTenant } = await import('../marketing-activities');

    await expect(runMarketingJobForTenant({
      jobName: MARKETING_SEND_SEQUENCE_STEPS_JOB,
      tenantId: 'tenant-1',
    })).rejects.toThrow('No public marketing base URL available');
    expect(sendDueSequenceStepsInternalMock).not.toHaveBeenCalled();
  });

  it('fails closed before sequence sending when NEXTAUTH_SECRET is absent', async () => {
    delete process.env.NEXTAUTH_SECRET;
    const { runMarketingJobForTenant } = await import('../marketing-activities');

    await expect(runMarketingJobForTenant({
      jobName: MARKETING_SEND_SEQUENCE_STEPS_JOB,
      tenantId: 'tenant-1',
    })).rejects.toThrow('No marketing signing secret available');
    expect(sendDueSequenceStepsInternalMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown job name at runtime', async () => {
    const { runMarketingJobForTenant } = await import('../marketing-activities');

    await expect(runMarketingJobForTenant({
      jobName: 'marketing:unknown',
      tenantId: 'tenant-1',
    } as never)).rejects.toThrow('Unknown marketing job name');
  });

  it('rethows domain operation failures so Temporal can retry them', async () => {
    flipDuePostsInternalMock.mockRejectedValue(new Error('transient database failure'));
    const { runMarketingJobForTenant } = await import('../marketing-activities');

    await expect(runMarketingJobForTenant({
      jobName: MARKETING_FLIP_DUE_POSTS_JOB,
      tenantId: 'tenant-1',
    })).rejects.toThrow('transient database failure');
    expect(logErrorMock).toHaveBeenCalledWith(
      'Marketing tenant activity failed',
      expect.objectContaining({ error: 'transient database failure' }),
    );
  });
});
