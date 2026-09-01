import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import {
  generateGoogleAuthUrl,
  generateNonce,
  OAuthState
} from '@/utils/email/oauthHelpers';
import { assertTenantProductAccess, isProductAccessError, toProductAccessDeniedResponse } from '@/lib/productAccess';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    await assertTenantProductAccess({
      tenantId: user.tenant,
      capability: 'email_to_ticket',
      allowedProducts: ['psa', 'algadesk'],
    });

    const body = await request.json();
    const { provider, redirectUri } = body;

    if (!provider || !['microsoft', 'google'].includes(provider)) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }

    // Microsoft mailbox OAuth must go through the signed explicit-selection
    // flow (initiateEmailOAuth server action), which issues a
    // base64url(JSON).HMAC state token that the callback verifies. This
    // unsigned HTTP initiate must never mint Microsoft state: the callback
    // rejects unsigned state, so a Microsoft flow started here could never
    // complete and would only teach callers the wrong path.
    if (provider === 'microsoft') {
      return NextResponse.json({
        error: 'Microsoft mailbox OAuth must be initiated from the mailbox form with an explicit application selection.',
      }, { status: 400 });
    }

    // Get OAuth credentials - use hosted credentials for EE or tenant-specific secrets for CE
    const secretProvider = await getSecretProviderInstance();
    let clientId: string | null = null;
    let effectiveRedirectUri = redirectUri;

    // Microsoft was rejected above: only Google flows through this unsigned
    // HTTP initiate, and Google is always tenant-owned (CE and EE) — no
    // fallback to app-level secrets.
    clientId = await secretProvider.getTenantSecret(user.tenant, 'google_client_id') || null;

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
      }, { status: 409 });
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
    const authUrl = generateGoogleAuthUrl(
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
    if (isProductAccessError(error)) {
      return toProductAccessDeniedResponse(error);
    }
    console.error('Error initiating OAuth:', error);
    return NextResponse.json(
      { error: 'Failed to initiate OAuth. Please try again.' },
      { status: 500 }
    );
  }
}
