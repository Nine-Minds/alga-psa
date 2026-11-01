import { Agent, fetch } from 'undici';
import type { LookupFunction } from 'node:net';
import {
  assertSafeWebhookUrl,
  isGlobalUnicastAddress,
  isPrivateWebhookTargetAllowed,
  resolveValidatedAddresses,
  UnsafeWebhookTargetError,
  type AddressPolicy,
} from './ssrf';

export const MAX_REDIRECT_HOPS = 3;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CROSS_ORIGIN_STRIPPED_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];
const BODY_HEADERS = ['content-type', 'content-length', 'content-encoding', 'content-language', 'content-location'];

export class WebhookRedirectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookRedirectError';
  }
}

export interface TransportRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  verifySsl: boolean;
  signal: AbortSignal;
}

export interface TransportResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  text: string;
}

function deleteHeader(headers: Record<string, string>, name: string): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name) delete headers[key];
  }
}

/**
 * Connect-time lookup: resolves the name, validates every address and returns
 * only validated ones, so the socket is pinned to what was checked. The
 * hostname itself is left untouched, so SNI and certificate checks use the name.
 * (Node does not call lookup for IP-literal hosts; those are validated in
 * assertSafeWebhookUrl before connecting.)
 */
function createPinnedLookup(
  isAddressAllowed: AddressPolicy,
  onBlocked: (error: UnsafeWebhookTargetError) => void,
): LookupFunction {
  return ((hostname: string, options: { family?: number | string; all?: boolean }, callback: Function) => {
    resolveValidatedAddresses(hostname, isAddressAllowed).then(
      (addresses) => {
        const family = options?.family === 'IPv4' ? 4 : options?.family === 'IPv6' ? 6 : Number(options?.family ?? 0);
        const usable = family === 4 || family === 6 ? addresses.filter((a) => a.family === family) : addresses;
        if (usable.length === 0) {
          const err = Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
          callback(err);
        } else if (options?.all) {
          callback(null, usable);
        } else {
          callback(null, usable[0].address, usable[0].family);
        }
      },
      (error: unknown) => {
        if (error instanceof UnsafeWebhookTargetError) onBlocked(error);
        callback(error);
      },
    );
  }) as unknown as LookupFunction;
}

/**
 * Performs the HTTP request, following at most MAX_REDIRECT_HOPS redirects
 * itself. Every hop is validated and pinned independently. Throws
 * UnsafeWebhookTargetError if any hop is blocked, so callers never see a body
 * from a blocked or redirected request.
 */
export async function sendWithValidatedRedirects(
  request: TransportRequest,
  isAddressAllowed: AddressPolicy = isGlobalUnicastAddress,
): Promise<TransportResponse> {
  const allowPrivate = isPrivateWebhookTargetAllowed();
  const policy: AddressPolicy = allowPrivate ? () => true : isAddressAllowed;

  let current = new URL(request.url);
  let method = request.method;
  let body = request.body;
  let headers = { ...request.headers };

  for (let hop = 0; ; hop++) {
    if (!allowPrivate) {
      assertSafeWebhookUrl(current, policy);
    }

    let blocked: UnsafeWebhookTargetError | undefined;
    const agent = new Agent({
      connect: {
        lookup: createPinnedLookup(policy, (e) => {
          blocked = e;
        }),
        ...(request.verifySsl ? {} : { rejectUnauthorized: false }),
      },
    });

    try {
      let response;
      try {
        response = await fetch(current.toString(), {
          method,
          headers,
          body,
          redirect: 'manual',
          signal: request.signal,
          dispatcher: agent,
        });
      } catch (error) {
        throw blocked ?? error;
      }

      const location = REDIRECT_STATUSES.has(response.status) ? response.headers.get('location') : null;
      if (location === null || location === undefined) {
        return {
          ok: response.ok,
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          text: await response.text(),
        };
      }

      await response.body?.cancel().catch(() => undefined);

      if (hop >= MAX_REDIRECT_HOPS) {
        throw new WebhookRedirectError(`Webhook target exceeded ${MAX_REDIRECT_HOPS} redirects`);
      }

      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new WebhookRedirectError(`Webhook target returned an invalid redirect location`);
      }
      if (current.protocol === 'https:' && next.protocol === 'http:') {
        throw new UnsafeWebhookTargetError('Webhook redirect from https to http is not allowed');
      }

      headers = { ...headers };
      const switchToGet =
        response.status === 303 ? method !== 'HEAD' : (response.status === 301 || response.status === 302) && method === 'POST';
      if (switchToGet) {
        method = 'GET';
        body = undefined;
        for (const name of BODY_HEADERS) deleteHeader(headers, name);
      }
      if (next.origin !== current.origin) {
        for (const name of CROSS_ORIGIN_STRIPPED_HEADERS) deleteHeader(headers, name);
      }
      current = next;
    } finally {
      await agent.close();
    }
  }
}
