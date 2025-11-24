import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { getSecretProviderInstance } from '@alga-psa/shared/core';
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

    // Prefer server-side NEXTAUTH_URL for hosted detection
    const nextauthUrl = process.env.NEXTAUTH_URL || (await secretProvider.getAppSecret('NEXTAUTH_URL')) || '';
    const isHosted = nextauthUrl.startsWith('https://algapsa.com');

    if (isHosted) {
      // Use app-level configuration
      if (provider === 'google') {
        clientId = await secretProvider.getAppSecret('GOOGLE_CLIENT_ID') || null;
        effectiveRedirectUri = await secretProvider.getAppSecret('GOOGLE_REDIRECT_URI') || 'https://api.algapsa.com/api/auth/google/callback';
      } else if (provider === 'microsoft') {
        clientId = await secretProvider.getAppSecret('MICROSOFT_CLIENT_ID') || null;
        effectiveRedirectUri = await secretProvider.getAppSecret('MICROSOFT_REDIRECT_URI') || 'https://api.algapsa.com/api/auth/microsoft/callback';
      }
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
      redirectUri: effectiveRedirectUri || `${await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')}/api/auth/${provider}/callback`,
      timestamp: Date.now(),
      nonce: generateNonce(),
      hosted: true
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
