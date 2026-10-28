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
  /** Tenant that owns the host (D7: one host = one tenant). Sign-in is bound to it. */
  tenant: string;
}

export interface CustomHostLookupResult {
  surface: PortalDomainSurface;
  tenant: string;
}

const HOST_CACHE_TTL_MS = 30_000;
const hostCache = new Map<string, { value: CustomHostLookupResult | null; expiresAt: number }>();

export function clearCustomAuthHostCache(): void {
  hostCache.clear();
}

// LEVERAGE: pattern portal-domain-host-lookup — same "active portal domain by hostname" lookup as
// server/src/lib/portal-domains/hostSurface.ts (resolveHostSurface); two copies (Edge via HTTP, Node via DB).
async function defaultLookupSurface(hostname: string): Promise<CustomHostLookupResult | null> {
  const { getAdminConnection } = await import('@alga-psa/db/admin');
  const { getPortalDomainByHostname } = await import('../lib/PortalDomainModel');
  const knex = await getAdminConnection();
  const record = await getPortalDomainByHostname(knex, hostname);
  return record && record.status === 'active' && record.tenant
    ? { surface: record.surface, tenant: record.tenant }
    : null;
}

export interface ResolveCustomAuthHostOptions {
  lookupSurface?: (hostname: string) => Promise<CustomHostLookupResult | null>;
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
  let found: CustomHostLookupResult | null;
  const cached = hostCache.get(hostHeader);
  if (cached && cached.expiresAt > now) {
    found = cached.value;
  } else {
    try {
      found = await (options.lookupSurface ?? defaultLookupSurface)(hostname);
    } catch (error) {
      console.warn('[auth] custom host lookup failed; using canonical origin', {
        hostname,
        error: error instanceof Error ? error.message : error,
      });
      found = null;
    }
    hostCache.set(hostHeader, { value: found, expiresAt: now + HOST_CACHE_TTL_MS });
  }

  if (!found || !portalDomainServes(found.surface, 'msp')) {
    return null;
  }

  const protoHeader = request.headers.get('x-forwarded-proto')?.split(',')[0].trim().toLowerCase();
  const proto = protoHeader && /^[a-z][a-z0-9+.-]*$/.test(protoHeader)
    ? protoHeader
    : process.env.NODE_ENV === 'production' ? 'https' : new URL(request.url).protocol.replace(/:$/, '');
  return { hostHeader, proto, tenant: found.tenant };
}

/** Same request (method, headers, body) addressed to the custom host. */
export function rebaseRequestOntoHost(request: Request, host: CustomAuthHost): Request {
  const url = new URL(request.url);
  const rebased = new URL(`${host.proto}://${host.hostHeader}${url.pathname}${url.search}`);
  return new Request(rebased, request);
}

/**
 * D7: one host = one tenant. Wraps a freshly built auth config (per request, closing over the
 * tenant resolved server-side from the Host header - never a client-supplied value) so that
 * every sign-in path refuses a user of another tenant with an ordinary auth failure:
 *  - credentials `authorize()` returns null (CredentialsSignin),
 *  - the `signIn` callback returns false (AccessDenied) before AND after the original runs
 *    (OAuth/SSO profile hints can set the tenant inside it),
 *  - `session` presents a foreign-tenant token as signed out.
 * The canonical-host path never goes through this.
 */
export function bindAuthConfigToTenant(config: Record<string, any>, hostTenant: string): Record<string, any> {
  const wrapAuthorize = (authorize: any) => typeof authorize === 'function'
    ? async (...args: any[]) => {
        const user = await authorize(...args);
        return user && user.tenant === hostTenant ? user : null;
      }
    : authorize;

  const providers = (config.providers ?? []).map((provider: any) => {
    if (!provider || (!provider.authorize && !provider.options?.authorize)) {
      return provider;
    }
    return {
      ...provider,
      ...(provider.authorize ? { authorize: wrapAuthorize(provider.authorize) } : {}),
      ...(provider.options?.authorize
        ? { options: { ...provider.options, authorize: wrapAuthorize(provider.options.authorize) } }
        : {}),
    };
  });

  const callbacks = config.callbacks ?? {};
  return {
    ...config,
    providers,
    callbacks: {
      ...callbacks,
      async signIn(params: any) {
        const foreign = (u: any) => !u || u.tenant !== hostTenant;
        // Credentials users already passed the authorize() check; for OAuth the profile
        // callback usually carries the tenant, so refuse early to skip side effects.
        if (params?.account?.provider !== 'credentials' && params?.user?.tenant && foreign(params.user)) {
          return false;
        }
        const result = callbacks.signIn ? await callbacks.signIn(params) : true;
        if (result === false) {
          return false;
        }
        return foreign(params?.user) ? false : result;
      },
      async session(params: any) {
        if (params?.token && params.token.tenant !== hostTenant) {
          return { expires: '0' };
        }
        return callbacks.session ? callbacks.session(params) : params.session;
      },
    },
  };
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

    const config: Record<string, any> = {
      ...bindAuthConfigToTenant(await deps.loadConfig(), host.tenant),
      trustHost: true,
    };
    // Mirror what next-auth's setEnvDefaults does (secret, basePath, provider env defaults).
    config.secret ??= process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
    config.basePath ||= '/api/auth';
    coreSetEnvDefaults(process.env, config as any, true);

    return runAuth(rebaseRequestOntoHost(request, host), config);
  };
}
