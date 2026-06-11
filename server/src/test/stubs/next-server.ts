const GlobalResponse = globalThis.Response;
const GlobalRequest = globalThis.Request;
const GlobalHeaders = globalThis.Headers;

/**
 * Minimal stub for `next/server` to unblock Vitest execution.
 * Provides lightweight implementations of NextRequest/NextResponse using the
 * standard Fetch API classes available in the test environment.
 */

type StubCookieOptions = {
  name: string;
  value: string;
  path?: string;
  maxAge?: number;
  httpOnly?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  secure?: boolean;
};

class StubResponseCookies {
  constructor(private readonly headers: Headers) {}

  set(
    nameOrOptions: string | StubCookieOptions,
    value?: string,
    options?: Omit<StubCookieOptions, 'name' | 'value'>
  ): this {
    const opts: StubCookieOptions =
      typeof nameOrOptions === 'string'
        ? { name: nameOrOptions, value: value ?? '', ...(options ?? {}) }
        : nameOrOptions;

    const parts = [`${opts.name}=${encodeURIComponent(opts.value)}`];
    if (opts.path) parts.push(`Path=${opts.path}`);
    if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
    if (opts.httpOnly) parts.push('HttpOnly');
    if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
    if (opts.secure) parts.push('Secure');
    this.headers.append('set-cookie', parts.join('; '));
    return this;
  }
}

class StubNextResponse extends GlobalResponse {
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body ?? null, init);
  }

  get cookies(): StubResponseCookies {
    return new StubResponseCookies(this.headers);
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
