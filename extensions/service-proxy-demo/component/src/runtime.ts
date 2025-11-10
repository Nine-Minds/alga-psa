function encodeUtf8(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i += 1) {
    let codePoint = str.charCodeAt(i);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      } else {
        codePoint = 0xfffd;
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

export function decodeUtf8(bytes?: Uint8Array | null): string {
  if (!bytes || bytes.length === 0) return '';

  let result = '';
  for (let i = 0; i < bytes.length; ) {
    const byte1 = bytes[i];
    let codePoint = 0xfffd;
    if (byte1 <= 0x7f) {
      codePoint = byte1;
      i += 1;
    } else if (byte1 >= 0xc2 && byte1 <= 0xdf && i + 1 < bytes.length) {
      const byte2 = bytes[i + 1];
      if ((byte2 & 0xc0) === 0x80) {
        codePoint = ((byte1 & 0x1f) << 6) | (byte2 & 0x3f);
        i += 2;
      } else {
        i += 1;
      }
    } else if (byte1 >= 0xe0 && byte1 <= 0xef && i + 2 < bytes.length) {
      const byte2 = bytes[i + 1];
      const byte3 = bytes[i + 2];
      if ((byte2 & 0xc0) === 0x80 && (byte3 & 0xc0) === 0x80) {
        const temp = ((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f);
        if (temp >= 0x800 && (temp < 0xd800 || temp > 0xdfff)) {
          codePoint = temp;
          i += 3;
        } else {
          i += 1;
        }
      } else {
        i += 1;
      }
    } else if (byte1 >= 0xf0 && byte1 <= 0xf4 && i + 3 < bytes.length) {
      const byte2 = bytes[i + 1];
      const byte3 = bytes[i + 2];
      const byte4 = bytes[i + 3];
      if ((byte2 & 0xc0) === 0x80 && (byte3 & 0xc0) === 0x80 && (byte4 & 0xc0) === 0x80) {
        const temp =
          ((byte1 & 0x07) << 18) |
          ((byte2 & 0x3f) << 12) |
          ((byte3 & 0x3f) << 6) |
          (byte4 & 0x3f);
        if (temp >= 0x10000 && temp <= 0x10ffff) {
          codePoint = temp;
          i += 4;
        } else {
          i += 1;
        }
      } else {
        i += 1;
      }
    } else {
      i += 1;
    }

    if (codePoint <= 0xffff) {
      result += String.fromCharCode(codePoint);
    } else {
      const adjusted = codePoint - 0x10000;
      result += String.fromCharCode((adjusted >> 10) + 0xd800);
      result += String.fromCharCode((adjusted & 0x3ff) + 0xdc00);
    }
  }

  return result;
}

export interface ContextData {
  requestId?: string | null;
  tenantId: string;
  extensionId: string;
  installId?: string | null;
  versionId?: string | null;
  config?: Record<string, string> | null;
}

export interface HttpHeader {
  name: string;
  value: string;
}

export interface HttpRequest {
  method: string;
  url: string;
  headers: HttpHeader[];
  body?: Uint8Array | null;
  query?: Record<string, string | undefined>;
  path?: string | null;
}

export interface HttpResponse {
  status: number;
  headers: HttpHeader[];
  body?: Uint8Array | null;
}

export interface ExecuteRequest {
  context: ContextData;
  http: HttpRequest;
}

export interface ExecuteResponse {
  status: number;
  headers?: HttpHeader[];
  body?: Uint8Array | null;
}

export interface SecretsHost {
  get(key: string): Promise<string>;
  list(): Promise<string[]>;
}

export interface HttpHost {
  fetch(request: HttpRequest): Promise<HttpResponse>;
}

export interface StorageHost {
  get(namespace: string, key: string): Promise<Uint8Array | null>;
  put(entry: { namespace: string; key: string; value: Uint8Array; revision?: number | null }): Promise<void>;
  delete(namespace: string, key: string): Promise<void>;
  list(namespace: string): Promise<Array<{ key: string; value: Uint8Array; revision?: number | null }>>;
}

export interface LoggingHost {
  info(message: string): Promise<void>;
  warn(message: string): Promise<void>;
  error(message: string): Promise<void>;
}

export interface UiProxyHost {
  callRoute(route: string, payload?: Uint8Array | null): Promise<Uint8Array>;
  call?(route: string, payload?: Uint8Array | null): Promise<Uint8Array>;
}

export interface HostBindings {
  context: {
    get(): Promise<ContextData>;
    config?: Record<string, string> | null;
  };
  secrets: SecretsHost;
  http: HttpHost;
  storage: StorageHost;
  logging: LoggingHost;
  uiProxy: UiProxyHost;
}

export type Handler = (request: ExecuteRequest, host: HostBindings) => Promise<ExecuteResponse> | ExecuteResponse;

export function jsonResponse(body: unknown, init: Partial<ExecuteResponse> = {}): ExecuteResponse {
  const encoded =
    body instanceof Uint8Array ? body : encodeUtf8(typeof body === 'string' ? body : JSON.stringify(body));
  return {
    status: init.status ?? 200,
    headers: init.headers ?? [{ name: 'content-type', value: 'application/json' }],
    body: encoded,
  };
}
