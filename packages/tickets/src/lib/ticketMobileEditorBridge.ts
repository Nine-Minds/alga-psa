import { z } from 'zod';
import type {
  TicketMobileEditorCommand,
  TicketMobileEditorInitPayload,
  TicketMobileEditorNativeToWebMessage,
  TicketMobileEditorRequest,
  TicketMobileEditorStatePayload,
  TicketMobileEditorWebToNativeMessage,
  TicketMobileRichTextDocument,
} from './ticketRichText';

const ticketMobileEditorCommandSchema = z.enum([
  'focus',
  'blur',
  'set-content',
  'set-editable',
  'toggle-bold',
  'toggle-italic',
  'toggle-underline',
  'toggle-bullet-list',
  'toggle-ordered-list',
  'undo',
  'redo',
]);

const ticketMobileEditorRequestSchema = z.enum(['get-html', 'get-json']);

const ticketMobileEditorInitPayloadSchema = z.object({
  content: z.string().nullish(),
  editable: z.boolean(),
  autofocus: z.boolean().optional(),
  placeholder: z.string().optional(),
  debounceMs: z.number().int().positive().optional(),
});

const ticketMobileEditorToolbarStateSchema = z.object({
  bold: z.boolean(),
  italic: z.boolean(),
  underline: z.boolean(),
  bulletList: z.boolean(),
  orderedList: z.boolean(),
});

const ticketMobileEditorStatePayloadSchema = z.object({
  ready: z.boolean(),
  focused: z.boolean(),
  editable: z.boolean(),
  toolbar: ticketMobileEditorToolbarStateSchema,
  canUndo: z.boolean(),
  canRedo: z.boolean(),
});

const nativeToWebMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('init'),
    payload: ticketMobileEditorInitPayloadSchema,
  }),
  z.object({
    type: z.literal('command'),
    payload: z.object({
      command: ticketMobileEditorCommandSchema,
      value: z.unknown().optional(),
    }),
  }),
  z.object({
    type: z.literal('request'),
    payload: z.object({
      requestId: z.string().min(1),
      request: ticketMobileEditorRequestSchema,
    }),
  }),
]);

const webToNativeMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('editor-ready'),
    payload: z.object({
      format: z.enum(['blocknote', 'prosemirror']),
      editable: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal('state-change'),
    payload: ticketMobileEditorStatePayloadSchema,
  }),
  z.object({
    type: z.literal('content-change'),
    payload: z.object({
      html: z.string(),
      json: z.unknown(),
    }),
  }),
  z.object({
    type: z.literal('content-height'),
    payload: z.object({
      height: z.number(),
    }),
  }),
  z.object({
    type: z.literal('response'),
    payload: z.object({
      requestId: z.string().min(1),
      request: ticketMobileEditorRequestSchema,
      value: z.unknown(),
    }),
  }),
  z.object({
    type: z.literal('error'),
    payload: z.object({
      code: z.string().min(1),
      message: z.string().min(1),
      requestId: z.string().min(1).optional(),
    }),
  }),
]);

function decodeMessage(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    return raw;
  }

  return JSON.parse(raw) as unknown;
}

export function parseTicketMobileEditorNativeToWebMessage(
  raw: unknown
): TicketMobileEditorNativeToWebMessage {
  return nativeToWebMessageSchema.parse(decodeMessage(raw)) as TicketMobileEditorNativeToWebMessage;
}

export function parseTicketMobileEditorWebToNativeMessage(
  raw: unknown
): TicketMobileEditorWebToNativeMessage {
  return webToNativeMessageSchema.parse(decodeMessage(raw)) as TicketMobileEditorWebToNativeMessage;
}

export function serializeTicketMobileEditorMessage(
  message: TicketMobileEditorNativeToWebMessage | TicketMobileEditorWebToNativeMessage
): string {
  return JSON.stringify(message);
}

type TimerId = ReturnType<typeof setTimeout>;

type PendingRequest<T> = {
  expected: TicketMobileEditorRequest;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeoutId: TimerId;
};

export type TicketMobileEditorBridgeClientOptions = {
  postMessage: (message: string) => void;
  requestTimeoutMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  onReady?: (payload: { format: 'blocknote' | 'prosemirror'; editable: boolean }) => void;
  onStateChange?: (payload: TicketMobileEditorStatePayload) => void;
  onContentChange?: (payload: { html: string; json: unknown }) => void;
  onError?: (payload: { code: string; message: string; requestId?: string }) => void;
};

export class TicketMobileEditorBridgeClient {
  private readonly requestTimeoutMs: number;

  private readonly postMessage: (message: string) => void;

  private readonly setTimeoutFn: typeof setTimeout;

  private readonly clearTimeoutFn: typeof clearTimeout;

  private readonly pendingRequests = new Map<string, PendingRequest<unknown>>();

  private requestCounter = 0;

  private readonly onReady?: TicketMobileEditorBridgeClientOptions['onReady'];

  private readonly onStateChange?: TicketMobileEditorBridgeClientOptions['onStateChange'];

  private readonly onContentChange?: TicketMobileEditorBridgeClientOptions['onContentChange'];

  private readonly onError?: TicketMobileEditorBridgeClientOptions['onError'];

  constructor(options: TicketMobileEditorBridgeClientOptions) {
    this.postMessage = options.postMessage;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 1500;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
    this.onReady = options.onReady;
    this.onStateChange = options.onStateChange;
    this.onContentChange = options.onContentChange;
    this.onError = options.onError;
  }

  initialize(payload: TicketMobileEditorInitPayload): void {
    this.post({
      type: 'init',
      payload,
    });
  }

  sendCommand(
    command: TicketMobileEditorCommand,
    value?: string | boolean | TicketMobileRichTextDocument
  ): void {
    this.post({
      type: 'command',
      payload: {
        command,
        value,
      },
    });
  }

  getHTML(): Promise<string> {
    return this.sendRequest('get-html', (value) => {
      if (typeof value !== 'string') {
        throw new Error('Ticket mobile editor get-html response must be a string');
      }

      return value;
    });
  }

  getJSON<T = unknown>(): Promise<T> {
    return this.sendRequest('get-json', (value) => value as T);
  }

  handleMessage(raw: unknown): TicketMobileEditorWebToNativeMessage {
    const message = parseTicketMobileEditorWebToNativeMessage(raw);

    switch (message.type) {
      case 'editor-ready':
        this.onReady?.(message.payload);
        break;
      case 'state-change':
        this.onStateChange?.(message.payload);
        break;
      case 'content-change':
        this.onContentChange?.(message.payload);
        break;
      case 'response':
        this.resolvePendingRequest(message.payload.requestId, message.payload.request, message.payload.value);
        break;
      case 'error':
        this.rejectPendingRequest(message.payload.requestId, message.payload.message);
        this.onError?.(message.payload);
        break;
    }

    return message;
  }

  destroy(): void {
    for (const [requestId, pendingRequest] of this.pendingRequests.entries()) {
      this.clearTimeoutFn(pendingRequest.timeoutId);
      pendingRequest.reject(new Error(`Ticket mobile editor request cancelled: ${pendingRequest.expected}`));
      this.pendingRequests.delete(requestId);
    }
  }

  private sendRequest<T>(
    request: TicketMobileEditorRequest,
    mapValue: (value: unknown) => T
  ): Promise<T> {
    const requestId = `ticket-mobile-editor-${++this.requestCounter}`;

    return new Promise<T>((resolve, reject) => {
      const timeoutId = this.setTimeoutFn(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Ticket mobile editor request timed out: ${request}`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(requestId, {
        expected: request,
        resolve: (value) => {
          try {
            resolve(mapValue(value));
          } catch (error) {
            reject(error instanceof Error ? error : new Error('Invalid editor response'));
          }
        },
        reject,
        timeoutId,
      });

      this.post({
        type: 'request',
        payload: {
          requestId,
          request,
        },
      });
    });
  }

  private post(message: TicketMobileEditorNativeToWebMessage): void {
    this.postMessage(serializeTicketMobileEditorMessage(message));
  }

  private resolvePendingRequest(
    requestId: string,
    request: TicketMobileEditorRequest,
    value: unknown
  ): void {
    const pendingRequest = this.pendingRequests.get(requestId);
    if (!pendingRequest) {
      return;
    }

    this.pendingRequests.delete(requestId);
    this.clearTimeoutFn(pendingRequest.timeoutId);

    if (pendingRequest.expected !== request) {
      pendingRequest.reject(
        new Error(
          `Ticket mobile editor response mismatch for ${requestId}: expected ${pendingRequest.expected}, received ${request}`
        )
      );
      return;
    }

    pendingRequest.resolve(value);
  }

  private rejectPendingRequest(requestId: string | undefined, message: string): void {
    if (!requestId) {
      return;
    }

    const pendingRequest = this.pendingRequests.get(requestId);
    if (!pendingRequest) {
      return;
    }

    this.pendingRequests.delete(requestId);
    this.clearTimeoutFn(pendingRequest.timeoutId);
    pendingRequest.reject(new Error(message));
  }
}
