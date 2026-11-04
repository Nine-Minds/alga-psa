import { NextRequest, NextResponse } from 'next/server';
import { tenantDb } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createImapOAuthState } from '@/utils/email/imapOAuthState';
import { createTenantKnex } from '@/lib/db';
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
    const { providerId } = body;
    if (!providerId) {
      return NextResponse.json({ error: 'providerId is required' }, { status: 400 });
    }

    const { knex, tenant } = await createTenantKnex(user.tenant);
    if (!tenant || tenant !== user.tenant) {
      return NextResponse.json({ error: 'Authenticated tenant is unavailable' }, { status: 403 });
    }
    const db = tenantDb(knex, tenant);
    const provider = await db.table('email_providers')
      .where({ id: providerId, provider_type: 'imap' })
      .first();

    if (!provider) {
      return NextResponse.json({ error: 'IMAP provider not found' }, { status: 404 });
    }

    const imapConfig = await db.table('imap_email_provider_config')
      .where({ email_provider_id: providerId })
      .first();

    if (!imapConfig) {
      return NextResponse.json({ error: 'IMAP provider config not found' }, { status: 404 });
    }

    if (!imapConfig.oauth_authorize_url || !imapConfig.oauth_client_id) {
      return NextResponse.json({ error: 'IMAP OAuth configuration missing' }, { status: 400 });
    }

    const secretProvider = await getSecretProviderInstance();
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')) || 'http://localhost:3000';
    const effectiveRedirectUri = new URL('/api/email/oauth/imap/callback', baseUrl).toString();

    const { state, token: signedState } = await createImapOAuthState({
      tenant,
      userId: user.user_id,
      providerId,
      redirectUri: effectiveRedirectUri,
    });
    await db.table('imap_oauth_states')
      .where('expires_at', '<=', new Date().toISOString())
      .delete();
    await db.table('imap_oauth_states').insert({
      tenant,
      nonce: state.nonce,
      state,
      expires_at: new Date(state.expiresAt).toISOString(),
    });

    const scopes = imapConfig.oauth_scopes ? imapConfig.oauth_scopes : '';

    const params = new URLSearchParams({
      client_id: imapConfig.oauth_client_id,
      response_type: 'code',
      redirect_uri: effectiveRedirectUri,
      scope: scopes,
      state: signedState,
      access_type: 'offline',
      prompt: 'consent',
    });

    const authUrl = `${imapConfig.oauth_authorize_url}?${params.toString()}`;

    return NextResponse.json({
      success: true,
      authUrl,
      provider: 'imap',
      state: signedState
    });
  } catch (error: any) {
    if (isProductAccessError(error)) {
      return toProductAccessDeniedResponse(error);
    }
    console.error('IMAP OAuth initiate failed');
    return NextResponse.json({ error: 'Failed to initiate IMAP OAuth. Please try again.' }, { status: 500 });
  }
}
