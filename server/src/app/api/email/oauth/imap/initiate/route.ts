import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { getSecretProviderInstance } from '@alga-psa/shared/core';
import { encodeState, generateNonce, type OAuthState } from '@/utils/email/oauthHelpers';
import { createTenantKnex } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { providerId, redirectUri } = body;
    if (!providerId) {
      return NextResponse.json({ error: 'providerId is required' }, { status: 400 });
    }

    const { knex, tenant } = await createTenantKnex();
    const provider = await knex('email_providers')
      .where({ id: providerId, tenant, provider_type: 'imap' })
      .first();

    if (!provider) {
      return NextResponse.json({ error: 'IMAP provider not found' }, { status: 404 });
    }

    const imapConfig = await knex('imap_email_provider_config')
      .where({ email_provider_id: providerId, tenant })
      .first();

    if (!imapConfig) {
      return NextResponse.json({ error: 'IMAP provider config not found' }, { status: 404 });
    }

    if (!imapConfig.oauth_authorize_url || !imapConfig.oauth_client_id) {
      return NextResponse.json({ error: 'IMAP OAuth configuration missing' }, { status: 400 });
    }

    const secretProvider = await getSecretProviderInstance();
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')) || 'http://localhost:3000';
    const effectiveRedirectUri = redirectUri || `${baseUrl}/api/email/oauth/imap/callback`;

    const state: OAuthState = {
      tenant: user.tenant,
      userId: user.user_id,
      providerId,
      redirectUri: effectiveRedirectUri,
      timestamp: Date.now(),
      nonce: generateNonce(),
    };

    const scopes = imapConfig.oauth_scopes ? imapConfig.oauth_scopes : '';

    const params = new URLSearchParams({
      client_id: imapConfig.oauth_client_id,
      response_type: 'code',
      redirect_uri: effectiveRedirectUri,
      scope: scopes,
      state: encodeState(state),
      access_type: 'offline',
      prompt: 'consent',
    });

    const authUrl = `${imapConfig.oauth_authorize_url}?${params.toString()}`;

    return NextResponse.json({
      success: true,
      authUrl,
      provider: 'imap',
      state: Buffer.from(JSON.stringify(state)).toString('base64')
    });
  } catch (error: any) {
    console.error('IMAP OAuth initiate error:', error);
    return NextResponse.json({ error: error.message || 'Failed to initiate IMAP OAuth' }, { status: 500 });
  }
}
