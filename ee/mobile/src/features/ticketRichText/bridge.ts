import type {
  TicketMobileEditorCommand,
  TicketMobileEditorInitPayload,
  TicketMobileEditorMentionPayload,
  TicketMobileEditorMentionQueryPayload,
  TicketMobileEditorNativeToWebMessage,
  TicketMobileEditorRequest,
  TicketMobileEditorStatePayload,
  TicketMobileEditorWebToNativeMessage,
} from "./types";

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
  onReady?: (payload: { format: "blocknote" | "prosemirror"; editable: boolean }) => void;
  onStateChange?: (payload: TicketMobileEditorStatePayload) => void;
  onContentChange?: (payload: { html: string; json: unknown }) => void;
  onContentHeight?: (payload: { height: number }) => void;
  onError?: (payload: { code: string; message: string; requestId?: string }) => void;
  onImageRequest?: (payload: { src: string }) => void;
  onMentionQuery?: (payload: TicketMobileEditorMentionQueryPayload) => void;
};

function decodeMessage(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return raw;
  }

  return JSON.parse(raw);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function serializeTicketMobileEditorMessage(
  message: TicketMobileEditorNativeToWebMessage | TicketMobileEditorWebToNativeMessage,
): string {
  return JSON.stringify(message);
}

export function parseTicketMobileEditorWebToNativeMessage(
  raw: unknown,
): TicketMobileEditorWebToNativeMessage {
  const decoded = decodeMessage(raw);
  if (!isObject(decoded) || typeof decoded.type !== "string" || !isObject(decoded.payload)) {
    throw new Error("Invalid editor bridge message");
  }

  switch (decoded.type) {
    case "editor-ready":
    case "state-change":
    case "content-change":
    case "content-height":
    case "response":
    case "error":
    case "image-request":
    case "mention-query":
      return decoded as TicketMobileEditorWebToNativeMessage;
    default:
      throw new Error(`Unknown editor bridge message type: ${decoded.type}`);
  }
}

export class TicketMobileEditorBridgeClient {
  private readonly requestTimeoutMs: number;

  private readonly postMessage: (message: string) => void;

  private readonly setTimeoutFn: typeof setTimeout;

  private readonly clearTimeoutFn: typeof clearTimeout;

  private readonly pendingRequests = new Map<string, PendingRequest<unknown>>();

  private requestCounter = 0;

  private readonly onReady?: TicketMobileEditorBridgeClientOptions["onReady"];

  private readonly onStateChange?: TicketMobileEditorBridgeClientOptions["onStateChange"];

  private readonly onContentChange?: TicketMobileEditorBridgeClientOptions["onContentChange"];

  private readonly onContentHeight?: TicketMobileEditorBridgeClientOptions["onContentHeight"];

  private readonly onError?: TicketMobileEditorBridgeClientOptions["onError"];

  private readonly onImageRequest?: TicketMobileEditorBridgeClientOptions["onImageRequest"];

  private readonly onMentionQuery?: TicketMobileEditorBridgeClientOptions["onMentionQuery"];

  constructor(options: TicketMobileEditorBridgeClientOptions) {
    this.postMessage = options.postMessage;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 1500;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
    this.onReady = options.onReady;
    this.onStateChange = options.onStateChange;
    this.onContentChange = options.onContentChange;
    this.onContentHeight = options.onContentHeight;
    this.onError = options.onError;
    this.onImageRequest = options.onImageRequest;
    this.onMentionQuery = options.onMentionQuery;
  }

  initialize(payload: TicketMobileEditorInitPayload): void {
    this.post({
      type: "init",
      payload,
    });
  }

  sendImageData(src: string, dataUri: string): void {
    this.post({
      type: "image-data",
      payload: { src, dataUri },
    });
  }

  sendInsertMention(payload: TicketMobileEditorMentionPayload): void {
    this.post({
      type: "command",
      payload: {
        command: "insert-mention",
        value: payload,
      },
    });
  }

  sendCommand(command: TicketMobileEditorCommand, value?: string | boolean): void {
    this.post({
      type: "command",
      payload: {
        command,
        value,
      },
    });
  }

  getHTML(): Promise<string> {
    return this.sendRequest("get-html", (value) => {
      if (typeof value !== "string") {
        throw new Error("Ticket mobile editor get-html response must be a string");
      }

      return value;
    });
  }

  getJSON<T = unknown>(): Promise<T> {
    return this.sendRequest("get-json", (value) => value as T);
  }

  handleMessage(raw: unknown): TicketMobileEditorWebToNativeMessage {
    const message = parseTicketMobileEditorWebToNativeMessage(raw);

    switch (message.type) {
      case "editor-ready":
        this.onReady?.(message.payload);
        break;
      case "state-change":
        this.onStateChange?.(message.payload);
        break;
      case "content-change":
        this.onContentChange?.(message.payload);
        break;
      case "content-height":
        this.onContentHeight?.(message.payload);
        break;
      case "response":
        this.resolvePendingRequest(message.payload.requestId, message.payload.request, message.payload.value);
        break;
      case "error":
        this.rejectPendingRequest(message.payload.requestId, message.payload.message);
        this.onError?.(message.payload);
        break;
      case "image-request":
        this.onImageRequest?.(message.payload);
        break;
      case "mention-query":
        this.onMentionQuery?.(message.payload);
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
    mapValue: (value: unknown) => T,
  ): Promise<T> {
    const requestId = `ticket-mobile-editor-${++this.requestCounter}`;

    return new Promise<T>((resolve, reject) => {
      const timeoutId = this.setTimeoutFn(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Ticket mobile editor request timed out: ${request}`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(requestId, {
        expected: request,
        resolve(value) {
          try {
            resolve(mapValue(value));
          } catch (error) {
            reject(error instanceof Error ? error : new Error("Invalid editor response"));
          }
        },
        reject,
        timeoutId,
      });

      this.post({
        type: "request",
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
    value: unknown,
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
          `Ticket mobile editor response mismatch for ${requestId}: expected ${pendingRequest.expected}, received ${request}`,
        ),
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
