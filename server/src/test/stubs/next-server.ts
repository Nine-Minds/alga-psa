const GlobalResponse = globalThis.Response;
const GlobalRequest = globalThis.Request;
const GlobalHeaders = globalThis.Headers;

/**
 * Minimal stub for `next/server` to unblock Vitest execution.
 * Provides lightweight implementations of NextRequest/NextResponse using the
 * standard Fetch API classes available in the test environment.
 */

type StubCookieSetOptions = {
  httpOnly?: boolean;
  sameSite?: 'lax' | 'strict' | 'none' | boolean;
  secure?: boolean;
  path?: string;
  maxAge?: number;
  domain?: string;
  expires?: Date;
};

type StubCookieObjectForm = StubCookieSetOptions & { name: string; value: string };

class StubResponseCookies {
  constructor(private headers: Headers) {}

  // Next.js supports both set(name, value, options) and set({ name, value, ...options }).
  set(
    nameOrCookie: string | StubCookieObjectForm,
    value?: string,
    options: StubCookieSetOptions = {}
  ): this {
    const cookie: StubCookieObjectForm =
      typeof nameOrCookie === 'string'
        ? { name: nameOrCookie, value: value ?? '', ...options }
        : nameOrCookie;

    const parts = [`${cookie.name}=${encodeURIComponent(cookie.value)}`];
    if (cookie.path) parts.push(`Path=${cookie.path}`);
    if (typeof cookie.maxAge === 'number') parts.push(`Max-Age=${cookie.maxAge}`);
    if (cookie.domain) parts.push(`Domain=${cookie.domain}`);
    if (cookie.expires) parts.push(`Expires=${cookie.expires.toUTCString()}`);
    if (cookie.httpOnly) parts.push('HttpOnly');
    if (cookie.secure) parts.push('Secure');
    if (cookie.sameSite) {
      const sameSite = typeof cookie.sameSite === 'string' ? cookie.sameSite : 'strict';
      parts.push(`SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`);
    }
    this.headers.append('set-cookie', parts.join('; '));
    return this;
  }

  delete(name: string): this {
    return this.set(name, '', { maxAge: 0 });
  }

  // Next.js ResponseCookies also exposes get()/getAll(), reading back the
  // cookies that were set on this response. Tests inspect the CSRF cookie's
  // value and attributes, so parse them out of the serialized set-cookie
  // header(s). Last write for a given name wins, mirroring Next semantics.
  get(name: string): (StubCookieObjectForm) | undefined {
    let found: StubCookieObjectForm | undefined;
    for (const cookie of this.getAll()) {
      if (cookie.name === name) found = cookie;
    }
    return found;
  }

  getAll(): StubCookieObjectForm[] {
    const raw =
      typeof (this.headers as any).getSetCookie === 'function'
        ? ((this.headers as any).getSetCookie() as string[])
        : this.headers.get('set-cookie')
          ? [this.headers.get('set-cookie') as string]
          : [];

    const cookies: StubCookieObjectForm[] = [];
    for (const serialized of raw) {
      const segments = serialized.split(';').map((s) => s.trim()).filter(Boolean);
      if (segments.length === 0) continue;
      const [pair, ...attrs] = segments;
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const cookie: StubCookieObjectForm = {
        name: pair.slice(0, eq).trim(),
        value: decodeURIComponent(pair.slice(eq + 1).trim()),
      };
      for (const attr of attrs) {
        const aeq = attr.indexOf('=');
        const key = (aeq === -1 ? attr : attr.slice(0, aeq)).trim().toLowerCase();
        const val = aeq === -1 ? undefined : attr.slice(aeq + 1).trim();
        switch (key) {
          case 'path':
            cookie.path = val;
            break;
          case 'domain':
            cookie.domain = val;
            break;
          case 'max-age':
            cookie.maxAge = val === undefined ? undefined : Number(val);
            break;
          case 'expires':
            cookie.expires = val === undefined ? undefined : new Date(val);
            break;
          case 'httponly':
            cookie.httpOnly = true;
            break;
          case 'secure':
            cookie.secure = true;
            break;
          case 'samesite':
            cookie.sameSite = (val ?? '').toLowerCase() as StubCookieSetOptions['sameSite'];
            break;
          default:
            break;
        }
      }
      cookies.push(cookie);
    }
    return cookies;
  }
}

class StubRequestCookies {
  private map = new Map<string, string>();

  constructor(cookieHeader: string | null) {
    if (!cookieHeader) return;
    for (const pair of cookieHeader.split(';')) {
      const idx = pair.indexOf('=');
      if (idx === -1) continue;
      const name = pair.slice(0, idx).trim();
      if (!name) continue;
      this.map.set(name, decodeURIComponent(pair.slice(idx + 1).trim()));
    }
  }

  get(name: string): { name: string; value: string } | undefined {
    const value = this.map.get(name);
    return value === undefined ? undefined : { name, value };
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  getAll(): Array<{ name: string; value: string }> {
    return [...this.map.entries()].map(([name, value]) => ({ name, value }));
  }
}

class StubNextResponse extends GlobalResponse {
  private cookiesInstance?: StubResponseCookies;

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body ?? null, init);
  }

  get cookies(): StubResponseCookies {
    if (!this.cookiesInstance) {
      this.cookiesInstance = new StubResponseCookies(this.headers);
    }
    return this.cookiesInstance;
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
  private cookiesInstance?: StubRequestCookies;

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

  get cookies(): StubRequestCookies {
    if (!this.cookiesInstance) {
      this.cookiesInstance = new StubRequestCookies(this.headers.get('cookie'));
    }
    return this.cookiesInstance;
  }
}

export const NextResponse = StubNextResponse;
export const NextRequest = StubNextRequest;

export const Response = GlobalResponse;
export const Request = GlobalRequest;
export const Headers = GlobalHeaders;

export default NextResponse;
