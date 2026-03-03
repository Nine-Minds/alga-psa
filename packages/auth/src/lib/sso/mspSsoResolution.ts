import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { getAdminConnection } from '@alga-psa/db/admin';

export type MspSsoProviderId = 'google' | 'azure-ad';
export type MspSsoSource = 'tenant' | 'app';
export type MspSsoDomainClaimStatus =
  | 'advisory'
  | 'pending'
  | 'verified'
  | 'verified_legacy'
  | 'rejected'
  | 'revoked';

export const MSP_SSO_RESOLUTION_COOKIE = 'msp_sso_resolution';
export const MSP_SSO_DISCOVERY_COOKIE = 'msp_sso_discovery';
export const MSP_SSO_RESOLUTION_TTL_SECONDS = 5 * 60;
export const MSP_SSO_DISCOVERY_TTL_SECONDS = 5 * 60;
export const MSP_SSO_GENERIC_FAILURE_MESSAGE =
  "We couldn't start SSO sign-in. Please verify provider setup and try again.";
export const MSP_SSO_LOGIN_DOMAIN_TABLE = 'msp_sso_tenant_login_domains';
export const MSP_SSO_CLAIM_STATUS_VALUES: MspSsoDomainClaimStatus[] = [
  'advisory',
  'pending',
  'verified',
  'verified_legacy',
  'rejected',
  'revoked',
];

const PROVIDER_ORDER: MspSsoProviderId[] = ['google', 'azure-ad'];
const DOMAIN_PATTERN =
  /^(?=.{1,255}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export interface MspSsoResolutionPayload {
  provider: MspSsoProviderId;
  source: MspSsoSource;
  tenantId?: string;
  userId?: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface MspSsoDiscoveryPayload {
  source: MspSsoSource;
  tenantId?: string;
  providers: MspSsoProviderId[];
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

interface ResolverInputs {
  provider: MspSsoProviderId;
  discovery?: MspSsoDiscoveryPayload | null;
}

interface ResolverOutcome {
  resolved: boolean;
  source?: MspSsoSource;
  tenantId?: string;
}

export interface MspSsoDiscoveryOutcome {
  source: MspSsoSource;
  tenantId?: string;
  providers: MspSsoProviderId[];
  domain: string;
  ambiguous: boolean;
}

interface DomainTenantResolution {
  tenantId?: string;
  ambiguous: boolean;
}

function isConfigured(value: string | null | undefined): boolean {
  return Boolean((value || '').trim());
}

function toBase64Url(value: Buffer | string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const withPadding = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(withPadding, 'base64').toString('utf8');
}

function computeCookieSignature(payloadEncoded: string, secret: string): string {
  return toBase64Url(createHmac('sha256', secret).update(payloadEncoded).digest());
}

function isSupportedProvider(provider: string): provider is MspSsoProviderId {
  return provider === 'google' || provider === 'azure-ad';
}

function normalizeProviders(values: unknown): MspSsoProviderId[] {
  if (!Array.isArray(values)) return [];
  const providers = values
    .filter((provider): provider is string => typeof provider === 'string')
    .filter((provider): provider is MspSsoProviderId => isSupportedProvider(provider));

  return Array.from(new Set(providers)).sort(
    (left, right) => PROVIDER_ORDER.indexOf(left) - PROVIDER_ORDER.indexOf(right)
  );
}

export function normalizeResolverEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeMspSsoDomain(value: string): string {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase();

  const withoutPrefix = normalized.startsWith('@') ? normalized.slice(1) : normalized;
  const withoutMailto = withoutPrefix.startsWith('mailto:')
    ? withoutPrefix.slice('mailto:'.length)
    : withoutPrefix;
  const hostCandidate = withoutMailto.includes('://')
    ? (() => {
        try {
          return new URL(withoutMailto).hostname;
        } catch {
          return withoutMailto;
        }
      })()
    : withoutMailto;

  const strippedPath = hostCandidate.split('/')[0] ?? hostCandidate;
  return strippedPath.endsWith('.') ? strippedPath.slice(0, -1) : strippedPath;
}

export function validateMspSsoDomain(value: string): string | null {
  const domain = normalizeMspSsoDomain(value);
  if (!domain) return 'Domain is required.';
  if (domain.includes('@')) return 'Enter domains only (for example, example.com).';
  if (!DOMAIN_PATTERN.test(domain)) return `Invalid domain "${domain}". Enter a valid domain like example.com.`;
  return null;
}

export function normalizeMspSsoDomainClaimStatus(value: unknown): MspSsoDomainClaimStatus {
  if (typeof value !== 'string') return 'advisory';
  const normalized = value.trim().toLowerCase();
  return MSP_SSO_CLAIM_STATUS_VALUES.includes(normalized as MspSsoDomainClaimStatus)
    ? (normalized as MspSsoDomainClaimStatus)
    : 'advisory';
}

export function extractDomainFromEmail(value: string): string | null {
  const normalized = normalizeResolverEmail(value);
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex <= 0 || atIndex >= normalized.length - 1) return null;

  const domain = normalizeMspSsoDomain(normalized.slice(atIndex + 1));
  if (validateMspSsoDomain(domain)) return null;
  return domain;
}

export function isValidResolverCallbackUrl(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('/')) return true;

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseResolverProvider(value: unknown): MspSsoProviderId | null {
  if (typeof value !== 'string') return null;
  return isSupportedProvider(value) ? value : null;
}

export async function getMspSsoSigningSecret(): Promise<string | null> {
  const fromEnv = process.env.NEXTAUTH_SECRET?.trim();
  if (fromEnv) return fromEnv;

  const secretProvider = await getSecretProviderInstance();
  const fromAppSecret = (await secretProvider.getAppSecret('NEXTAUTH_SECRET'))?.trim();
  return fromAppSecret || null;
}

export async function hasTenantProviderCredentials(
  tenant: string,
  provider: MspSsoProviderId
): Promise<boolean> {
  const secretProvider = await getSecretProviderInstance();
  if (provider === 'google') {
    const [clientId, clientSecret] = await Promise.all([
      secretProvider.getTenantSecret(tenant, 'google_client_id'),
      secretProvider.getTenantSecret(tenant, 'google_client_secret'),
    ]);
    return isConfigured(clientId) && isConfigured(clientSecret);
  }

  const [clientId, clientSecret] = await Promise.all([
    secretProvider.getTenantSecret(tenant, 'microsoft_client_id'),
    secretProvider.getTenantSecret(tenant, 'microsoft_client_secret'),
  ]);
  return isConfigured(clientId) && isConfigured(clientSecret);
}

export async function hasAppFallbackProviderCredentials(
  provider: MspSsoProviderId
): Promise<boolean> {
  const secretProvider = await getSecretProviderInstance();
  if (provider === 'google') {
    const clientId =
      process.env.GOOGLE_OAUTH_CLIENT_ID ||
      (await secretProvider.getAppSecret('GOOGLE_OAUTH_CLIENT_ID'));
    const clientSecret =
      process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
      (await secretProvider.getAppSecret('GOOGLE_OAUTH_CLIENT_SECRET'));
    return isConfigured(clientId) && isConfigured(clientSecret);
  }

  const clientId =
    process.env.MICROSOFT_OAUTH_CLIENT_ID ||
    (await secretProvider.getAppSecret('MICROSOFT_OAUTH_CLIENT_ID'));
  const clientSecret =
    process.env.MICROSOFT_OAUTH_CLIENT_SECRET ||
    (await secretProvider.getAppSecret('MICROSOFT_OAUTH_CLIENT_SECRET'));
  return isConfigured(clientId) && isConfigured(clientSecret);
}

export async function resolveTenantForMspSsoDomain(
  domain: string
): Promise<DomainTenantResolution> {
  const normalizedDomain = normalizeMspSsoDomain(domain);
  if (validateMspSsoDomain(normalizedDomain)) {
    return { ambiguous: false };
  }

  const db = await getAdminConnection();
  const rows = await db(MSP_SSO_LOGIN_DOMAIN_TABLE)
    .distinct('tenant')
    .where({ is_active: true })
    .whereRaw('lower(domain) = ?', [normalizedDomain]);

  const tenants = Array.from(
    new Set(
      rows
        .map((row: Record<string, unknown>) => row.tenant)
        .filter((tenant): tenant is string => typeof tenant === 'string' && tenant.length > 0)
    )
  );

  if (tenants.length === 1) {
    return {
      tenantId: tenants[0],
      ambiguous: false,
    };
  }

  if (tenants.length > 1) {
    return {
      ambiguous: true,
    };
  }

  return { ambiguous: false };
}

export async function discoverMspSsoProviderOptions(
  email: string
): Promise<MspSsoDiscoveryOutcome | null> {
  const domain = extractDomainFromEmail(email);
  if (!domain) return null;

  const domainResolution = await resolveTenantForMspSsoDomain(domain);
  if (domainResolution.tenantId && !domainResolution.ambiguous) {
    const [googleReady, microsoftReady] = await Promise.all([
      hasTenantProviderCredentials(domainResolution.tenantId, 'google'),
      hasTenantProviderCredentials(domainResolution.tenantId, 'azure-ad'),
    ]);

    return {
      source: 'tenant',
      tenantId: domainResolution.tenantId,
      providers: normalizeProviders([
        ...(googleReady ? ['google'] : []),
        ...(microsoftReady ? ['azure-ad'] : []),
      ]),
      domain,
      ambiguous: false,
    };
  }

  const [googleReady, microsoftReady] = await Promise.all([
    hasAppFallbackProviderCredentials('google'),
    hasAppFallbackProviderCredentials('azure-ad'),
  ]);

  return {
    source: 'app',
    providers: normalizeProviders([
      ...(googleReady ? ['google'] : []),
      ...(microsoftReady ? ['azure-ad'] : []),
    ]),
    domain,
    ambiguous: domainResolution.ambiguous,
  };
}

export async function resolveMspSsoCredentialSource(
  inputs: ResolverInputs
): Promise<ResolverOutcome> {
  const discovery = inputs.discovery;
  if (discovery) {
    const allowedProviders = normalizeProviders(discovery.providers);
    if (!allowedProviders.includes(inputs.provider)) {
      return { resolved: false };
    }

    if (discovery.source === 'tenant' && discovery.tenantId) {
      if (await hasTenantProviderCredentials(discovery.tenantId, inputs.provider)) {
        return {
          resolved: true,
          source: 'tenant',
          tenantId: discovery.tenantId,
        };
      }

      return { resolved: false };
    }

    if (discovery.source === 'app') {
      if (await hasAppFallbackProviderCredentials(inputs.provider)) {
        return {
          resolved: true,
          source: 'app',
        };
      }
      return { resolved: false };
    }
  }

  if (await hasAppFallbackProviderCredentials(inputs.provider)) {
    return {
      resolved: true,
      source: 'app',
    };
  }

  return { resolved: false };
}

export function createSignedMspSsoResolutionCookie(params: {
  provider: MspSsoProviderId;
  source: MspSsoSource;
  tenantId?: string;
  userId?: string;
  secret: string;
  ttlSeconds?: number;
  now?: number;
}): { value: string; payload: MspSsoResolutionPayload } {
  const now = params.now ?? Date.now();
  const ttl = params.ttlSeconds ?? MSP_SSO_RESOLUTION_TTL_SECONDS;
  const payload: MspSsoResolutionPayload = {
    provider: params.provider,
    source: params.source,
    tenantId: params.tenantId,
    userId: params.userId,
    issuedAt: now,
    expiresAt: now + ttl * 1000,
    nonce: randomBytes(16).toString('hex'),
  };

  const payloadEncoded = toBase64Url(JSON.stringify(payload));
  const signature = computeCookieSignature(payloadEncoded, params.secret);
  return { value: `${payloadEncoded}.${signature}`, payload };
}

export function createSignedMspSsoDiscoveryCookie(params: {
  source: MspSsoSource;
  tenantId?: string;
  providers: MspSsoProviderId[];
  secret: string;
  ttlSeconds?: number;
  now?: number;
}): { value: string; payload: MspSsoDiscoveryPayload } {
  const now = params.now ?? Date.now();
  const ttl = params.ttlSeconds ?? MSP_SSO_DISCOVERY_TTL_SECONDS;
  const payload: MspSsoDiscoveryPayload = {
    source: params.source,
    tenantId: params.tenantId,
    providers: normalizeProviders(params.providers),
    issuedAt: now,
    expiresAt: now + ttl * 1000,
    nonce: randomBytes(16).toString('hex'),
  };

  const payloadEncoded = toBase64Url(JSON.stringify(payload));
  const signature = computeCookieSignature(payloadEncoded, params.secret);
  return { value: `${payloadEncoded}.${signature}`, payload };
}

export function parseAndVerifyMspSsoResolutionCookie(params: {
  value: string | undefined;
  secret: string;
  now?: number;
}): MspSsoResolutionPayload | null {
  const { value, secret } = params;
  if (!value) return null;

  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [payloadEncoded, signature] = parts;
  if (!payloadEncoded || !signature) return null;

  const expected = computeCookieSignature(payloadEncoded, secret);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    return null;
  }

  let payload: MspSsoResolutionPayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadEncoded)) as MspSsoResolutionPayload;
  } catch {
    return null;
  }

  if (!payload || !isSupportedProvider(payload.provider)) return null;
  if (payload.source !== 'tenant' && payload.source !== 'app') return null;
  if (typeof payload.issuedAt !== 'number' || typeof payload.expiresAt !== 'number') return null;
  if (typeof payload.nonce !== 'string' || payload.nonce.length < 8) return null;

  const now = params.now ?? Date.now();
  if (payload.expiresAt <= now) return null;
  return payload;
}

export function parseAndVerifyMspSsoDiscoveryCookie(params: {
  value: string | undefined;
  secret: string;
  now?: number;
}): MspSsoDiscoveryPayload | null {
  const { value, secret } = params;
  if (!value) return null;

  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [payloadEncoded, signature] = parts;
  if (!payloadEncoded || !signature) return null;

  const expected = computeCookieSignature(payloadEncoded, secret);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    return null;
  }

  let payload: MspSsoDiscoveryPayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadEncoded)) as MspSsoDiscoveryPayload;
  } catch {
    return null;
  }

  if (!payload) return null;
  if (payload.source !== 'tenant' && payload.source !== 'app') return null;
  if (typeof payload.issuedAt !== 'number' || typeof payload.expiresAt !== 'number') return null;
  if (typeof payload.nonce !== 'string' || payload.nonce.length < 8) return null;
  if (!Array.isArray(payload.providers)) return null;

  const providers = normalizeProviders(payload.providers);
  if (providers.length !== payload.providers.length) return null;

  const now = params.now ?? Date.now();
  if (payload.expiresAt <= now) return null;

  return {
    ...payload,
    providers,
  };
}
