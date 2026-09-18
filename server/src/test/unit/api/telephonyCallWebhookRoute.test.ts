import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const scheduleJobMock = vi.hoisted(() => vi.fn());
const providerUpdateMock = vi.hoisted(() => vi.fn());
const providerRowMock = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));

vi.mock('@/lib/jobs/JobRunnerFactory', () => ({
  getJobRunner: async () => ({ scheduleJob: scheduleJobMock }),
}));

vi.mock('@alga-psa/db', () => {
  const builder = (): any => ({
    where: () => builder(),
    first: async () => providerRowMock.value,
    update: async (values: Record<string, unknown>) => {
      providerUpdateMock(values);
      return 1;
    },
  });
  const knex: any = (_table: string) => builder();
  knex.fn = { now: () => 'now()' };

  return {
    createTenantKnex: async (_tenant: string) => ({ knex }),
    tenantDb: (conn: any, tenant: string) => ({
      table: (t: string) => conn(t).where({ tenant }),
    }),
  };
});

const VALID_SECRET = 'a'.repeat(64);

function webhookRequest(value: unknown): NextRequest {
  return new NextRequest('https://example.test/api/telephony/webhooks/teams-calls', {
    method: 'POST',
    body: JSON.stringify({ value }),
  });
}

describe('T034 telephony call webhook route', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    vi.resetModules();
    scheduleJobMock.mockReset();
    providerUpdateMock.mockReset();
    providerRowMock.value = {
      webhook_secret: VALID_SECRET,
      subscription_id: 'call-sub-1',
      status: 'active',
    };
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalEdition === undefined) {
      delete process.env.EDITION;
    } else {
      process.env.EDITION = originalEdition;
    }
    if (originalPublicEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalPublicEdition;
    }
  });

  it('echoes validationToken and enqueues an authentic call notification', async () => {
    const route = await import('@/app/api/telephony/webhooks/teams-calls/route');

    const validationResponse = await route.POST(
      new NextRequest('https://example.test/api/telephony/webhooks/teams-calls?validationToken=abc123', {
        method: 'POST',
      }),
    );
    expect(validationResponse.status).toBe(200);
    await expect(validationResponse.text()).resolves.toBe('abc123');
    expect(scheduleJobMock).not.toHaveBeenCalled();

    const webhookResponse = await route.POST(webhookRequest([
      {
        subscriptionId: 'call-sub-1',
        clientState: `telephony-call-records:tenant-1:teams-phone:${VALID_SECRET}`,
        resourceData: { '@odata.id': "communications/callRecords('cdr-1')" },
      },
    ]));

    expect(webhookResponse.status).toBe(202);
    expect(scheduleJobMock).toHaveBeenCalledWith('process-telephony-call-notification', {
      tenantId: 'tenant-1',
      notification: expect.objectContaining({ subscriptionId: 'call-sub-1' }),
    });
    // "Last heard from Graph" is how a dead subscription is told from a quiet one.
    expect(providerUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ last_notification_at: 'now()' }),
    );
  });

  it('stamps the provider once for a batch and not at all for a forged batch', async () => {
    const route = await import('@/app/api/telephony/webhooks/teams-calls/route');
    const clientState = `telephony-call-records:tenant-1:teams-phone:${VALID_SECRET}`;

    await route.POST(webhookRequest([
      { subscriptionId: 'call-sub-1', clientState, resourceData: { id: 'cdr-1' } },
      { subscriptionId: 'call-sub-1', clientState, resourceData: { id: 'cdr-2' } },
    ]));
    expect(scheduleJobMock).toHaveBeenCalledTimes(2);
    expect(providerUpdateMock).toHaveBeenCalledTimes(1);

    providerUpdateMock.mockReset();
    await route.POST(webhookRequest([
      { subscriptionId: 'forged-sub', clientState, resourceData: { id: 'cdr-3' } },
    ]));
    expect(providerUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects a notification whose clientState secret does not match', async () => {
    const route = await import('@/app/api/telephony/webhooks/teams-calls/route');
    const response = await route.POST(webhookRequest([
      {
        subscriptionId: 'call-sub-1',
        clientState: `telephony-call-records:tenant-1:teams-phone:${'b'.repeat(64)}`,
      },
    ]));

    expect(response.status).toBe(202);
    expect(scheduleJobMock).not.toHaveBeenCalled();
  });

  it('rejects a notification whose subscriptionId does not match the stored subscription', async () => {
    const route = await import('@/app/api/telephony/webhooks/teams-calls/route');
    const response = await route.POST(webhookRequest([
      {
        subscriptionId: 'forged-sub',
        clientState: `telephony-call-records:tenant-1:teams-phone:${VALID_SECRET}`,
      },
    ]));

    expect(response.status).toBe(202);
    expect(scheduleJobMock).not.toHaveBeenCalled();
  });

  it('ignores notifications for a provider that is no longer active', async () => {
    providerRowMock.value = { webhook_secret: VALID_SECRET, subscription_id: 'call-sub-1', status: 'disabled' };
    const route = await import('@/app/api/telephony/webhooks/teams-calls/route');
    const response = await route.POST(webhookRequest([
      {
        subscriptionId: 'call-sub-1',
        clientState: `telephony-call-records:tenant-1:teams-phone:${VALID_SECRET}`,
      },
    ]));

    expect(response.status).toBe(202);
    expect(scheduleJobMock).not.toHaveBeenCalled();
  });
});

describe('T035 telephony webhook allowlist', () => {
  it('reaches the route without an API key while sibling telephony paths stay guarded', async () => {
    const { shouldSkipApiKeyAuth } = await import('@/middleware');
    expect(shouldSkipApiKeyAuth('/api/telephony/webhooks/teams-calls')).toBe(true);
    expect(shouldSkipApiKeyAuth('/api/telephony/calls')).toBe(false);
  });
});
