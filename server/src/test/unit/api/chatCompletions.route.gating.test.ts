import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const isExperimentalFeatureEnabledMock = vi.hoisted(() => vi.fn<
  (featureKey: string) => Promise<boolean>
>());

const chatCompletionsHandleRequestMock = vi.hoisted(() => vi.fn<
  (req: Request) => Promise<Response>
>());

vi.mock('@alga-psa/tenancy/actions', () => ({
  isExperimentalFeatureEnabled: isExperimentalFeatureEnabledMock,
}));

vi.mock('@product/chat/entry', () => ({
  ChatCompletionsService: {
    handleRequest: chatCompletionsHandleRequestMock,
  },
}));

describe('POST /api/chat/v1/completions', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    isExperimentalFeatureEnabledMock.mockReset();
    chatCompletionsHandleRequestMock.mockReset();
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

  it('returns 200 when aiAssistant is enabled', async () => {
    isExperimentalFeatureEnabledMock.mockResolvedValue(true);
    chatCompletionsHandleRequestMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

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

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(isExperimentalFeatureEnabledMock).toHaveBeenCalledWith('aiAssistant');
    expect(chatCompletionsHandleRequestMock).toHaveBeenCalledWith(request);
  });
});
