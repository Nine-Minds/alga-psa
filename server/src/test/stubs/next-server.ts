const GlobalResponse = globalThis.Response;
const GlobalRequest = globalThis.Request;
const GlobalHeaders = globalThis.Headers;

/**
 * Minimal stub for `next/server` to unblock Vitest execution.
 * Provides lightweight implementations of NextRequest/NextResponse using the
 * standard Fetch API classes available in the test environment.
 */

class StubNextResponse extends GlobalResponse {
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body ?? null, init);
  }

  static redirect(url: string | URL, init?: number | ResponseInit): StubNextResponse {
    const status = typeof init === 'number' ? init : (init?.status ?? 307);
    const headers = new GlobalHeaders(
      typeof init === 'number' ? undefined : init?.headers
    );
    headers.set('location', String(url));
    return new StubNextResponse(null, {
      ...(typeof init === 'number' ? undefined : init),
      status,
      headers,
    });
  }

  static json(data: any, init?: ResponseInit): StubNextResponse {
    const headers = new GlobalHeaders(init?.headers || {});
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return new StubNextResponse(JSON.stringify(data ?? null), {
      ...init,
      headers,
    });
  }
}

class StubNextRequest extends GlobalRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    if (input instanceof GlobalRequest) {
      super(input);
    } else {
      super(input, init);
    }
  }

  get nextUrl(): URL {
    return new URL(this.url);
  }
}

export const NextResponse = StubNextResponse;
export const NextRequest = StubNextRequest;

export const Response = GlobalResponse;
export const Request = GlobalRequest;
export const Headers = GlobalHeaders;

export default NextResponse;
