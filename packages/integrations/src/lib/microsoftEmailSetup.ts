import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const MICROSOFT_GRAPH_RESOURCE_APP_ID = '00000003-0000-0000-c000-000000000000';

export const MICROSOFT_EMAIL_DELEGATED_PERMISSION_IDS = {
  mailRead: '570282fd-fa5c-430d-a7fd-fc8dc98a9dca',
  mailReadShared: '7b9103a5-4610-446b-9670-80643382c1fa',
  offlineAccess: '7427e0e9-2fba-42fe-b0c0-848c9e6a8182',
} as const;

export const MICROSOFT_EMAIL_SETUP_BOOTSTRAP_SCOPES = [
  'https://graph.microsoft.com/Application.ReadWrite.All',
  'openid',
  'profile',
  'email',
] as const;

// The v2.0 /adminconsent endpoint rejects requests without a scope
// (AADSTS900144); .default consents to the permissions on the app registration.
export const MICROSOFT_EMAIL_ADMIN_CONSENT_SCOPE = 'https://graph.microsoft.com/.default';

export const MICROSOFT_EMAIL_SETUP_STATE_TTL_SECONDS = 10 * 60;

export interface MicrosoftEmailApplicationManifest {
  displayName: string;
  signInAudience: 'AzureADMultipleOrgs';
  web: {
    redirectUris: string[];
  };
  requiredResourceAccess: Array<{
    resourceAppId: string;
    resourceAccess: Array<{ id: string; type: 'Scope' }>;
  }>;
}

export interface MicrosoftEmailSetupStatePayload {
  purpose: 'create_application' | 'admin_consent';
  algaTenant: string;
  userId: string;
  returnTo: string;
  nonce: string;
  oauthNonce?: string;
  displayName?: string;
  clientId?: string;
  profileId?: string;
  issuedAt: number;
  expiresAt: number;
}

function toBase64Url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signPayload(payloadEncoded: string, secret: string): string {
  return toBase64Url(createHmac('sha256', secret).update(payloadEncoded).digest());
}

export function buildMicrosoftEmailAdminConsentUrl(input: {
  tenant: string;
  clientId: string;
  redirectUri: string;
  state: string;
  loginBaseUrl?: string;
}): string {
  const tenant = validateMicrosoftTenantIdentifier(input.tenant);
  const clientId = input.clientId.trim();
  if (!clientId) {
    throw new Error('Microsoft application client ID is required');
  }

  const redirectUri = new URL(input.redirectUri).toString();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: MICROSOFT_EMAIL_ADMIN_CONSENT_SCOPE,
    state: input.state,
  });

  const loginBaseUrl = (input.loginBaseUrl || 'https://login.microsoftonline.com').replace(/\/+$/, '');
  return `${loginBaseUrl}/${encodeURIComponent(tenant)}/v2.0/adminconsent?${params.toString()}`;
}

export function buildMicrosoftEmailApplicationManifest(input: {
  displayName: string;
  mailboxRedirectUri: string;
  setupRedirectUri?: string;
}): MicrosoftEmailApplicationManifest {
  const displayName = input.displayName.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!displayName) {
    throw new Error('Microsoft application display name is required');
  }

  const redirectUris = [input.mailboxRedirectUri, input.setupRedirectUri]
    .filter((value): value is string => Boolean(value))
    .map((value) => new URL(value).toString());

  return {
    displayName,
    signInAudience: 'AzureADMultipleOrgs',
    web: {
      redirectUris: [...new Set(redirectUris)],
    },
    requiredResourceAccess: [
      {
        resourceAppId: MICROSOFT_GRAPH_RESOURCE_APP_ID,
        resourceAccess: Object.values(MICROSOFT_EMAIL_DELEGATED_PERMISSION_IDS).map((id) => ({
          id,
          type: 'Scope' as const,
        })),
      },
    ],
  };
}

export function createMicrosoftEmailSetupState(input: {
  purpose: MicrosoftEmailSetupStatePayload['purpose'];
  algaTenant: string;
  userId: string;
  returnTo: string;
  secret: string;
  displayName?: string;
  clientId?: string;
  profileId?: string;
  includeOauthNonce?: boolean;
  ttlSeconds?: number;
}): { token: string; payload: MicrosoftEmailSetupStatePayload } {
  if (!input.secret.trim()) {
    throw new Error('Microsoft email setup signing secret is not configured');
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: MicrosoftEmailSetupStatePayload = {
    purpose: input.purpose,
    algaTenant: input.algaTenant,
    userId: input.userId,
    returnTo: new URL(input.returnTo).toString(),
    nonce: randomBytes(24).toString('hex'),
    ...(input.includeOauthNonce ? { oauthNonce: randomBytes(24).toString('hex') } : {}),
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.clientId ? { clientId: input.clientId } : {}),
    ...(input.profileId ? { profileId: input.profileId } : {}),
    issuedAt,
    expiresAt: issuedAt + (input.ttlSeconds ?? MICROSOFT_EMAIL_SETUP_STATE_TTL_SECONDS),
  };
  const payloadEncoded = toBase64Url(JSON.stringify(payload));
  return {
    token: `${payloadEncoded}.${signPayload(payloadEncoded, input.secret)}`,
    payload,
  };
}

export function validateMicrosoftEmailSetupState(input: {
  token: string | null | undefined;
  secret: string | null | undefined;
  now?: number;
}): MicrosoftEmailSetupStatePayload | null {
  if (!input.token || !input.secret) return null;

  const [payloadEncoded, signature, extra] = input.token.split('.');
  if (!payloadEncoded || !signature || extra) return null;

  const expected = Buffer.from(signPayload(payloadEncoded, input.secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(payloadEncoded)) as Partial<MicrosoftEmailSetupStatePayload>;
    if (
      (payload.purpose !== 'create_application' && payload.purpose !== 'admin_consent') ||
      typeof payload.algaTenant !== 'string' ||
      typeof payload.userId !== 'string' ||
      typeof payload.returnTo !== 'string' ||
      typeof payload.nonce !== 'string' ||
      typeof payload.issuedAt !== 'number' ||
      typeof payload.expiresAt !== 'number'
    ) {
      return null;
    }

    new URL(payload.returnTo);
    const now = input.now ?? Math.floor(Date.now() / 1000);
    if (payload.issuedAt > now + 60 || payload.expiresAt <= now) return null;
    if (payload.purpose === 'create_application' && !payload.oauthNonce) return null;
    if (payload.purpose === 'admin_consent' && (!payload.clientId || !payload.profileId)) return null;

    return payload as MicrosoftEmailSetupStatePayload;
  } catch {
    return null;
  }
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function validateMicrosoftTenantIdentifier(value: string): string {
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const domainPattern = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

  if (!uuidPattern.test(normalized) && !domainPattern.test(normalized)) {
    throw new Error('Enter a valid Microsoft tenant ID or verified tenant domain');
  }

  return normalized;
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}
