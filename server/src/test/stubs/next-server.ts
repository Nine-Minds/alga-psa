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

const parseSetCookie = (raw: string): StubCookieObjectForm | null => {
  const [pair, ...attributes] = raw.split(';');
  const idx = pair.indexOf('=');
  if (idx === -1) return null;
  const name = pair.slice(0, idx).trim();
  if (!name) return null;

  const cookie: StubCookieObjectForm = { name, value: decodeURIComponent(pair.slice(idx + 1).trim()) };
  for (const attribute of attributes) {
    const sep = attribute.indexOf('=');
    const key = (sep === -1 ? attribute : attribute.slice(0, sep)).trim().toLowerCase();
    const value = sep === -1 ? '' : attribute.slice(sep + 1).trim();
    if (key === 'path') cookie.path = value;
    else if (key === 'domain') cookie.domain = value;
    else if (key === 'max-age') cookie.maxAge = Number(value);
    else if (key === 'expires') cookie.expires = new Date(value);
    else if (key === 'httponly') cookie.httpOnly = true;
    else if (key === 'secure') cookie.secure = true;
    else if (key === 'samesite') cookie.sameSite = value.toLowerCase() as StubCookieSetOptions['sameSite'];
  }
  return cookie;
};

class StubResponseCookies {
  constructor(private headers: Headers) {}

  // Next's ResponseCookies reads back what was written. Parsing the header
  // instead of caching also surfaces cookies appended straight to it.
  private parsed(): StubCookieObjectForm[] {
    const headers = this.headers as Headers & { getSetCookie?: () => string[] };
    const raw =
      typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : [headers.get('set-cookie')].filter((entry): entry is string => Boolean(entry));
    return raw
      .map(parseSetCookie)
      .filter((cookie): cookie is StubCookieObjectForm => cookie !== null);
  }

  // Last write wins, mirroring Next's replace-on-set semantics.
  get(name: string): StubCookieObjectForm | undefined {
    const matches = this.parsed().filter((cookie) => cookie.name === name);
    return matches.length ? matches[matches.length - 1] : undefined;
  }

  getAll(name?: string): StubCookieObjectForm[] {
    const cookies = this.parsed();
    return name === undefined ? cookies : cookies.filter((cookie) => cookie.name === name);
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

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
