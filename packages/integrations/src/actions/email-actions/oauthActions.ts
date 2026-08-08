'use server'

import { withAuth } from '@alga-psa/auth';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { generateMicrosoftAuthUrl, generateGoogleAuthUrl, generateNonce, type OAuthState } from '../../utils/email/oauthHelpers';
import {
  resolveMicrosoftConsumerProfileConfig,
} from '../../lib/microsoftConsumerProfileResolution';
import { getMicrosoftEmailSetupMetadataInternal } from '../integrations/microsoftActions';
import { resolveMicrosoftEmailOAuthAuthority } from '@alga-psa/shared/services/email/microsoftGraphEndpoints';

export const initiateEmailOAuth = withAuth(async (
  user,
  { tenant },
  params: {
    provider: 'microsoft' | 'google';
    providerId?: string;
    redirectUri?: string;
  }
): Promise<{ success: true; authUrl: string; state: string } | { success: false; error: string }> => {

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
    let microsoftTenantId: string | undefined;

    if (provider === 'google') {
      // Google is always tenant-owned (CE and EE): do not fall back to app-level secrets.
      clientId = (await secretProvider.getTenantSecret(tenant, 'google_client_id')) || null;
    } else {
      // A bound tenant profile wins; when none exists the resolver may return
      // the Alga-managed platform application.
      const microsoftProfile = await resolveMicrosoftConsumerProfileConfig(tenant, 'email');
      if (microsoftProfile.status !== 'ready') {
        return {
          success: false,
          error: microsoftProfile.message || 'Microsoft Email binding is not configured',
        };
      }

      clientId = microsoftProfile.clientId || null;
      microsoftCredentialSource = microsoftProfile.credentialSource === 'app' ? 'platform' : 'tenant';
      microsoftTenantId = microsoftProfile.microsoftTenantId;
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

    const msTenantAuthority = provider === 'microsoft'
      ? resolveMicrosoftEmailOAuthAuthority({
          clientId,
          tenantId: microsoftTenantId,
          credentialSource: microsoftCredentialSource,
        })
      : undefined;

    const authUrl = provider === 'microsoft'
      ? generateMicrosoftAuthUrl(clientId, state.redirectUri, state, undefined as any, msTenantAuthority)
      : generateGoogleAuthUrl(clientId, state.redirectUri, state);

    return { success: true, authUrl, state: Buffer.from(JSON.stringify(state)).toString('base64') };
  } catch (err: any) {
    console.error('[EmailOAuthActions] Failed to initiate OAuth', {
      provider: params.provider,
      providerId: params.providerId,
      error: err,
    });
    return { success: false, error: 'Failed to initiate OAuth' };
  }
});
