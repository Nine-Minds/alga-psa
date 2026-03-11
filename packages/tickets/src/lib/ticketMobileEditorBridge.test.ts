import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TicketMobileEditorBridgeClient,
  parseTicketMobileEditorNativeToWebMessage,
  parseTicketMobileEditorWebToNativeMessage,
} from './ticketMobileEditorBridge';

describe('ticketMobileEditorBridge validators', () => {
  it('accepts known native-to-web message shapes and rejects malformed payloads', () => {
    expect(
      parseTicketMobileEditorNativeToWebMessage({
        type: 'init',
        payload: {
          content: '{"type":"doc","content":[{"type":"paragraph"}]}',
          editable: true,
          debounceMs: 250,
        },
      })
    ).toEqual({
      type: 'init',
      payload: {
        content: '{"type":"doc","content":[{"type":"paragraph"}]}',
        editable: true,
        debounceMs: 250,
      },
    });

    expect(
      parseTicketMobileEditorNativeToWebMessage(
        JSON.stringify({
          type: 'request',
          payload: {
            requestId: 'req-1',
            request: 'get-html',
          },
        })
      )
    ).toEqual({
      type: 'request',
      payload: {
        requestId: 'req-1',
        request: 'get-html',
      },
    });

    expect(() =>
      parseTicketMobileEditorNativeToWebMessage({
        type: 'command',
        payload: {
          command: 'toggle-strikethrough',
        },
      })
    ).toThrow();

    expect(() =>
      parseTicketMobileEditorNativeToWebMessage({
        type: 'request',
        payload: {
          request: 'get-json',
        },
      })
    ).toThrow();
  });

  it('accepts known web-to-native message shapes and rejects malformed payloads', () => {
    expect(
      parseTicketMobileEditorWebToNativeMessage({
        type: 'state-change',
        payload: {
          ready: true,
          focused: false,
          editable: true,
          toolbar: {
            bold: false,
            italic: false,
            underline: false,
            bulletList: false,
            orderedList: false,
          },
          canUndo: false,
          canRedo: false,
        },
      })
    ).toEqual({
      type: 'state-change',
      payload: {
        ready: true,
        focused: false,
        editable: true,
        toolbar: {
          bold: false,
          italic: false,
          underline: false,
          bulletList: false,
          orderedList: false,
        },
        canUndo: false,
        canRedo: false,
      },
    });

    expect(
      parseTicketMobileEditorWebToNativeMessage(
        JSON.stringify({
          type: 'response',
          payload: {
            requestId: 'req-2',
            request: 'get-json',
            value: { type: 'doc', content: [] },
          },
        })
      )
    ).toEqual({
      type: 'response',
      payload: {
        requestId: 'req-2',
        request: 'get-json',
        value: { type: 'doc', content: [] },
      },
    });

    expect(() =>
      parseTicketMobileEditorWebToNativeMessage({
        type: 'editor-ready',
        payload: {
          format: 'html',
          editable: true,
        },
      })
    ).toThrow();

    expect(() =>
      parseTicketMobileEditorWebToNativeMessage({
        type: 'error',
        payload: {
          code: '',
          message: 'missing code',
        },
      })
    ).toThrow();
  });
});

describe('TicketMobileEditorBridgeClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves getHTML with the matching request id', async () => {
    const postMessage = vi.fn();
    const bridge = new TicketMobileEditorBridgeClient({
      postMessage,
      requestTimeoutMs: 500,
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout,
    });

    const htmlPromise = bridge.getHTML();

    expect(postMessage).toHaveBeenCalledTimes(1);
    const outbound = JSON.parse(postMessage.mock.calls[0][0]) as {
      payload: { requestId: string; request: string };
    };

    bridge.handleMessage({
      type: 'response',
      payload: {
        requestId: outbound.payload.requestId,
        request: 'get-html',
        value: '<p>Hello mobile</p>',
      },
    });

    await expect(htmlPromise).resolves.toBe('<p>Hello mobile</p>');
  });

  it('resolves getJSON with the matching request id', async () => {
    const postMessage = vi.fn();
    const bridge = new TicketMobileEditorBridgeClient({
      postMessage,
      requestTimeoutMs: 500,
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout,
    });

    const jsonPromise = bridge.getJSON<{ type: 'doc'; content: Array<{ type: string }> }>();

    const outbound = JSON.parse(postMessage.mock.calls[0][0]) as {
      payload: { requestId: string; request: string };
    };

    bridge.handleMessage({
      type: 'response',
      payload: {
        requestId: outbound.payload.requestId,
        request: 'get-json',
        value: {
          type: 'doc',
          content: [{ type: 'paragraph' }],
        },
      },
    });

    await expect(jsonPromise).resolves.toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
  });

  it('times out cleanly when the runtime does not respond', async () => {
    const bridge = new TicketMobileEditorBridgeClient({
      postMessage: vi.fn(),
      requestTimeoutMs: 500,
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout,
    });

    const htmlPromise = bridge.getHTML();
    const assertion = expect(htmlPromise).rejects.toThrow(
      'Ticket mobile editor request timed out: get-html'
    );

    await vi.advanceTimersByTimeAsync(500);

    await assertion;
  });
});
