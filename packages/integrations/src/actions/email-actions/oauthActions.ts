'use server'

import { withAuth } from '@alga-psa/auth';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { generateMicrosoftAuthUrl, generateGoogleAuthUrl, generateNonce, type OAuthState } from '../../utils/email/oauthHelpers';
import {
  resolveMicrosoftEmailIssuerChoice,
  type MicrosoftEmailIssuerChoice,
} from '../../lib/microsoftEmailIssuerSelection';
import {
  createMicrosoftEmailOAuthState,
  getMicrosoftEmailOAuthSigningSecret,
  type MicrosoftEmailOAuthPurpose,
} from '../../utils/email/microsoftEmailOAuthState';
import { storeMicrosoftEmailOAuthNonce } from '../../utils/email/microsoftEmailOAuthStateStore';
import { getMicrosoftEmailSetupMetadataInternal } from '../integrations/microsoftActions';

export const initiateEmailOAuth = withAuth(async (
  user,
  { tenant },
  params: {
    provider: 'microsoft' | 'google';
    providerId?: string;
    redirectUri?: string;
    /**
     * Explicit issuer choice for Microsoft mailbox authorization. Required for
     * Microsoft; the server resolves and validates it — it never infers the
     * app from the tenant Email binding.
     */
    issuer?: MicrosoftEmailIssuerChoice;
    /** create vs reconnect. Defaults to reconnect when a providerId is present. */
    purpose?: MicrosoftEmailOAuthPurpose;
  }
): Promise<{ success: true; authUrl: string; state: string } | { success: false; error: string; errorCode?: string }> => {

  try {
    // RBAC: validate permission based on intent (create vs update)
    const isUpdate = !!params.providerId;
    const resource = 'system_settings';
    const action = isUpdate ? 'update' : 'create';
    const permitted = await hasPermission(user as any, resource, action);
    if (!permitted) {
      return { success: false, error: 'Forbidden: insufficient permissions' };
    }

    // If providerId is specified, ensure it belongs to the caller's tenant
    if (params.providerId) {
      const { knex } = await createTenantKnex();
      const exists = await tenantDb(knex, tenant).table('email_providers')
        .where({ id: params.providerId })
        .first();
      if (!exists) {
        return { success: false, error: 'Invalid providerId for tenant' };
      }
    }

    const { provider, providerId, redirectUri } = params;
    const secretProvider = await getSecretProviderInstance();

    let clientId: string | null = null;
    let effectiveRedirectUri = redirectUri || '';
    let microsoftCredentialSource: 'tenant' | 'platform' | undefined;

    if (provider === 'google') {
      // Google is always tenant-owned (CE and EE): do not fall back to app-level secrets.
      clientId = (await secretProvider.getTenantSecret(tenant, 'google_client_id')) || null;
    } else {
      // Explicit issuer selection is mandatory for Microsoft. The server
      // resolves and validates ownership + Email capability + readiness and
      // returns the issuing app's credentials, never the tenant binding's.
      const resolution = await resolveMicrosoftEmailIssuerChoice(tenant, params.issuer);

      clientId = resolution.clientId;
      microsoftCredentialSource = resolution.issuerKind === 'managed' ? 'platform' : 'tenant';
      effectiveRedirectUri = (await getMicrosoftEmailSetupMetadataInternal()).mailboxRedirectUri;
    }

    if (!effectiveRedirectUri) {
      const base =
        process.env.NEXT_PUBLIC_BASE_URL ||
        (await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')) ||
        process.env.NEXTAUTH_URL ||
        (await secretProvider.getAppSecret('NEXTAUTH_URL')) ||
        'http://localhost:3000';
      effectiveRedirectUri = `${base}/api/auth/${provider}/callback`;
    }

    if (!clientId) {
      return { success: false, error: `${provider} OAuth client ID not configured` };
    }

    const state: OAuthState = {
      tenant,
      userId: user.user_id,
      providerId,
      redirectUri: effectiveRedirectUri,
      timestamp: Date.now(),
      nonce: generateNonce(),
      hosted: microsoftCredentialSource === 'platform',
      microsoftCredentialSource,
    };

    // For multi-tenant Azure AD apps, always use 'common' for the authorization URL
    // This allows users from any Azure AD tenant to authenticate
    const msTenantAuthority = 'common';

    let authUrl: string;
    let returnedState = Buffer.from(JSON.stringify(state)).toString('base64');

    if (provider === 'microsoft' && params.issuer) {
      // Signed state carries the complete non-secret selection context so the
      // callback can revalidate eligibility and detect tampering/replay.
      const signingSecret = await getMicrosoftEmailOAuthSigningSecret();
      if (!signingSecret) {
        return { success: false, error: 'OAuth state signing is not configured on this server.', errorCode: 'ms_email_invalid_state' };
      }
      const purpose: MicrosoftEmailOAuthPurpose =
        params.purpose ?? (providerId ? 'reconnect' : 'create');
      const signed = createMicrosoftEmailOAuthState({
        purpose,
        tenant,
        userId: user.user_id,
        providerId,
        issuer: params.issuer,
        clientId,
        redirectUri: effectiveRedirectUri,
        secret: signingSecret,
      });
      await storeMicrosoftEmailOAuthNonce(signed.payload.nonce);

      authUrl = generateMicrosoftAuthUrl(clientId, effectiveRedirectUri, state, undefined as any, msTenantAuthority, signed.token);
      returnedState = signed.token;
    } else {
      authUrl = provider === 'microsoft'
        ? generateMicrosoftAuthUrl(clientId, state.redirectUri, state, undefined as any, msTenantAuthority)
        : generateGoogleAuthUrl(clientId, state.redirectUri, state);
    }

    return { success: true, authUrl, state: returnedState };
  } catch (err: any) {
    const errorCode =
      typeof err?.code === 'string' ? err.code : undefined;
    console.error('[EmailOAuthActions] Failed to initiate OAuth', {
      provider: params.provider,
      providerId: params.providerId,
      error: err,
    });
    return { success: false, error: err?.message || 'Failed to initiate OAuth', errorCode };
  }
});
