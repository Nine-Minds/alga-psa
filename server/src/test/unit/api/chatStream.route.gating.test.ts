import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const isExperimentalFeatureEnabledMock = vi.hoisted(() => vi.fn<
  (featureKey: string) => Promise<boolean>
>());

const handleTitleStreamMock = vi.hoisted(() => vi.fn<
  (req: Request) => Promise<Response>
>());

const handleChatStreamMock = vi.hoisted(() => vi.fn<
  (req: Request) => Promise<Response>
>());

vi.mock('@alga-psa/tenancy/actions', () => ({
  isExperimentalFeatureEnabled: isExperimentalFeatureEnabledMock,
}));

vi.mock('@product/chat/entry', () => ({
  ChatStreamService: {
    handleTitleStream: handleTitleStreamMock,
    handleChatStream: handleChatStreamMock,
  },
}));

describe('POST /api/chat/stream/*', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    isExperimentalFeatureEnabledMock.mockReset();
    handleTitleStreamMock.mockReset();
    handleChatStreamMock.mockReset();
    process.env.EDITION = 'enterprise';
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

  it('returns 403 for /api/chat/stream/title when aiAssistant is disabled', async () => {
    isExperimentalFeatureEnabledMock.mockResolvedValue(false);

    vi.resetModules();
    const { POST } = await import('@/app/api/chat/stream/title/route');

    const request = new NextRequest(
      new Request('http://example.com/api/chat/stream/title', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputs: [{ role: 'user', content: 'Hello' }] }),
      }),
    );

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({
      error: 'AI Assistant is not enabled for this tenant',
    });
    expect(isExperimentalFeatureEnabledMock).toHaveBeenCalledWith('aiAssistant');
    expect(handleTitleStreamMock).not.toHaveBeenCalled();
  });

  it('returns 403 for /api/chat/stream/[...slug] when aiAssistant is disabled', async () => {
    isExperimentalFeatureEnabledMock.mockResolvedValue(false);

    vi.resetModules();
    const { POST } = await import('@/app/api/chat/stream/[...slug]/route');

    const request = new NextRequest(
      new Request('http://example.com/api/chat/stream/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputs: [{ role: 'user', content: 'Hello' }] }),
      }),
    );

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({
      error: 'AI Assistant is not enabled for this tenant',
    });
    expect(isExperimentalFeatureEnabledMock).toHaveBeenCalledWith('aiAssistant');
    expect(handleChatStreamMock).not.toHaveBeenCalled();
  });
});

