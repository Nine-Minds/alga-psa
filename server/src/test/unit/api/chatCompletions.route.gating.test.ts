import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const isExperimentalFeatureEnabledMock = vi.hoisted(() => vi.fn<
  (featureKey: string) => Promise<boolean>
>());

vi.mock('@alga-psa/tenancy/actions', () => ({
  isExperimentalFeatureEnabled: isExperimentalFeatureEnabledMock,
}));

describe('POST /api/chat/v1/completions', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    isExperimentalFeatureEnabledMock.mockReset();
    process.env.EDITION = 'ee';
    delete process.env.NEXT_PUBLIC_EDITION;
  });

  afterEach(() => {
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

    vi.restoreAllMocks();
  });

  it('returns 403 when aiAssistant is disabled', async () => {
    isExperimentalFeatureEnabledMock.mockResolvedValue(false);

    vi.resetModules();
    const { POST } = await import('@/app/api/chat/v1/completions/route');

    const request = new NextRequest(
      new Request('http://example.com/api/chat/v1/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
      }),
    );

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({
      error: 'AI Assistant is not enabled for this tenant',
    });
    expect(isExperimentalFeatureEnabledMock).toHaveBeenCalledWith('aiAssistant');
  });
});
