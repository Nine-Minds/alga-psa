import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { getSecretProviderInstance } from '@shared/core';
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
    const { provider, redirectUri, hosted } = body;

    if (!provider || !['microsoft', 'google'].includes(provider)) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }

    // Get OAuth credentials - use hosted credentials for EE or tenant-specific secrets for CE
    const secretProvider = await getSecretProviderInstance();
    let clientId: string | null = null;
    let effectiveRedirectUri = redirectUri;

    if (provider === 'google' && hosted && process.env.NEXT_PUBLIC_EDITION === 'enterprise') {
      // Use hosted Gmail configuration for Enterprise Edition
      clientId = await secretProvider.getAppSecret('EE_GMAIL_CLIENT_ID') || null;
      effectiveRedirectUri = await secretProvider.getAppSecret('EE_GMAIL_REDIRECT_URI') || 'https://api.algapsa.com/api/auth/google/callback';
    } else {
      // Use tenant-specific or fallback credentials
      clientId = provider === 'microsoft'
        ? await secretProvider.getAppSecret('MICROSOFT_CLIENT_ID') || await secretProvider.getTenantSecret(user.tenant, 'microsoft_client_id') || null
        : await secretProvider.getAppSecret('GOOGLE_CLIENT_ID') || await secretProvider.getTenantSecret(user.tenant, 'google_client_id') || null;
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
      redirectUri: effectiveRedirectUri || `${await secretProvider.getAppSecret('NEXT_PUBLIC_APP_URL')}/api/auth/${provider}/callback`,
      timestamp: Date.now(),
      nonce: generateNonce()
    };

    // Generate authorization URL
    const authUrl = provider === 'microsoft'
      ? generateMicrosoftAuthUrl(
          clientId,
          state.redirectUri,
          state
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