import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getAdminConnection } from '@alga-psa/db/admin';
import { getTenantIdBySlug, isValidTenantSlug } from '@alga-psa/db';
import {
  type MspSsoProviderId,
  MSP_SSO_DISCOVERY_TTL_SECONDS,
  MSP_SSO_GENERIC_FAILURE_MESSAGE,
  MSP_SSO_RESOLUTION_TTL_SECONDS,
  getMspSsoSigningSecret,
  hasTenantProviderCredentials,
  isValidResolverCallbackUrl,
  normalizeResolverEmail,
  parseResolverProvider,
} from './mspSsoResolution';

export const CLIENT_PORTAL_SSO_DISCOVERY_COOKIE = 'client_portal_sso_discovery';
export const CLIENT_PORTAL_SSO_RESOLUTION_COOKIE = 'client_portal_sso_resolution';
export const CLIENT_PORTAL_SSO_GENERIC_FAILURE_MESSAGE = MSP_SSO_GENERIC_FAILURE_MESSAGE;
export const CLIENT_PORTAL_SSO_DISCOVERY_TTL_SECONDS = MSP_SSO_DISCOVERY_TTL_SECONDS;
export const CLIENT_PORTAL_SSO_RESOLUTION_TTL_SECONDS = MSP_SSO_RESOLUTION_TTL_SECONDS;

type ClientPortalSsoDiscoveryPayload = {
  audience: 'client_portal';
  tenantId: string;
  providers: MspSsoProviderId[];
  callbackUrl?: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

type ClientPortalSsoResolutionPayload = {
  audience: 'client_portal';
  provider: MspSsoProviderId;
  tenantId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

type ClientPortalTenantContextInput = {
  tenantSlug?: string | null;
  portalDomain?: string | null;
  callbackUrl?: string | null;
};

function toBase64Url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const withPadding = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(withPadding, 'base64').toString('utf8');
}

function computeSignature(payloadEncoded: string, secret: string): string {
  return toBase64Url(createHmac('sha256', secret).update(payloadEncoded).digest());
}

function normalizeProviders(values: unknown): MspSsoProviderId[] {
  if (!Array.isArray(values)) return [];
  const providers = values.filter((provider): provider is MspSsoProviderId => provider === 'google' || provider === 'azure-ad');
  return Array.from(new Set(providers));
}

function normalizePortalDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, '').replace(/^https?:\/\//, '').split('/')[0];
}

async function resolveTenantIdFromPortalDomain(domain: string): Promise<string | undefined> {
  const normalizedDomain = normalizePortalDomain(domain);
  if (!normalizedDomain) return undefined;
  const db = await getAdminConnection();
  const record = await db('portal_domains')
    .select('tenant')
    .where({ domain: normalizedDomain, status: 'active' })
    .first();
  return typeof record?.tenant === 'string' ? record.tenant : undefined;
}

async function resolveTenantIdFromCallbackUrl(callbackUrl: string): Promise<string | undefined> {
  if (!isValidResolverCallbackUrl(callbackUrl)) return undefined;
  const trimmed = callbackUrl.trim();
  if (!trimmed || trimmed.startsWith('/')) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }

  if (!parsed.pathname.startsWith('/client-portal')) {
    return undefined;
  }

  const tenantFromQuery = parsed.searchParams.get('tenant');
  if (tenantFromQuery && isValidTenantSlug(tenantFromQuery)) {
    return (await getTenantIdBySlug(tenantFromQuery.toLowerCase())) ?? undefined;
  }

  return resolveTenantIdFromPortalDomain(parsed.hostname);
}

export async function resolveClientPortalSsoTenantContext(
  input: ClientPortalTenantContextInput
): Promise<{ tenantId?: string }> {
  const slug = typeof input.tenantSlug === 'string' ? input.tenantSlug.trim().toLowerCase() : '';
  if (slug && isValidTenantSlug(slug)) {
    const tenantId = await getTenantIdBySlug(slug);
    if (tenantId) return { tenantId };
  }

  const portalDomain = typeof input.portalDomain === 'string' ? input.portalDomain : '';
  if (portalDomain) {
    const tenantId = await resolveTenantIdFromPortalDomain(portalDomain);
    if (tenantId) return { tenantId };
  }

  const callbackUrl = typeof input.callbackUrl === 'string' ? input.callbackUrl : '';
  if (callbackUrl) {
    const tenantId = await resolveTenantIdFromCallbackUrl(callbackUrl);
    if (tenantId) return { tenantId };
  }

  return {};
}

export async function discoverClientPortalSsoProviders(tenantId: string): Promise<MspSsoProviderId[]> {
  const [googleReady, microsoftReady] = await Promise.all([
    hasTenantProviderCredentials(tenantId, 'google'),
    hasTenantProviderCredentials(tenantId, 'azure-ad'),
  ]);

  return normalizeProviders([...(googleReady ? ['google'] : []), ...(microsoftReady ? ['azure-ad'] : [])]);
}

export function createSignedClientPortalSsoDiscoveryCookie(params: {
  tenantId: string;
  providers: MspSsoProviderId[];
  callbackUrl?: string;
  secret: string;
  ttlSeconds?: number;
  now?: number;
}): { value: string; payload: ClientPortalSsoDiscoveryPayload } {
  const now = params.now ?? Date.now();
  const ttl = params.ttlSeconds ?? CLIENT_PORTAL_SSO_DISCOVERY_TTL_SECONDS;
  const payload: ClientPortalSsoDiscoveryPayload = {
    audience: 'client_portal',
    tenantId: params.tenantId,
    providers: normalizeProviders(params.providers),
    callbackUrl: typeof params.callbackUrl === 'string' ? params.callbackUrl.trim() || undefined : undefined,
    issuedAt: now,
    expiresAt: now + ttl * 1000,
    nonce: randomBytes(16).toString('hex'),
  };

  const payloadEncoded = toBase64Url(JSON.stringify(payload));
  const signature = computeSignature(payloadEncoded, params.secret);
  return { value: `${payloadEncoded}.${signature}`, payload };
}

export function parseAndVerifyClientPortalSsoDiscoveryCookie(params: {
  value: string | undefined;
  secret: string;
  now?: number;
}): ClientPortalSsoDiscoveryPayload | null {
  const { value, secret } = params;
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [payloadEncoded, signature] = parts;
  if (!payloadEncoded || !signature) return null;
  const expected = computeSignature(payloadEncoded, secret);
  if (Buffer.from(expected).length !== Buffer.from(signature).length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;

  let payload: ClientPortalSsoDiscoveryPayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadEncoded)) as ClientPortalSsoDiscoveryPayload;
  } catch {
    return null;
  }

  if (!payload || payload.audience !== 'client_portal') return null;
  if (typeof payload.tenantId !== 'string' || payload.tenantId.length === 0) return null;
  if (typeof payload.issuedAt !== 'number' || typeof payload.expiresAt !== 'number') return null;
  if (typeof payload.nonce !== 'string' || payload.nonce.length < 8) return null;
  const providers = normalizeProviders(payload.providers);
  if (providers.length !== payload.providers.length) return null;
  if (payload.callbackUrl !== undefined && !isValidResolverCallbackUrl(payload.callbackUrl)) return null;
  const now = params.now ?? Date.now();
  if (payload.expiresAt <= now) return null;

  return { ...payload, providers };
}

export function createSignedClientPortalSsoResolutionCookie(params: {
  tenantId: string;
  provider: MspSsoProviderId;
  secret: string;
  ttlSeconds?: number;
  now?: number;
}): { value: string; payload: ClientPortalSsoResolutionPayload } {
  const now = params.now ?? Date.now();
  const ttl = params.ttlSeconds ?? CLIENT_PORTAL_SSO_RESOLUTION_TTL_SECONDS;
  const payload: ClientPortalSsoResolutionPayload = {
    audience: 'client_portal',
    tenantId: params.tenantId,
    provider: params.provider,
    issuedAt: now,
    expiresAt: now + ttl * 1000,
    nonce: randomBytes(16).toString('hex'),
  };
  const payloadEncoded = toBase64Url(JSON.stringify(payload));
  const signature = computeSignature(payloadEncoded, params.secret);
  return { value: `${payloadEncoded}.${signature}`, payload };
}

export function parseAndVerifyClientPortalSsoResolutionCookie(params: {
  value: string | undefined;
  secret: string;
  now?: number;
}): ClientPortalSsoResolutionPayload | null {
  const { value, secret } = params;
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [payloadEncoded, signature] = parts;
  if (!payloadEncoded || !signature) return null;
  const expected = computeSignature(payloadEncoded, secret);
  if (Buffer.from(expected).length !== Buffer.from(signature).length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;

  let payload: ClientPortalSsoResolutionPayload;
  try {
    payload = JSON.parse(fromBase64Url(payloadEncoded)) as ClientPortalSsoResolutionPayload;
  } catch {
    return null;
  }
  if (!payload || payload.audience !== 'client_portal') return null;
  if (parseResolverProvider(payload.provider) === null) return null;
  if (typeof payload.tenantId !== 'string' || payload.tenantId.length === 0) return null;
  if (typeof payload.issuedAt !== 'number' || typeof payload.expiresAt !== 'number') return null;
  if (typeof payload.nonce !== 'string' || payload.nonce.length < 8) return null;
  const now = params.now ?? Date.now();
  if (payload.expiresAt <= now) return null;
  return payload;
}

export {
  getMspSsoSigningSecret,
  isValidResolverCallbackUrl,
  normalizeResolverEmail,
  parseResolverProvider,
};
