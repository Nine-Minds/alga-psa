import { describe, expect, it } from 'vitest';

import { readAssistantContentFromSse } from '@ee/components/chat/readAssistantContentFromSse';

describe('readAssistantContentFromSse()', () => {
  it('appends tokens incrementally as SSE chunks arrive', async () => {
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
      },
    });

    const response = new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
    });

    const tokens: Array<{ token: string; accumulated: string }> = [];

    const readPromise = readAssistantContentFromSse(response, {
      onToken: (token, accumulated) => {
        tokens.push({ token, accumulated });
      },
    });

    expect(controller).not.toBeNull();

    controller?.enqueue(encoder.encode('data: {"content":"Hel","done":false}\n\n'));
    await Promise.resolve();
    expect(tokens).toEqual([{ token: 'Hel', accumulated: 'Hel' }]);

    controller?.enqueue(encoder.encode('data: {"content":"lo","done":false}\n\n'));
    await Promise.resolve();
    expect(tokens).toEqual([
      { token: 'Hel', accumulated: 'Hel' },
      { token: 'lo', accumulated: 'Hello' },
    ]);

    controller?.enqueue(encoder.encode('data: {"content":"","done":true}\n\n'));
    controller?.close();

    await expect(readPromise).resolves.toEqual({ content: 'Hello', doneReceived: true });
  });
});

