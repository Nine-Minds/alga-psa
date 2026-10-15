import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { resolveMicrosoftConsumerProfileConfig } from '../microsoftConsumerProfileResolution';

export type MspSsoProviderId = 'google' | 'azure-ad' | 'keycloak';
export type MspSsoSource = 'tenant' | 'app';
export type MspSsoDomainClaimStatus =
  | 'advisory'
  | 'pending'
  | 'verified'
  | 'verified_legacy'
  | 'rejected'
  | 'revoked';
export type MspSsoEdition = 'ee' | 'ce';

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

const PROVIDER_ORDER: MspSsoProviderId[] = ['google', 'azure-ad', 'keycloak'];
export const KEYCLOAK_APP_SECRET_KEYS = [
  'KEYCLOAK_CLIENT_ID',
  'KEYCLOAK_CLIENT_SECRET',
  'KEYCLOAK_URL',
  'KEYCLOAK_REALM',
] as const;
// Tenant-owned Keycloak configuration (Settings → Security → Single Sign-On).
export const KEYCLOAK_TENANT_SECRET_KEYS = {
  url: 'keycloak_url',
  realm: 'keycloak_realm',
  clientId: 'keycloak_client_id',
  clientSecret: 'keycloak_client_secret',
} as const;

export interface KeycloakSsoConfig {
  url: string;
  realm: string;
  clientId: string;
  clientSecret: string;
}

export function buildKeycloakIssuer(url: string, realm: string): string {
  return `${url.trim().replace(/\/+$/, '')}/realms/${realm.trim()}`;
}

export async function readTenantKeycloakConfig(tenant: string): Promise<KeycloakSsoConfig | null> {
  const secretProvider = await getSecretProviderInstance();
  const [url, realm, clientId, clientSecret] = await Promise.all([
    secretProvider.getTenantSecret(tenant, KEYCLOAK_TENANT_SECRET_KEYS.url),
    secretProvider.getTenantSecret(tenant, KEYCLOAK_TENANT_SECRET_KEYS.realm),
    secretProvider.getTenantSecret(tenant, KEYCLOAK_TENANT_SECRET_KEYS.clientId),
    secretProvider.getTenantSecret(tenant, KEYCLOAK_TENANT_SECRET_KEYS.clientSecret),
  ]);
  if (![url, realm, clientId, clientSecret].every(isConfigured)) return null;
  return {
    url: (url as string).trim(),
    realm: (realm as string).trim(),
    clientId: (clientId as string).trim(),
    clientSecret: (clientSecret as string).trim(),
  };
}
const MSP_SSO_DOMAIN_DISCOVERY_CONTEXT = 'msp-sso-domain-discovery';
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
  domain: string;
  providers: MspSsoProviderId[];
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

interface ResolverInputs {
  provider: MspSsoProviderId;
  email?: string;
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
  claimStatus?: MspSsoDomainClaimStatus;
  eligibleForTakeover?: boolean;
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

export function isSupportedProvider(provider: string): provider is MspSsoProviderId {
  return provider === 'google' || provider === 'azure-ad' || provider === 'keycloak';
}

// Community Edition offers Keycloak only; Google and Microsoft sign-in are Enterprise.
// The sign-in buttons apply the same rule client-side.
export function isProviderOfferedInEdition(provider: MspSsoProviderId, edition = getMspSsoEdition()): boolean {
  return edition === 'ee' || provider === 'keycloak';
}

function filterProvidersForEdition(providers: MspSsoProviderId[]): MspSsoProviderId[] {
  const edition = getMspSsoEdition();
  return providers.filter((provider) => isProviderOfferedInEdition(provider, edition));
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

export function getMspSsoEdition(): MspSsoEdition {
  const edition = (process.env.EDITION ?? '').trim().toLowerCase();
  const publicEdition = (process.env.NEXT_PUBLIC_EDITION ?? '').trim().toLowerCase();
  if (edition === 'ee' || edition === 'enterprise' || publicEdition === 'enterprise') {
    return 'ee';
  }
  return 'ce';
}

export function isClaimStatusEligibleForTenantTakeover(
  edition: MspSsoEdition,
  claimStatus: MspSsoDomainClaimStatus
): boolean {
  if (edition === 'ee') {
    return claimStatus === 'verified' || claimStatus === 'verified_legacy';
  }

  return claimStatus !== 'revoked' && claimStatus !== 'rejected';
}

function claimStatusPriority(status: MspSsoDomainClaimStatus): number {
  if (status === 'verified') return 6;
  if (status === 'verified_legacy') return 5;
  if (status === 'pending') return 4;
  if (status === 'advisory') return 3;
  if (status === 'rejected') return 2;
  return 1;
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
  if (trimmed.startsWith('/')) return !trimmed.startsWith('//');

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isValidClientPortalResolverCallbackUrl(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//')) return false;
    return trimmed.startsWith('/client-portal') ||
      trimmed.startsWith('/auth/client-portal/handoff');
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return parsed.pathname.startsWith('/client-portal') ||
      parsed.pathname.startsWith('/auth/client-portal/handoff');
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
  if (provider === 'google') {
    const secretProvider = await getSecretProviderInstance();
    const [clientId, clientSecret] = await Promise.all([
      secretProvider.getTenantSecret(tenant, 'google_client_id'),
      secretProvider.getTenantSecret(tenant, 'google_client_secret'),
    ]);
    return isConfigured(clientId) && isConfigured(clientSecret);
  }

  if (provider === 'keycloak') {
    return (await readTenantKeycloakConfig(tenant)) !== null;
  }

  const microsoftProfile = await resolveMicrosoftConsumerProfileConfig(tenant, 'msp_sso');
  return microsoftProfile.status === 'ready';
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

  if (provider === 'keycloak') {
    const values = await Promise.all(
      KEYCLOAK_APP_SECRET_KEYS.map(
        async (key) => process.env[key] || (await secretProvider.getAppSecret(key))
      )
    );
    return values.every(isConfigured);
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
  const rows = await tenantDb(db, MSP_SSO_DOMAIN_DISCOVERY_CONTEXT)
    .unscoped(
      MSP_SSO_LOGIN_DOMAIN_TABLE,
      'tenant discovery from MSP SSO login domain before tenant context exists'
    )
    .select('tenant', 'claim_status')
    .where({ is_active: true })
    .whereRaw('lower(domain) = ?', [normalizedDomain]);

  const tenantStatusMap = new Map<string, MspSsoDomainClaimStatus>();
  for (const row of rows as Array<Record<string, unknown>>) {
    const tenant = row.tenant;
    if (typeof tenant !== 'string' || tenant.length === 0) continue;
    const status = normalizeMspSsoDomainClaimStatus(row.claim_status);
    const current = tenantStatusMap.get(tenant);
    if (!current || claimStatusPriority(status) > claimStatusPriority(current)) {
      tenantStatusMap.set(tenant, status);
    }
  }

  const tenants = Array.from(tenantStatusMap.keys());

  if (tenants.length === 1) {
    const edition = getMspSsoEdition();
    const claimStatus = tenantStatusMap.get(tenants[0]) ?? 'advisory';
    return {
      tenantId: tenants[0],
      ambiguous: false,
      claimStatus,
      eligibleForTakeover: isClaimStatusEligibleForTenantTakeover(edition, claimStatus),
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
  if (
    domainResolution.tenantId &&
    !domainResolution.ambiguous &&
    domainResolution.eligibleForTakeover
  ) {
    // Keycloak prefers the tenant's own realm; a deployment-level KEYCLOAK_* env
    // still offers it here, and the resolver then falls back to the 'app' source.
    const [googleReady, microsoftReady, tenantKeycloakReady, appKeycloakReady] = await Promise.all([
      hasTenantProviderCredentials(domainResolution.tenantId, 'google'),
      hasTenantProviderCredentials(domainResolution.tenantId, 'azure-ad'),
      hasTenantProviderCredentials(domainResolution.tenantId, 'keycloak'),
      hasAppFallbackProviderCredentials('keycloak'),
    ]);
    const keycloakReady = tenantKeycloakReady || appKeycloakReady;

    return {
      source: 'tenant',
      tenantId: domainResolution.tenantId,
      providers: filterProvidersForEdition(normalizeProviders([
        ...(googleReady ? ['google'] : []),
        ...(microsoftReady ? ['azure-ad'] : []),
        ...(keycloakReady ? ['keycloak'] : []),
      ])),
      domain,
      ambiguous: false,
    };
  }

  const [googleReady, microsoftReady, keycloakReady] = await Promise.all([
    hasAppFallbackProviderCredentials('google'),
    hasAppFallbackProviderCredentials('azure-ad'),
    hasAppFallbackProviderCredentials('keycloak'),
  ]);

  return {
    source: 'app',
    providers: filterProvidersForEdition(normalizeProviders([
      ...(googleReady ? ['google'] : []),
      ...(microsoftReady ? ['azure-ad'] : []),
      ...(keycloakReady ? ['keycloak'] : []),
    ])),
    domain,
    ambiguous: domainResolution.ambiguous,
  };
}

export async function resolveMspSsoCredentialSource(
  inputs: ResolverInputs
): Promise<ResolverOutcome> {
  if (!isProviderOfferedInEdition(inputs.provider)) {
    return { resolved: false };
  }

  const normalizedEmail = typeof inputs.email === 'string' ? normalizeResolverEmail(inputs.email) : '';
  const emailDomain = extractDomainFromEmail(normalizedEmail);
  const discovery = inputs.discovery;
  if (discovery) {
    const allowedProviders = normalizeProviders(discovery.providers);
    if (!allowedProviders.includes(inputs.provider)) {
      return { resolved: false };
    }

    if (discovery.source === 'tenant' && discovery.tenantId) {
      const shouldEvaluateTenantSource = !emailDomain || discovery.domain === emailDomain;
      let tenantTakeoverEligible = false;

      if (shouldEvaluateTenantSource) {
        const tenantResolution = await resolveTenantForMspSsoDomain(discovery.domain);
        tenantTakeoverEligible =
          Boolean(tenantResolution.tenantId) &&
          !tenantResolution.ambiguous &&
          tenantResolution.tenantId === discovery.tenantId &&
          Boolean(tenantResolution.eligibleForTakeover);
      }

      if (
        tenantTakeoverEligible &&
        (await hasTenantProviderCredentials(discovery.tenantId, inputs.provider))
      ) {
        return {
          resolved: true,
          source: 'tenant',
          tenantId: discovery.tenantId,
        };
      }

      if (await hasAppFallbackProviderCredentials(inputs.provider)) {
        return {
          resolved: true,
          source: 'app',
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
  domain: string;
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
    domain: normalizeMspSsoDomain(params.domain),
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
  if (typeof payload.domain !== 'string' || Boolean(validateMspSsoDomain(payload.domain))) return null;
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
