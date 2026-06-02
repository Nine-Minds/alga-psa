import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const scheduleImmediateJobMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/jobs', () => ({
  scheduleImmediateJob: scheduleImmediateJobMock,
}));

describe('Teams recording webhook route', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    vi.resetModules();
    scheduleImmediateJobMock.mockReset();
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

  it('T080 echoes validationToken, responds fast, and enqueues artifact notification jobs', async () => {
    const route = await import('@/app/api/teams/webhooks/recordings/route');
    const validationResponse = await route.POST(new NextRequest('https://example.test/api/teams/webhooks/recordings?validationToken=abc123', {
      method: 'POST',
    }));

    expect(validationResponse.status).toBe(200);
    await expect(validationResponse.text()).resolves.toBe('abc123');
    expect(scheduleImmediateJobMock).not.toHaveBeenCalled();

    const webhookResponse = await route.POST(new NextRequest('https://example.test/api/teams/webhooks/recordings', {
      method: 'POST',
      body: JSON.stringify({
        value: [
          {
            subscriptionId: 'sub-1',
            clientState: 'teams-online-meeting-artifacts:tenant-1:recordings',
            resourceData: {
              '@odata.id': "communications/onlineMeetings('meeting-1')/recordings('rec-1')",
            },
          },
        ],
      }),
    }));

    expect(webhookResponse.status).toBe(202);
    expect(scheduleImmediateJobMock).toHaveBeenCalledWith('process-teams-meeting-artifact-notification', {
      tenantId: 'tenant-1',
      notification: expect.objectContaining({ subscriptionId: 'sub-1' }),
    });
  });
});
