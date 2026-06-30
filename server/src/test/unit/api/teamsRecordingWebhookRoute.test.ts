import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const scheduleImmediateJobMock = vi.hoisted(() => vi.fn());
const teamsIntegrationRowMock = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));

vi.mock('@/lib/jobs', () => ({
  scheduleImmediateJob: scheduleImmediateJobMock,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async (_tenant: string) => ({
    knex: (_table: string) => ({
      where: () => ({
        first: async () => teamsIntegrationRowMock.value,
      }),
    }),
  }),
  tenantDb: (conn: any, tenant: string) => ({
    table: (t: string) => conn(t).where({ tenant }),
  }),
}));

const VALID_SECRET = 'a'.repeat(64);

function webhookRequest(value: unknown): NextRequest {
  return new NextRequest('https://example.test/api/teams/webhooks/recordings', {
    method: 'POST',
    body: JSON.stringify({ value }),
  });
}

describe('Teams recording webhook route', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    vi.resetModules();
    scheduleImmediateJobMock.mockReset();
    teamsIntegrationRowMock.value = {
      meeting_artifact_webhook_secret: VALID_SECRET,
      recordings_subscription_id: 'sub-1',
      transcripts_subscription_id: 'sub-2',
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

  it('T080 echoes validationToken, responds fast, and enqueues authentic artifact notifications', async () => {
    const route = await import('@/app/api/teams/webhooks/recordings/route');
    const validationResponse = await route.POST(new NextRequest('https://example.test/api/teams/webhooks/recordings?validationToken=abc123', {
      method: 'POST',
    }));

    expect(validationResponse.status).toBe(200);
    await expect(validationResponse.text()).resolves.toBe('abc123');
    expect(scheduleImmediateJobMock).not.toHaveBeenCalled();

    const webhookResponse = await route.POST(webhookRequest([
      {
        subscriptionId: 'sub-1',
        clientState: `teams-online-meeting-artifacts:tenant-1:recordings:${VALID_SECRET}`,
        resourceData: {
          '@odata.id': "communications/onlineMeetings('meeting-1')/recordings('rec-1')",
        },
      },
    ]));

    expect(webhookResponse.status).toBe(202);
    expect(scheduleImmediateJobMock).toHaveBeenCalledWith('process-teams-meeting-artifact-notification', {
      tenantId: 'tenant-1',
      notification: expect.objectContaining({ subscriptionId: 'sub-1' }),
    });
  });

  it('rejects a notification whose clientState secret does not match the stored value', async () => {
    const route = await import('@/app/api/teams/webhooks/recordings/route');
    const response = await route.POST(webhookRequest([
      {
        subscriptionId: 'sub-1',
        clientState: `teams-online-meeting-artifacts:tenant-1:recordings:${'b'.repeat(64)}`,
      },
    ]));

    expect(response.status).toBe(202);
    expect(scheduleImmediateJobMock).not.toHaveBeenCalled();
  });

  it('rejects a notification whose subscriptionId does not match the stored subscription', async () => {
    const route = await import('@/app/api/teams/webhooks/recordings/route');
    const response = await route.POST(webhookRequest([
      {
        subscriptionId: 'forged-sub',
        clientState: `teams-online-meeting-artifacts:tenant-1:recordings:${VALID_SECRET}`,
      },
    ]));

    expect(response.status).toBe(202);
    expect(scheduleImmediateJobMock).not.toHaveBeenCalled();
  });

  it('rejects a legacy clientState that carries no secret', async () => {
    const route = await import('@/app/api/teams/webhooks/recordings/route');
    const response = await route.POST(webhookRequest([
      {
        subscriptionId: 'sub-1',
        clientState: 'teams-online-meeting-artifacts:tenant-1:recordings',
      },
    ]));

    expect(response.status).toBe(202);
    expect(scheduleImmediateJobMock).not.toHaveBeenCalled();
  });
});
