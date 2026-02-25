import { describe, expect, it, vi } from 'vitest';

import { readAssistantContentFromSse } from '@ee/components/chat/readAssistantContentFromSse';

describe('readAssistantContentFromSse()', () => {
  const createControlledSseResponse = () => {
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

    return {
      response,
      send: (payloadText: string) => {
        controller?.enqueue(encoder.encode(payloadText));
      },
      close: () => {
        controller?.close();
      },
    };
  };

  it('appends tokens incrementally as SSE chunks arrive', async () => {
    const sse = createControlledSseResponse();

    const tokens: Array<{ token: string; accumulated: string }> = [];

    const readPromise = readAssistantContentFromSse(sse.response, {
      onToken: (token, accumulated) => {
        tokens.push({ token, accumulated });
      },
    });

    sse.send('data: {"content":"Hel","done":false}\n\n');
    await Promise.resolve();
    expect(tokens).toEqual([{ token: 'Hel', accumulated: 'Hel' }]);

    sse.send('data: {"content":"lo","done":false}\n\n');
    await Promise.resolve();
    expect(tokens).toEqual([
      { token: 'Hel', accumulated: 'Hel' },
      { token: 'lo', accumulated: 'Hello' },
    ]);

    sse.send('data: {"content":"","done":true}\n\n');
    sse.close();

    await expect(readPromise).resolves.toEqual({ content: 'Hello', doneReceived: true });
  });

  it('invokes onReasoning callback for reasoning events', async () => {
    const sse = createControlledSseResponse();
    const reasoningTokens: Array<{ token: string; accumulated: string }> = [];

    const readPromise = readAssistantContentFromSse(sse.response, {
      onReasoning: (token, accumulated) => {
        reasoningTokens.push({ token, accumulated });
      },
    });

    sse.send('data: {"type":"reasoning_delta","delta":"Step 1"}\n\n');
    sse.send('data: {"type":"reasoning_delta","delta":" + Step 2"}\n\n');
    sse.send('data: {"type":"done","done":true}\n\n');
    sse.close();

    await expect(readPromise).resolves.toEqual({ content: '', doneReceived: true });
    expect(reasoningTokens).toEqual([
      { token: 'Step 1', accumulated: 'Step 1' },
      { token: ' + Step 2', accumulated: 'Step 1 + Step 2' },
    ]);
  });

  it('invokes onToolCalls callback for function proposal events', async () => {
    const sse = createControlledSseResponse();
    const proposals: Array<Record<string, unknown>> = [];

    const readPromise = readAssistantContentFromSse(sse.response, {
      onToolCalls: (proposal) => {
        proposals.push(proposal as unknown as Record<string, unknown>);
      },
    });

    sse.send(
      `data: ${JSON.stringify({
        type: 'function_proposed',
        function: {
          id: 'tickets.list',
          displayName: 'List tickets',
          approvalRequired: true,
          arguments: { entryId: 'tickets.list' },
        },
        assistantPreview: 'I need to run an endpoint.',
        assistantReasoning: 'Collect context first',
        functionCall: {
          name: 'call_api_endpoint',
          arguments: { entryId: 'tickets.list' },
          toolCallId: 'tool-1',
          entryId: 'tickets.list',
        },
        nextMessages: [{ role: 'assistant', content: 'I need to run an endpoint.' }],
        modelMessages: [{ role: 'assistant', content: 'I need to run an endpoint.' }],
      })}\n\n`,
    );
    sse.send('data: {"type":"done","done":true}\n\n');
    sse.close();

    await expect(readPromise).resolves.toEqual({ content: '', doneReceived: true });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      type: 'function_proposed',
      functionCall: {
        name: 'call_api_endpoint',
        toolCallId: 'tool-1',
      },
    });
  });

  it('returns doneReceived=true when a typed done event arrives', async () => {
    const sse = createControlledSseResponse();

    const readPromise = readAssistantContentFromSse(sse.response);

    sse.send('data: {"type":"content_delta","delta":"Hi"}\n\n');
    sse.send('data: {"type":"done","done":true}\n\n');
    sse.close();

    await expect(readPromise).resolves.toEqual({ content: 'Hi', doneReceived: true });
  });

  it('ignores malformed JSON lines without crashing', async () => {
    const sse = createControlledSseResponse();

    const readPromise = readAssistantContentFromSse(sse.response);

    sse.send('data: {not-valid-json}\n\n');
    sse.send('data: {"type":"content_delta","delta":"Hello"}\n\n');
    sse.send('data: {"done":true}\n\n');
    sse.close();

    await expect(readPromise).resolves.toEqual({ content: 'Hello', doneReceived: true });
  });

  it('cancels underlying reader when shouldContinue returns false', async () => {
    const cancel = async () => {};
    const read = async () => ({ done: true, value: undefined });
    const cancelSpy = vi.fn(cancel);
    const readSpy = vi.fn(read);

    const response = {
      body: {
        getReader: () => ({
          read: readSpy,
          cancel: cancelSpy,
        }),
      },
    } as unknown as Response;

    const result = await readAssistantContentFromSse(response, {
      shouldContinue: () => false,
    });

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(readSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ content: '', doneReceived: false });
  });
});
