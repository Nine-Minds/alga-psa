import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { getAdminConnection } from '@alga-psa/db/admin';

export type MspSsoProviderId = 'google' | 'azure-ad';
export type MspSsoSource = 'tenant' | 'app';

export const MSP_SSO_RESOLUTION_COOKIE = 'msp_sso_resolution';
export const MSP_SSO_RESOLUTION_TTL_SECONDS = 5 * 60;
export const MSP_SSO_GENERIC_FAILURE_MESSAGE =
  "We couldn't start SSO sign-in. Please verify provider setup and try again.";

export interface MspSsoResolutionPayload {
  provider: MspSsoProviderId;
  source: MspSsoSource;
  tenantId?: string;
  userId?: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

interface ResolverInputs {
  provider: MspSsoProviderId;
  email: string;
}

interface ResolverOutcome {
  resolved: boolean;
  source?: MspSsoSource;
  userId?: string;
  tenantId?: string;
  userFound: boolean;
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

export function normalizeResolverEmail(value: string): string {
  return value.trim().toLowerCase();
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

async function hasTenantProviderCredentials(tenant: string, provider: MspSsoProviderId): Promise<boolean> {
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

async function hasAppFallbackCredentials(provider: MspSsoProviderId): Promise<boolean> {
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

export async function resolveMspSsoCredentialSource(inputs: ResolverInputs): Promise<ResolverOutcome> {
  const email = normalizeResolverEmail(inputs.email);
  const db = await getAdminConnection();

  const user = await db('users')
    .select('user_id', 'tenant')
    .whereRaw('LOWER(email) = ?', [email])
    .andWhere({ user_type: 'internal', is_inactive: false })
    .first();

  const userFound = Boolean(user);
  if (user && (await hasTenantProviderCredentials(user.tenant, inputs.provider))) {
    return {
      resolved: true,
      source: 'tenant',
      tenantId: user.tenant,
      userId: user.user_id,
      userFound,
    };
  }

  if (await hasAppFallbackCredentials(inputs.provider)) {
    return {
      resolved: true,
      source: 'app',
      userFound,
    };
  }

  return {
    resolved: false,
    userFound,
  };
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
