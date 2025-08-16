'use server'

import { getCurrentUser } from '../user-actions/userActions';
import { getSecretProviderInstance } from '@alga-psa/shared/core';
import { generateMicrosoftAuthUrl, generateGoogleAuthUrl, generateNonce, type OAuthState } from '@/utils/email/oauthHelpers';

export async function initiateEmailOAuth(params: {
  provider: 'microsoft' | 'google';
  providerId?: string;
  redirectUri?: string;
}): Promise<{ success: true; authUrl: string; state: string } | { success: false; error: string } > {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: 'Unauthorized' };

  try {
    const { provider, providerId, redirectUri } = params;
    const secretProvider = await getSecretProviderInstance();

    // Hosted detection via NEXTAUTH_URL
    const nextauthUrl = process.env.NEXTAUTH_URL || (await secretProvider.getAppSecret('NEXTAUTH_URL')) || '';
    const isHosted = nextauthUrl.startsWith('https://algapsa.com');

    let clientId: string | null = null;
    let effectiveRedirectUri = redirectUri || '';

    if (isHosted) {
      if (provider === 'google') {
        clientId = await secretProvider.getAppSecret('GOOGLE_CLIENT_ID');
        effectiveRedirectUri = effectiveRedirectUri || (await secretProvider.getAppSecret('GOOGLE_REDIRECT_URI')) || 'https://api.algapsa.com/api/auth/google/callback';
      } else {
        clientId = await secretProvider.getAppSecret('MICROSOFT_CLIENT_ID');
        effectiveRedirectUri = effectiveRedirectUri || (await secretProvider.getAppSecret('MICROSOFT_REDIRECT_URI')) || 'https://api.algapsa.com/api/auth/microsoft/callback';
      }
    } else {
      if (provider === 'google') {
        clientId = process.env.GOOGLE_CLIENT_ID || (await secretProvider.getTenantSecret(user.tenant, 'google_client_id')) || null;
      } else {
        clientId = process.env.MICROSOFT_CLIENT_ID || (await secretProvider.getTenantSecret(user.tenant, 'microsoft_client_id')) || null;
      }
      if (!effectiveRedirectUri) {
        const base = process.env.NEXT_PUBLIC_BASE_URL || (await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')) || 'http://localhost:3000';
        effectiveRedirectUri = `${base}/api/auth/${provider}/callback`;
      }
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
      hosted: isHosted
    };

    const authUrl = provider === 'microsoft'
      ? generateMicrosoftAuthUrl(clientId, state.redirectUri, state)
      : generateGoogleAuthUrl(clientId, state.redirectUri, state);

    return { success: true, authUrl, state: Buffer.from(JSON.stringify(state)).toString('base64') };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to initiate OAuth' };
  }
}

