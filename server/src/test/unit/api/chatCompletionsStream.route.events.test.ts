import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const isExperimentalFeatureEnabledMock = vi.hoisted(() =>
  vi.fn<(featureKey: string) => Promise<boolean>>(),
);

const createStructuredCompletionStreamMock = vi.hoisted(() =>
  vi.fn<
    (
      conversation: Array<Record<string, unknown>>,
      options?: { signal?: AbortSignal },
    ) => Promise<AsyncIterable<Record<string, unknown>>>
  >(),
);

vi.mock('@alga-psa/tenancy/actions', () => ({
  isExperimentalFeatureEnabled: isExperimentalFeatureEnabledMock,
}));

vi.mock('@product/chat/entry', () => ({
  ChatCompletionsService: {
    createStructuredCompletionStream: createStructuredCompletionStreamMock,
  },
}));

const makeRequest = (body: unknown, signal?: AbortSignal) =>
  new NextRequest(
    new Request('http://example.com/api/chat/v1/completions/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    }),
  );

const readSsePayloads = async (response: Response) => {
  const raw = await response.text();
  return raw
    .split('\n\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      expect(line.startsWith('data: ')).toBe(true);
      return JSON.parse(line.slice('data: '.length)) as Record<string, unknown>;
    });
};

describe('POST /api/chat/v1/completions/stream (structured events)', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    isExperimentalFeatureEnabledMock.mockReset();
    createStructuredCompletionStreamMock.mockReset();
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

  it('accepts assistant reasoning_content in stream request validation', async () => {
    isExperimentalFeatureEnabledMock.mockResolvedValue(true);
    createStructuredCompletionStreamMock.mockResolvedValue(
      (async function* () {
        yield { type: 'done' };
      })(),
    );

    vi.resetModules();
    const { POST } = await import('@/app/api/chat/v1/completions/stream/route');

    const response = await POST(
      makeRequest({
        messages: [
          {
            role: 'assistant',
            content: 'Interim state',
            reasoning_content: 'carry this reasoning',
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    await response.text();
    expect(createStructuredCompletionStreamMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          role: 'assistant',
          reasoning_content: 'carry this reasoning',
        }),
      ],
      expect.any(Object),
    );
  });

  it('emits structured reasoning-delta SSE events', async () => {
    isExperimentalFeatureEnabledMock.mockResolvedValue(true);
    createStructuredCompletionStreamMock.mockResolvedValue(
      (async function* () {
        yield { type: 'reasoning_delta', delta: 'Step 1' };
        yield { type: 'done' };
      })(),
    );

    vi.resetModules();
    const { POST } = await import('@/app/api/chat/v1/completions/stream/route');

    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'Explain your steps' }],
      }),
    );

    expect(response.status).toBe(200);
    const payloads = await readSsePayloads(response);

    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'reasoning_delta',
          delta: 'Step 1',
        }),
      ]),
    );
  });

  it('emits structured content-delta SSE events', async () => {
    isExperimentalFeatureEnabledMock.mockResolvedValue(true);
    createStructuredCompletionStreamMock.mockResolvedValue(
      (async function* () {
        yield { type: 'content_delta', delta: 'Hel' };
        yield { type: 'content_delta', delta: 'lo' };
        yield { type: 'done' };
      })(),
    );

    vi.resetModules();
    const { POST } = await import('@/app/api/chat/v1/completions/stream/route');

    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'say hello' }],
      }),
    );

    expect(response.status).toBe(200);
    const payloads = await readSsePayloads(response);

    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'content_delta',
          delta: 'Hel',
          content: 'Hel',
          done: false,
        }),
        expect.objectContaining({
          type: 'content_delta',
          delta: 'lo',
          content: 'lo',
          done: false,
        }),
      ]),
    );
  });

  it('emits function-proposal SSE events when model chooses a tool call', async () => {
    isExperimentalFeatureEnabledMock.mockResolvedValue(true);
    createStructuredCompletionStreamMock.mockResolvedValue(
      (async function* () {
        yield {
          type: 'function_proposed',
          function: {
            id: 'tickets.list',
            displayName: 'List tickets',
            approvalRequired: true,
            arguments: { entryId: 'tickets.list' },
          },
          assistantPreview: 'I need to list tickets first.',
          assistantReasoning: 'Collect context',
          functionCall: {
            name: 'call_api_endpoint',
            arguments: { entryId: 'tickets.list' },
            toolCallId: 'tool-call-1',
            entryId: 'tickets.list',
          },
          nextMessages: [{ role: 'assistant', content: 'I need to list tickets first.' }],
          modelMessages: [{ role: 'assistant', content: 'I need to list tickets first.' }],
        };
        yield { type: 'done' };
      })(),
    );

    vi.resetModules();
    const { POST } = await import('@/app/api/chat/v1/completions/stream/route');

    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'List tickets' }],
      }),
    );

    expect(response.status).toBe(200);
    const payloads = await readSsePayloads(response);

    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function_proposed',
          functionCall: expect.objectContaining({
            name: 'call_api_endpoint',
            toolCallId: 'tool-call-1',
          }),
        }),
      ]),
    );
  });

  it('emits terminal done event after successful completion', async () => {
    isExperimentalFeatureEnabledMock.mockResolvedValue(true);
    createStructuredCompletionStreamMock.mockResolvedValue(
      (async function* () {
        yield { type: 'content_delta', delta: 'Final response' };
        yield { type: 'done' };
      })(),
    );

    vi.resetModules();
    const { POST } = await import('@/app/api/chat/v1/completions/stream/route');

    const response = await POST(
      makeRequest({
        messages: [{ role: 'user', content: 'done?' }],
      }),
    );

    expect(response.status).toBe(200);
    const payloads = await readSsePayloads(response);
    const lastPayload = payloads[payloads.length - 1];

    expect(lastPayload).toMatchObject({
      type: 'done',
      content: '',
      done: true,
    });
  });

  it('stops stream emission cleanly when request signal is aborted', async () => {
    isExperimentalFeatureEnabledMock.mockResolvedValue(true);
    createStructuredCompletionStreamMock.mockResolvedValue(
      (async function* () {
        yield { type: 'content_delta', delta: 'first' };
        await new Promise((resolve) => setTimeout(resolve, 50));
        yield { type: 'content_delta', delta: 'second' };
        yield { type: 'done' };
      })(),
    );

    const abortController = new AbortController();

    vi.resetModules();
    const { POST } = await import('@/app/api/chat/v1/completions/stream/route');

    const response = await POST(
      makeRequest(
        {
          messages: [{ role: 'user', content: 'stream then abort' }],
        },
        abortController.signal,
      ),
    );

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();
    let output = '';

    const firstChunk = await reader!.read();
    if (firstChunk.value) {
      output += decoder.decode(firstChunk.value, { stream: true });
    }

    abortController.abort();

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

    expect(output).toContain('"delta":"first"');
    expect(output).not.toContain('"delta":"second"');
  });

  it('returns 400 for malformed messages payload', async () => {
    isExperimentalFeatureEnabledMock.mockResolvedValue(true);

    vi.resetModules();
    const { POST } = await import('@/app/api/chat/v1/completions/stream/route');

    const response = await POST(
      makeRequest({
        messages: [
          {
            role: 'assistant',
            content: 'bad reasoning',
            reasoning_content: 123,
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid messages payload',
    });
    expect(createStructuredCompletionStreamMock).not.toHaveBeenCalled();
  });

  it('preserves aiAssistant gating semantics on stream endpoint', async () => {
    isExperimentalFeatureEnabledMock.mockResolvedValue(false);

    vi.resetModules();
    const { POST } = await import('@/app/api/chat/v1/completions/stream/route');

    const response = await POST(
      makeRequest({ messages: [{ role: 'user', content: 'Hello' }] }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: 'AI Assistant is not enabled for this tenant',
    });
  });

  it('preserves enterprise-edition gating semantics on stream endpoint', async () => {
    process.env.EDITION = 'ce';
    process.env.NEXT_PUBLIC_EDITION = 'ce';

    vi.resetModules();
    const { POST } = await import('@/app/api/chat/v1/completions/stream/route');

    const response = await POST(
      makeRequest({ messages: [{ role: 'user', content: 'Hello' }] }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Chat completions are only available in Enterprise Edition',
    });
    expect(isExperimentalFeatureEnabledMock).not.toHaveBeenCalled();
  });
});
