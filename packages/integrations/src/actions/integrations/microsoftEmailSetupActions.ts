'use server';

import axios, { type AxiosError } from 'axios';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  getMicrosoftAuthorizeUrl,
  getMicrosoftGraphBaseUrl,
  getMicrosoftLoginBaseUrl,
  getMicrosoftTokenUrl,
} from '@alga-psa/shared/services/email/microsoftGraphEndpoints';
import {
  buildMicrosoftEmailAdminConsentUrl,
  buildMicrosoftEmailApplicationManifest,
  createMicrosoftEmailSetupState,
  createPkcePair,
  decodeJwtPayload,
  MICROSOFT_EMAIL_SETUP_BOOTSTRAP_SCOPES,
  type MicrosoftEmailSetupStatePayload,
  validateMicrosoftTenantIdentifier,
} from '../../lib/microsoftEmailSetup';
import {
  consumeMicrosoftEmailSetupState,
  storeMicrosoftEmailSetupState,
} from '../../utils/microsoftEmailSetupStateStore';
import {
  createMicrosoftEmailProfilePendingConsentInternal,
  getMicrosoftEmailSetupMetadataInternal,
} from './microsoftActions';

interface PlatformMicrosoftCredentials {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

interface BootstrapMicrosoftCredentials {
  clientId: string;
  clientSecret?: string;
}

interface GraphApplicationResult {
  id: string;
  appId: string;
  displayName: string;
}

interface GraphServicePrincipalResult {
  id: string;
  appId: string;
}

interface GraphPasswordResult {
  secretText: string;
}

export interface MicrosoftEmailSetupOptionsResult {
  success: boolean;
  error?: string;
  callbackUri?: string;
  setupCallbackUri?: string;
  platformApplication?: {
    available: boolean;
    clientId?: string;
  };
  automatedCreationAvailable?: boolean;
}

export interface MicrosoftEmailSetupCompletionResult {
  success: boolean;
  error?: string;
  profileId?: string;
  displayName?: string;
  tenantId?: string;
  clientId?: string;
  adminConsentUrl?: string;
}

function isClientPortalUser(user: any): boolean {
  return user?.user_type === 'client';
}

async function canManageMicrosoftSettings(user: any): Promise<boolean> {
  return !isClientPortalUser(user) && hasPermission(user as any, 'system_settings', 'update');
}

async function getAppSecret(name: string): Promise<string | null> {
  const secretProvider = await getSecretProviderInstance();
  return ((await secretProvider.getAppSecret(name)) || process.env[name] || '').trim() || null;
}

async function resolvePlatformMicrosoftCredentials(): Promise<PlatformMicrosoftCredentials | null> {
  const [clientId, clientSecret, tenantId] = await Promise.all([
    getAppSecret('MICROSOFT_CLIENT_ID'),
    getAppSecret('MICROSOFT_CLIENT_SECRET'),
    getAppSecret('MICROSOFT_TENANT_ID'),
  ]);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, tenantId: tenantId || 'common' };
}

async function resolveBootstrapMicrosoftCredentials(): Promise<BootstrapMicrosoftCredentials | null> {
  const [setupClientId, setupClientSecret, platformClientId, platformClientSecret] = await Promise.all([
    getAppSecret('MICROSOFT_EMAIL_SETUP_CLIENT_ID'),
    getAppSecret('MICROSOFT_EMAIL_SETUP_CLIENT_SECRET'),
    getAppSecret('MICROSOFT_CLIENT_ID'),
    getAppSecret('MICROSOFT_CLIENT_SECRET'),
  ]);
  const clientId = setupClientId || platformClientId;
  if (!clientId) return null;
  return {
    clientId,
    clientSecret: setupClientSecret || platformClientSecret || undefined,
  };
}

export async function getMicrosoftEmailSetupSigningSecret(): Promise<string | null> {
  return getAppSecret('NEXTAUTH_SECRET');
}

function buildBootstrapAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  challenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    response_type: 'code',
    redirect_uri: input.redirectUri,
    response_mode: 'query',
    scope: MICROSOFT_EMAIL_SETUP_BOOTSTRAP_SCOPES.join(' '),
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${getMicrosoftAuthorizeUrl('common')}?${params.toString()}`;
}

function getGraphErrorMessage(error: unknown, operation: string): string {
  const axiosError = error as AxiosError<{ error?: { code?: string } }>;
  const status = axiosError.response?.status;
  const code = axiosError.response?.data?.error?.code;
  if (status === 401 || status === 403) {
    return `Microsoft denied permission to ${operation}. Sign in with an Application Administrator, Cloud Application Administrator, or another account allowed to manage app registrations.`;
  }
  if (status === 409) {
    return `Microsoft reported a conflict while trying to ${operation}. Choose a different app name and retry.`;
  }
  return `Microsoft Graph could not ${operation}${code ? ` (${code})` : ''}. Retry, or use the platform/manual setup option.`;
}

async function graphRequest<T>(input: {
  method: 'POST' | 'DELETE';
  path: string;
  accessToken: string;
  body?: unknown;
}): Promise<T> {
  const response = await axios.request<T>({
    method: input.method,
    url: `${getMicrosoftGraphBaseUrl()}${input.path}`,
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: 'application/json',
      ...(input.body ? { 'Content-Type': 'application/json' } : {}),
    },
    data: input.body,
    timeout: 20_000,
  });
  return response.data;
}

async function cleanupGraphObjects(input: {
  accessToken: string;
  applicationObjectId?: string;
  servicePrincipalObjectId?: string;
}): Promise<string[]> {
  const remaining: string[] = [];
  if (input.servicePrincipalObjectId) {
    try {
      await graphRequest<void>({
        method: 'DELETE',
        path: `/servicePrincipals/${encodeURIComponent(input.servicePrincipalObjectId)}`,
        accessToken: input.accessToken,
      });
    } catch {
      remaining.push('service principal');
    }
  }
  if (input.applicationObjectId) {
    try {
      await graphRequest<void>({
        method: 'DELETE',
        path: `/applications/${encodeURIComponent(input.applicationObjectId)}`,
        accessToken: input.accessToken,
      });
    } catch {
      remaining.push('application registration');
    }
  }
  return remaining;
}

function assertMicrosoftTokenClaims(input: {
  accessToken: string;
  idToken: string;
  expectedNonce: string;
}): { tenantId: string } {
  const accessClaims = decodeJwtPayload(input.accessToken);
  const idClaims = decodeJwtPayload(input.idToken);
  const tenantId = typeof accessClaims?.tid === 'string' ? accessClaims.tid : '';
  const issuer = typeof accessClaims?.iss === 'string' ? accessClaims.iss : '';
  const scope = typeof accessClaims?.scp === 'string' ? accessClaims.scp.split(' ') : [];
  const nonce = typeof idClaims?.nonce === 'string' ? idClaims.nonce : '';

  validateMicrosoftTenantIdentifier(tenantId);
  const acceptedIssuers = new Set([
    `https://sts.windows.net/${tenantId}/`,
    `https://login.microsoftonline.com/${tenantId}/v2.0`,
  ]);
  if (!acceptedIssuers.has(issuer)) {
    throw new Error('Microsoft returned a token for an unexpected issuer');
  }
  if (nonce !== input.expectedNonce) {
    throw new Error('Microsoft sign-in nonce did not match the setup request');
  }
  if (!scope.some((value) => value.toLowerCase() === 'application.readwrite.all')) {
    throw new Error('Microsoft did not grant Application.ReadWrite.All for app registration setup');
  }
  return { tenantId };
}

function createAdminConsentState(input: {
  algaTenant: string;
  userId: string;
  returnTo: string;
  clientId: string;
  profileId: string;
  secret: string;
}) {
  return createMicrosoftEmailSetupState({
    purpose: 'admin_consent',
    algaTenant: input.algaTenant,
    userId: input.userId,
    returnTo: input.returnTo,
    clientId: input.clientId,
    profileId: input.profileId,
    secret: input.secret,
  });
}

export const getMicrosoftEmailSetupOptions = withAuth(async (
  user
): Promise<MicrosoftEmailSetupOptionsResult> => {
  if (!(await canManageMicrosoftSettings(user))) return { success: false, error: 'Forbidden' };
  const [metadata, platformCredentials, bootstrapCredentials, signingSecret] = await Promise.all([
    getMicrosoftEmailSetupMetadataInternal(),
    resolvePlatformMicrosoftCredentials(),
    resolveBootstrapMicrosoftCredentials(),
    getMicrosoftEmailSetupSigningSecret(),
  ]);
  return {
    success: true,
    callbackUri: metadata.mailboxRedirectUri,
    setupCallbackUri: metadata.setupRedirectUri,
    platformApplication: {
      available: Boolean(platformCredentials),
      clientId: platformCredentials?.clientId,
    },
    automatedCreationAvailable: Boolean(bootstrapCredentials && signingSecret),
  };
});

export const getMicrosoftEmailAdminConsentUrl = withAuth(async (
  user,
  { tenant },
  input: { tenantHint: string; profileId: string }
): Promise<{ success: boolean; error?: string; url?: string }> => {
  if (!(await canManageMicrosoftSettings(user))) return { success: false, error: 'Forbidden' };
  try {
    const [credentials, metadata, secret] = await Promise.all([
      resolvePlatformMicrosoftCredentials(),
      getMicrosoftEmailSetupMetadataInternal(),
      getMicrosoftEmailSetupSigningSecret(),
    ]);
    if (!credentials) return { success: false, error: 'The Alga platform Microsoft app is not configured.' };
    if (!secret) return { success: false, error: 'OAuth state signing is not configured on this server.' };
    const microsoftTenant = validateMicrosoftTenantIdentifier(input.tenantHint);
    const setupState = createAdminConsentState({
      algaTenant: tenant,
      userId: (user as any).user_id,
      returnTo: metadata.returnTo,
      clientId: credentials.clientId,
      profileId: input.profileId,
      secret,
    });
    return {
      success: true,
      url: buildMicrosoftEmailAdminConsentUrl({
        tenant: microsoftTenant,
        clientId: credentials.clientId,
        redirectUri: metadata.setupRedirectUri,
        state: setupState.token,
        loginBaseUrl: getMicrosoftLoginBaseUrl(),
      }),
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to build admin consent URL' };
  }
});

export const configureMicrosoftEmailPlatformApplication = withAuth(async (
  user,
  { tenant },
  input: { tenantId: string; displayName?: string }
): Promise<MicrosoftEmailSetupCompletionResult> => {
  if (!(await canManageMicrosoftSettings(user))) return { success: false, error: 'Forbidden' };
  try {
    const [credentials, metadata, secret] = await Promise.all([
      resolvePlatformMicrosoftCredentials(),
      getMicrosoftEmailSetupMetadataInternal(),
      getMicrosoftEmailSetupSigningSecret(),
    ]);
    if (!credentials) return { success: false, error: 'The Alga platform Microsoft app is not configured.' };
    if (!secret) return { success: false, error: 'OAuth state signing is not configured on this server.' };
    const microsoftTenant = validateMicrosoftTenantIdentifier(input.tenantId);
    const profile = await createMicrosoftEmailProfilePendingConsentInternal(user, tenant, {
      displayName: input.displayName?.trim() || 'Alga platform Microsoft Email',
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      tenantId: microsoftTenant,
    });
    if (!profile.success) return profile;

    const setupState = createAdminConsentState({
      algaTenant: tenant,
      userId: (user as any).user_id,
      returnTo: metadata.returnTo,
      clientId: credentials.clientId,
      profileId: profile.profileId!,
      secret,
    });
    return {
      success: true,
      profileId: profile.profileId,
      displayName: profile.displayName,
      tenantId: microsoftTenant,
      clientId: credentials.clientId,
      adminConsentUrl: buildMicrosoftEmailAdminConsentUrl({
        tenant: microsoftTenant,
        clientId: credentials.clientId,
        redirectUri: metadata.setupRedirectUri,
        state: setupState.token,
        loginBaseUrl: getMicrosoftLoginBaseUrl(),
      }),
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to configure the platform Microsoft app' };
  }
});

export const createMicrosoftEmailApplication = withAuth(async (
  user,
  { tenant },
  input: { displayName: string }
): Promise<{ success: boolean; error?: string; authUrl?: string }> => {
  if (!(await canManageMicrosoftSettings(user))) return { success: false, error: 'Forbidden' };
  try {
    const displayName = input.displayName.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!displayName) return { success: false, error: 'Microsoft application display name is required' };
    const [credentials, metadata, secret] = await Promise.all([
      resolveBootstrapMicrosoftCredentials(),
      getMicrosoftEmailSetupMetadataInternal(),
      getMicrosoftEmailSetupSigningSecret(),
    ]);
    if (!credentials) {
      return { success: false, error: 'Automated app creation is not configured on this server. Use the platform or manual option.' };
    }
    if (!secret) return { success: false, error: 'OAuth state signing is not configured on this server.' };

    const state = createMicrosoftEmailSetupState({
      purpose: 'create_application',
      algaTenant: tenant,
      userId: (user as any).user_id,
      returnTo: metadata.returnTo,
      displayName,
      includeOauthNonce: true,
      secret,
    });
    const oauthNonce = state.payload.oauthNonce;
    if (!oauthNonce) {
      return { success: false, error: 'Failed to generate Microsoft OAuth nonce.' };
    }
    const pkce = createPkcePair();
    await storeMicrosoftEmailSetupState(state.payload.nonce, {
      verifier: pkce.verifier,
      algaTenant: tenant,
      userId: (user as any).user_id,
      oauthNonce,
    });
    return {
      success: true,
      authUrl: buildBootstrapAuthorizationUrl({
        clientId: credentials.clientId,
        redirectUri: metadata.setupRedirectUri,
        state: state.token,
        nonce: oauthNonce,
        challenge: pkce.challenge,
      }),
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to start Microsoft app creation' };
  }
});

export async function completeMicrosoftEmailApplicationCreation(input: {
  user: any;
  state: MicrosoftEmailSetupStatePayload;
  code: string;
}): Promise<MicrosoftEmailSetupCompletionResult> {
  if (!(await canManageMicrosoftSettings(input.user))) return { success: false, error: 'Forbidden' };
  const stored = await consumeMicrosoftEmailSetupState(input.state.nonce);
  if (
    !stored ||
    stored.algaTenant !== input.state.algaTenant ||
    stored.userId !== input.state.userId ||
    stored.oauthNonce !== input.state.oauthNonce
  ) {
    return { success: false, error: 'This Microsoft setup request is invalid, expired, or has already been used.' };
  }

  const [credentials, metadata, secret] = await Promise.all([
    resolveBootstrapMicrosoftCredentials(),
    getMicrosoftEmailSetupMetadataInternal(),
    getMicrosoftEmailSetupSigningSecret(),
  ]);
  if (!credentials || !secret) {
    return { success: false, error: 'Microsoft automated setup configuration is no longer available.' };
  }

  let accessToken = '';
  let application: GraphApplicationResult | undefined;
  let servicePrincipal: GraphServicePrincipalResult | undefined;
  try {
    const tokenParams = new URLSearchParams({
      client_id: credentials.clientId,
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: metadata.setupRedirectUri,
      code_verifier: stored.verifier,
      scope: MICROSOFT_EMAIL_SETUP_BOOTSTRAP_SCOPES.join(' '),
      ...(credentials.clientSecret ? { client_secret: credentials.clientSecret } : {}),
    });
    const tokenResponse = await axios.post<{
      access_token?: string;
      id_token?: string;
    }>(getMicrosoftTokenUrl('common'), tokenParams.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 20_000,
    });
    accessToken = tokenResponse.data.access_token || '';
    const idToken = tokenResponse.data.id_token || '';
    if (!accessToken || !idToken) throw new Error('Microsoft did not return the required setup tokens');
    const { tenantId } = assertMicrosoftTokenClaims({
      accessToken,
      idToken,
      expectedNonce: stored.oauthNonce,
    });

    application = await graphRequest<GraphApplicationResult>({
      method: 'POST',
      path: '/applications',
      accessToken,
      body: buildMicrosoftEmailApplicationManifest({
        displayName: input.state.displayName || 'Alga PSA Microsoft Email',
        mailboxRedirectUri: metadata.mailboxRedirectUri,
        setupRedirectUri: metadata.setupRedirectUri,
      }),
    });
    servicePrincipal = await graphRequest<GraphServicePrincipalResult>({
      method: 'POST',
      path: '/servicePrincipals',
      accessToken,
      body: { appId: application.appId },
    });
    const password = await graphRequest<GraphPasswordResult>({
      method: 'POST',
      path: `/applications/${encodeURIComponent(application.id)}/addPassword`,
      accessToken,
      body: {
        passwordCredential: {
          displayName: 'Alga PSA email client secret',
          endDateTime: new Date(Date.now() + 730 * 24 * 60 * 60 * 1000).toISOString(),
        },
      },
    });
    if (!password.secretText) throw new Error('Microsoft did not return the generated client secret');

    const profile = await createMicrosoftEmailProfilePendingConsentInternal(
      input.user,
      input.state.algaTenant,
      {
        displayName: application.displayName,
        clientId: application.appId,
        clientSecret: password.secretText,
        tenantId,
      }
    );
    if (!profile.success) {
      throw new Error(profile.error || 'Failed to store the new Microsoft profile');
    }
    const consentState = createAdminConsentState({
      algaTenant: input.state.algaTenant,
      userId: input.state.userId,
      returnTo: input.state.returnTo,
      clientId: application.appId,
      profileId: profile.profileId!,
      secret,
    });
    const adminConsentUrl = buildMicrosoftEmailAdminConsentUrl({
      tenant: tenantId,
      clientId: application.appId,
      redirectUri: metadata.setupRedirectUri,
      state: consentState.token,
      loginBaseUrl: getMicrosoftLoginBaseUrl(),
    });
    return {
      success: true,
      profileId: profile.profileId,
      displayName: profile.displayName,
      tenantId,
      clientId: application.appId,
      adminConsentUrl,
    };
  } catch (error) {
    const remaining = accessToken
      ? await cleanupGraphObjects({
          accessToken,
          applicationObjectId: application?.id,
          servicePrincipalObjectId: servicePrincipal?.id,
        })
      : [];
    const baseMessage = axios.isAxiosError(error)
      ? getGraphErrorMessage(
          error,
          !application ? 'create the application' : !servicePrincipal ? 'create the service principal' : 'finish application setup'
        )
      : error instanceof Error
        ? error.message
        : 'Microsoft application setup failed';
    return {
      success: false,
      error: remaining.length
        ? `${baseMessage} Cleanup could not remove the ${remaining.join(' and ')}; review the tenant in Microsoft Entra.`
        : baseMessage,
    };
  } finally {
    accessToken = '';
  }
}
