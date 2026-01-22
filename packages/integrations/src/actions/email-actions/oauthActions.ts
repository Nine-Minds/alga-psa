'use server'

import { getCurrentUser } from '@alga-psa/users/actions';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex } from '@alga-psa/db';
import { generateMicrosoftAuthUrl, generateGoogleAuthUrl, generateNonce, type OAuthState } from '../../utils/email/oauthHelpers';

export async function initiateEmailOAuth(params: {
  provider: 'microsoft' | 'google';
  providerId?: string;
  redirectUri?: string;
}): Promise<{ success: true; authUrl: string; state: string } | { success: false; error: string } > {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: 'Unauthorized' };

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
      const { knex } = await createTenantKnex(user.tenant);
      const exists = await knex('email_providers')
        .where({ id: params.providerId, tenant: user.tenant })
        .first();
      if (!exists) {
        return { success: false, error: 'Invalid providerId for tenant' };
      }
    }

    const { provider, providerId, redirectUri } = params;
    const secretProvider = await getSecretProviderInstance();

    let clientId: string | null = null;
    let effectiveRedirectUri = redirectUri || '';

    if (provider === 'google') {
      // Google is always tenant-owned (CE and EE): do not fall back to app-level secrets.
      clientId = (await secretProvider.getTenantSecret(user.tenant, 'google_client_id')) || null;
    } else {
      // Microsoft remains as-is (tenant secret with optional env fallback).
      clientId = process.env.MICROSOFT_CLIENT_ID || (await secretProvider.getTenantSecret(user.tenant, 'microsoft_client_id')) || null;
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
      tenant: user.tenant,
      userId: user.user_id,
      providerId,
      redirectUri: effectiveRedirectUri,
      timestamp: Date.now(),
      nonce: generateNonce(),
      hosted: false
    };

    // For multi-tenant Azure AD apps, always use 'common' for the authorization URL
    // This allows users from any Azure AD tenant to authenticate
    const msTenantAuthority = 'common';

    const authUrl = provider === 'microsoft'
      ? generateMicrosoftAuthUrl(clientId, state.redirectUri, state, undefined as any, msTenantAuthority)
      : generateGoogleAuthUrl(clientId, state.redirectUri, state);

    return { success: true, authUrl, state: Buffer.from(JSON.stringify(state)).toString('base64') };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to initiate OAuth' };
  }
}
