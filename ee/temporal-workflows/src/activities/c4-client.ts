/**
 * Shared HTTP helpers for the alga-license service ("C4").
 *
 * The worker is the only cloud component allowed to WRITE to C4; it holds
 * ALGA_LICENSE_SERVICE_SECRET. Used by the issuance pipeline and by the
 * Appliance Console operator-action activities.
 */

export function c4BaseUrl(): string {
  const url = process.env.ALGA_LICENSE_SERVICE_URL;
  if (!url) throw new Error('ALGA_LICENSE_SERVICE_URL is not configured');
  return url.replace(/\/$/, '');
}

export function c4ServiceSecret(): string {
  const secret = process.env.ALGA_LICENSE_SERVICE_SECRET;
  if (!secret) throw new Error('ALGA_LICENSE_SERVICE_SECRET is not configured');
  return secret;
}

export class C4RequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(path: string, status: number, body: string) {
    let message = body;
    let code: string | null = null;
    try {
      const parsed = JSON.parse(body) as { error?: string; code?: string };
      if (parsed.error) message = parsed.error;
      if (parsed.code) code = parsed.code;
    } catch {
      /* non-JSON body */
    }
    super(`C4 ${path} failed (${status}): ${message}`);
    this.name = 'C4RequestError';
    this.status = status;
    this.code = code;
  }
}

async function c4Request(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${c4BaseUrl()}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${c4ServiceSecret()}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    throw new C4RequestError(path, res.status, await res.text());
  }
  return res.json();
}

export async function c4Get(path: string): Promise<unknown> {
  return c4Request('GET', path);
}

export async function c4Post(path: string, body: unknown): Promise<unknown> {
  return c4Request('POST', path, body ?? {});
}

export async function c4Patch(path: string, body: unknown): Promise<unknown> {
  return c4Request('PATCH', path, body ?? {});
}

/** 4xx from C4 is a bad request, not a transient fault: don't burn retries on it. */
export function isC4ClientError(error: unknown): boolean {
  return error instanceof C4RequestError && error.status >= 400 && error.status < 500 && error.status !== 429;
}
