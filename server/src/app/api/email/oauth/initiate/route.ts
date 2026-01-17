import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { getSecretProviderInstance } from '@alga-psa/core';
import { 
  generateMicrosoftAuthUrl, 
  generateGoogleAuthUrl, 
  generateNonce,
  OAuthState 
} from '@/utils/email/oauthHelpers';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { provider, redirectUri } = body;

    if (!provider || !['microsoft', 'google'].includes(provider)) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }

    // Get OAuth credentials - use hosted credentials for EE or tenant-specific secrets for CE
    const secretProvider = await getSecretProviderInstance();
    let clientId: string | null = null;
    let effectiveRedirectUri = redirectUri;

    if (provider === 'google') {
      // Google is always tenant-owned (CE and EE): do not fall back to app-level secrets.
      clientId = await secretProvider.getTenantSecret(user.tenant, 'google_client_id') || null;
    } else {
      // Microsoft remains as-is.
      clientId = await secretProvider.getAppSecret('MICROSOFT_CLIENT_ID') || await secretProvider.getTenantSecret(user.tenant, 'microsoft_client_id') || null;
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
      return NextResponse.json({ 
        error: `${provider} OAuth client ID not configured` 
      }, { status: 500 });
    }

    // Generate OAuth state
    const state: OAuthState = {
      tenant: user.tenant,
      userId: user.user_id,
      providerId: body.providerId,
      redirectUri: effectiveRedirectUri || `${await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')}/api/auth/${provider}/callback`,
      timestamp: Date.now(),
      nonce: generateNonce(),
      hosted: false
    };

    // Generate authorization URL
    // For multi-tenant Azure AD apps, always use 'common' for the authorization URL
    // This allows users from any Azure AD tenant to authenticate
    const msTenantAuthority = 'common';

    const authUrl = provider === 'microsoft'
      ? generateMicrosoftAuthUrl(
          clientId,
          state.redirectUri,
          state,
          undefined as any,
          msTenantAuthority
        )
      : generateGoogleAuthUrl(
          clientId,
          state.redirectUri,
          state
        );

    return NextResponse.json({
      success: true,
      authUrl,
      provider,
      state: Buffer.from(JSON.stringify(state)).toString('base64')
    });

  } catch (error: any) {
    console.error('Error initiating OAuth:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to initiate OAuth' },
      { status: 500 }
    );
  }
}
