import { Auth, setEnvDefaults as coreSetEnvDefaults } from '@auth/core';
import {
  resolveDeploymentCapabilities,
} from '@alga-psa/shared/core/deploymentProfile';
import {
  portalDomainServes,
  type PortalDomainSurface,
} from '@alga-psa/shared/core/portalDomainSurface';

/**
 * NextAuth on a tenant's custom MSP domain (alga-2026-0002799, D3).
 *
 * `next-auth`'s route handlers call `reqWithEnvURL`, which rewrites every request's
 * origin to NEXTAUTH_URL. That is right for the canonical host and for client-portal
 * vanity domains (which authenticate on the canonical host and hand off), but wrong for
 * a domain that serves the MSP app: the OAuth `redirect_uri`, the credentials callback
 * URL and the `baseUrl` given to the `redirect` callback all become the canonical host,
 * while the state/PKCE/CSRF cookies are host-only cookies on the custom host and never
 * reach the canonical callback.
 *
 * For requests whose Host is an ACTIVE custom domain serving the MSP app (`msp` or
 * `both`) we therefore run @auth/core directly on a request rebased onto that host.
 * Cookie names are host-agnostic and carry no Domain attribute, so the session cookie
 * is a host-only cookie that sticks to the custom host; the JWT salt is the cookie name
 * so a token minted on the custom host also decodes on the canonical host.
 * Every other request takes the untouched next-auth path.
 */

export interface CustomAuthHost {
  /** Host as the browser addressed it (may include a port). */
  hostHeader: string;
  proto: string;
}

const HOST_CACHE_TTL_MS = 30_000;
const hostCache = new Map<string, { value: PortalDomainSurface | null; expiresAt: number }>();

export function clearCustomAuthHostCache(): void {
  hostCache.clear();
}

async function defaultLookupSurface(hostname: string): Promise<PortalDomainSurface | null> {
  const { getAdminConnection } = await import('@alga-psa/db/admin');
  const { getPortalDomainByHostname } = await import('../lib/PortalDomainModel');
  const knex = await getAdminConnection();
  const record = await getPortalDomainByHostname(knex, hostname);
  return record && record.status === 'active' ? record.surface : null;
}

export interface ResolveCustomAuthHostOptions {
  lookupSurface?: (hostname: string) => Promise<PortalDomainSurface | null>;
}

/**
 * Returns the custom host when this request addresses an active domain that serves
 * the MSP app, otherwise null. Never throws: a failed lookup means "not a custom host".
 */
export async function resolveCustomAuthHost(
  request: Request,
  options: ResolveCustomAuthHostOptions = {}
): Promise<CustomAuthHost | null> {
  const caps = resolveDeploymentCapabilities();
  const forwarded = caps.trustForwardedHost
    ? request.headers.get('x-forwarded-host')?.split(',')[0].trim()
    : '';
  const hostHeader = (forwarded || request.headers.get('host') || '').toLowerCase();
  const hostname = hostHeader.split(':')[0];
  if (!hostname) {
    return null;
  }

  let canonicalHostname: string | null = null;
  try {
    canonicalHostname = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).hostname.toLowerCase() : null;
  } catch {
    canonicalHostname = null;
  }
  if (!canonicalHostname || hostname === canonicalHostname) {
    return null;
  }

  const now = Date.now();
  let surface: PortalDomainSurface | null;
  const cached = hostCache.get(hostHeader);
  if (cached && cached.expiresAt > now) {
    surface = cached.value;
  } else {
    try {
      surface = await (options.lookupSurface ?? defaultLookupSurface)(hostname);
    } catch (error) {
      console.warn('[auth] custom host lookup failed; using canonical origin', {
        hostname,
        error: error instanceof Error ? error.message : error,
      });
      surface = null;
    }
    hostCache.set(hostHeader, { value: surface, expiresAt: now + HOST_CACHE_TTL_MS });
  }

  if (!surface || !portalDomainServes(surface, 'msp')) {
    return null;
  }

  const protoHeader = request.headers.get('x-forwarded-proto')?.split(',')[0].trim().toLowerCase();
  const proto = protoHeader && /^[a-z][a-z0-9+.-]*$/.test(protoHeader)
    ? protoHeader
    : process.env.NODE_ENV === 'production' ? 'https' : new URL(request.url).protocol.replace(/:$/, '');
  return { hostHeader, proto };
}

/** Same request (method, headers, body) addressed to the custom host. */
export function rebaseRequestOntoHost(request: Request, host: CustomAuthHost): Request {
  const url = new URL(request.url);
  const rebased = new URL(`${host.proto}://${host.hostHeader}${url.pathname}${url.search}`);
  return new Request(rebased, request);
}

export interface CustomHostAwareHandlerDeps {
  /** next-auth's own handler (canonical-origin behaviour). */
  defaultHandler: (request: any) => Promise<Response>;
  resolveHost: (request: Request) => Promise<CustomAuthHost | null>;
  loadConfig: () => Promise<Record<string, any>>;
  runAuth?: (request: Request, config: any) => Promise<Response>;
}

export function createCustomHostAwareHandler(deps: CustomHostAwareHandlerDeps) {
  const runAuth = deps.runAuth ?? (Auth as unknown as (request: Request, config: any) => Promise<Response>);

  return async function customHostAwareHandler(request: any): Promise<Response> {
    const host = await deps.resolveHost(request);
    if (!host) {
      return deps.defaultHandler(request);
    }

    const config: Record<string, any> = { ...(await deps.loadConfig()), trustHost: true };
    // Mirror what next-auth's setEnvDefaults does (secret, basePath, provider env defaults).
    config.secret ??= process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
    config.basePath ||= '/api/auth';
    coreSetEnvDefaults(process.env, config as any, true);

    return runAuth(rebaseRequestOntoHost(request, host), config);
  };
}
