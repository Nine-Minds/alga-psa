import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const isExperimentalFeatureEnabledMock = vi.hoisted(() =>
  vi.fn<(featureKey: string) => Promise<boolean>>(),
);

const createRawCompletionStreamMock = vi.hoisted(() =>
  vi.fn<
    (conversation: Array<{ role: string; content?: string }>) => Promise<AsyncIterable<unknown>>
  >(),
);

vi.mock('@alga-psa/tenancy/actions', () => ({
  isExperimentalFeatureEnabled: isExperimentalFeatureEnabledMock,
}));

vi.mock('@product/chat/entry', () => ({
  ChatCompletionsService: {
    createRawCompletionStream: createRawCompletionStreamMock,
  },
}));

describe('POST /api/chat/v1/completions/stream', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    isExperimentalFeatureEnabledMock.mockReset();
    createRawCompletionStreamMock.mockReset();
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

  it('exports POST and accepts a valid POST request', async () => {
    isExperimentalFeatureEnabledMock.mockResolvedValue(true);
    createRawCompletionStreamMock.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: 'Hello' } }] };
      })(),
    );

    vi.resetModules();
    const mod = await import('@/app/api/chat/v1/completions/stream/route');

    expect(typeof mod.POST).toBe('function');

    const request = new NextRequest(
      new Request('http://example.com/api/chat/v1/completions/stream', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
      }),
    );

    const response = await mod.POST(request);

    expect(response.status).toBe(200);

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    while (true) {
      const { done } = await reader!.read();
      if (done) {
        break;
      }
    }

    expect(isExperimentalFeatureEnabledMock).toHaveBeenCalledWith('aiAssistant');
    expect(createRawCompletionStreamMock).toHaveBeenCalledTimes(1);
  });

  it('returns Content-Type: text/event-stream', async () => {
    isExperimentalFeatureEnabledMock.mockResolvedValue(true);
    createRawCompletionStreamMock.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: 'Hello' } }] };
      })(),
    );

    vi.resetModules();
    const mod = await import('@/app/api/chat/v1/completions/stream/route');

    const request = new NextRequest(
      new Request('http://example.com/api/chat/v1/completions/stream', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
      }),
    );

    const response = await mod.POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/event-stream\b/i);

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    while (true) {
      const { done } = await reader!.read();
      if (done) {
        break;
      }
    }
  });

  it('streams SSE chunks with data: prefix', async () => {
    isExperimentalFeatureEnabledMock.mockResolvedValue(true);
    createRawCompletionStreamMock.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: 'Hel' } }] };
        yield { choices: [{ delta: { content: 'lo' } }] };
      })(),
    );

    vi.resetModules();
    const mod = await import('@/app/api/chat/v1/completions/stream/route');

    const request = new NextRequest(
      new Request('http://example.com/api/chat/v1/completions/stream', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
      }),
    );

    const response = await mod.POST(request);

    expect(response.status).toBe(200);

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();
    let output = '';

    while (true) {
      const { done, value } = await reader!.read();
      if (done) {
        break;
      }
      if (value) {
        output += decoder.decode(value, { stream: true });
      }
    }
    output += decoder.decode();

    const events = output
      .split('\n\n')
      .map((event) => event.trim())
      .filter(Boolean);

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.startsWith('data: ')).toBe(true);
    }
  });

  it('streams SSE chunks containing JSON with content and done fields', async () => {
    isExperimentalFeatureEnabledMock.mockResolvedValue(true);
    createRawCompletionStreamMock.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: 'Hel' } }] };
        yield { choices: [{ delta: { content: 'lo' } }] };
      })(),
    );

    vi.resetModules();
    const mod = await import('@/app/api/chat/v1/completions/stream/route');

    const request = new NextRequest(
      new Request('http://example.com/api/chat/v1/completions/stream', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
      }),
    );

    const response = await mod.POST(request);

    expect(response.status).toBe(200);

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();
    let output = '';

    while (true) {
      const { done, value } = await reader!.read();
      if (done) {
        break;
      }
      if (value) {
        output += decoder.decode(value, { stream: true });
      }
    }
    output += decoder.decode();

    const events = output
      .split('\n\n')
      .map((event) => event.trim())
      .filter(Boolean);

    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      expect(event.startsWith('data: ')).toBe(true);
      const payload = JSON.parse(event.slice('data: '.length)) as unknown;
      expect(payload).toMatchObject({
        content: expect.any(String),
        done: expect.any(Boolean),
      });
    }
  });

  it('ends with a final SSE message containing done: true', async () => {
    isExperimentalFeatureEnabledMock.mockResolvedValue(true);
    createRawCompletionStreamMock.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: 'Hel' } }] };
        yield { choices: [{ delta: { content: 'lo' } }] };
      })(),
    );

    vi.resetModules();
    const mod = await import('@/app/api/chat/v1/completions/stream/route');

    const request = new NextRequest(
      new Request('http://example.com/api/chat/v1/completions/stream', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
      }),
    );

    const response = await mod.POST(request);

    expect(response.status).toBe(200);

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();
    let output = '';

    while (true) {
      const { done, value } = await reader!.read();
      if (done) {
        break;
      }
      if (value) {
        output += decoder.decode(value, { stream: true });
      }
    }
    output += decoder.decode();

    const events = output
      .split('\n\n')
      .map((event) => event.trim())
      .filter(Boolean);

    expect(events.length).toBeGreaterThanOrEqual(3);

    const payloads = events.map((event) => {
      expect(event.startsWith('data: ')).toBe(true);
      return JSON.parse(event.slice('data: '.length)) as { content: string; done: boolean };
    });

    for (const payload of payloads.slice(0, -1)) {
      expect(payload).toMatchObject({ done: false });
      expect(payload.content.length).toBeGreaterThan(0);
    }

    expect(payloads[payloads.length - 1]).toEqual({ content: '', done: true });
  });
});
