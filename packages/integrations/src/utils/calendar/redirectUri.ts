import type { CalendarOAuthState } from '@alga-psa/types';

type CalendarProviderType = CalendarOAuthState['provider'];

type SecretProviderLike = {
  getAppSecret(key: string): Promise<string | null | undefined>;
  getTenantSecret(tenant: string, key: string): Promise<string | null | undefined>;
};

interface ResolveCalendarRedirectOptions {
  tenant: string;
  provider: CalendarProviderType;
  secretProvider: SecretProviderLike;
  hosted: boolean;
  requestedRedirectUri?: string;
  existingRedirectUri?: string | null;
}

const PROVIDER_CALLBACK_PATH: Record<CalendarProviderType, string> = {
  google: '/api/auth/google/calendar/callback',
  microsoft: '/api/auth/microsoft/calendar/callback',
};

/**
 * Resolve the canonical redirect URI for a calendar OAuth flow.
 * Prefers pre-configured secrets, tenant overrides, or previously stored values.
 * Falls back to the deployment base URL if nothing else is available.
 */
export async function resolveCalendarRedirectUri(
  options: ResolveCalendarRedirectOptions
): Promise<string> {
  const { tenant, provider, secretProvider, hosted, requestedRedirectUri, existingRedirectUri } = options;
  const expectedPath = PROVIDER_CALLBACK_PATH[provider];
  const fallbackBase = await getDeploymentBaseUrl(secretProvider);
  const fallbackRedirect = joinBaseAndPath(fallbackBase, expectedPath);

  const allowedHosts = new Set<string>();
  allowedHosts.add(getHostOrNull(fallbackRedirect));

  const candidates: Array<{ value?: string | null; allowHostExpansion: boolean }> = [];

  if (hosted) {
    const hostedOverride = await secretProvider.getAppSecret(getHostedRedirectKey(provider));
    candidates.push({ value: hostedOverride ?? undefined, allowHostExpansion: true });
  } else {
    const envOverride = process.env[getEnvRedirectKey(provider)];
    candidates.push({ value: envOverride, allowHostExpansion: true });

    const tenantOverride = await secretProvider.getTenantSecret(
      tenant,
      getTenantRedirectKey(provider)
    );
    candidates.push({ value: tenantOverride ?? undefined, allowHostExpansion: true });
  }

  candidates.push({ value: existingRedirectUri ?? undefined, allowHostExpansion: true });
  candidates.push({ value: requestedRedirectUri, allowHostExpansion: false });
  candidates.push({ value: fallbackRedirect, allowHostExpansion: true });

  for (const { value, allowHostExpansion } of candidates) {
    const sanitized = sanitizeRedirectUri(value, expectedPath, allowedHosts, allowHostExpansion);
    if (sanitized) {
      return sanitized;
    }
  }

  return fallbackRedirect;
}

function sanitizeRedirectUri(
  candidate: string | null | undefined,
  expectedPath: string,
  allowedHosts: Set<string>,
  allowHostExpansion: boolean
): string | null {
  if (!candidate) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null;
  }

  if (normalizePath(url.pathname) !== expectedPath) {
    return null;
  }

  if (!allowedHosts.has(url.host)) {
    if (!allowHostExpansion) {
      return null;
    }
    allowedHosts.add(url.host);
  }

  url.hash = '';
  url.search = '';

  // Ensure pathname matches the expected path exactly after normalization
  url.pathname = expectedPath;

  return url.toString();
}

async function getDeploymentBaseUrl(secretProvider: SecretProviderLike): Promise<string> {
  const configured =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')) ||
    process.env.NEXTAUTH_URL ||
    (await secretProvider.getAppSecret('NEXTAUTH_URL'));

  return normalizeBaseUrl(configured);
}

function joinBaseAndPath(base: string, path: string): string {
  return `${base}${path}`;
}

function normalizeBaseUrl(base?: string | null): string {
  if (!base) {
    return 'http://localhost:3000';
  }

  const attempt = tryNormalizeUrl(base);
  if (attempt) {
    return attempt;
  }

  // Attempt again by prefixing https:// if the original string lacked a scheme
  const withScheme = base.startsWith('http') ? base : `https://${base}`;
  const fallback = tryNormalizeUrl(withScheme);
  return fallback ?? 'http://localhost:3000';
}

function tryNormalizeUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return null;
  }
}

function normalizePath(pathname: string): string {
  return pathname.endsWith('/') && pathname.length > 1
    ? pathname.slice(0, -1)
    : pathname || '/';
}

function getHostOrNull(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return '';
  }
}

function getHostedRedirectKey(provider: CalendarProviderType): string {
  return provider === 'google' ? 'GOOGLE_REDIRECT_URI' : 'MICROSOFT_REDIRECT_URI';
}

function getEnvRedirectKey(provider: CalendarProviderType): 'GOOGLE_REDIRECT_URI' | 'MICROSOFT_REDIRECT_URI' {
  return provider === 'google' ? 'GOOGLE_REDIRECT_URI' : 'MICROSOFT_REDIRECT_URI';
}

function getTenantRedirectKey(provider: CalendarProviderType): 'google_redirect_uri' | 'microsoft_redirect_uri' {
  return provider === 'google' ? 'google_redirect_uri' : 'microsoft_redirect_uri';
}
