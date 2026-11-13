import { NextRequest, NextResponse } from 'next/server';
import { tenantDb } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { encodeImapOAuthState, type ImapOAuthState } from '@/utils/email/oauthHelpers';
import { createTenantKnex } from '@/lib/db';
import { assertTenantProductAccess, isProductAccessError, toProductAccessDeniedResponse } from '@/lib/productAccess';
import { assertProviderMutationAuthority, ProviderMutationForbiddenError } from '@/lib/email/providerMutationAuthority';
import { randomUUID } from 'crypto';

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

    const { knex, tenant } = await createTenantKnex(user.tenant);
    if (!tenant || tenant !== user.tenant) return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
    await assertProviderMutationAuthority(user, knex);

    const body = await request.json();
    const { providerId, redirectUri } = body;
    if (!providerId) {
      return NextResponse.json({ error: 'providerId is required' }, { status: 400 });
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
    const effectiveRedirectUri = redirectUri || `${baseUrl}/api/email/oauth/imap/callback`;

    const signingKey = await secretProvider.getAppSecret('OAUTH_STATE_SIGNING_KEY');
    if (!signingKey) throw new Error('OAUTH_STATE_SIGNING_KEY is not configured');
    const nonce = randomUUID();
    const state: ImapOAuthState = {
      tenant: user.tenant,
      userId: user.user_id,
      providerId,
      redirectUri: effectiveRedirectUri,
      timestamp: Date.now(),
      nonce,
      purpose: 'reconnect',
    };

    const expiresAt = new Date(state.timestamp + 10 * 60 * 1000);
    await db.table('email_oauth_grants').insert({
      id: nonce,
      tenant,
      provider_id: providerId,
      initiated_by_user_id: user.user_id,
      redirect_uri: effectiveRedirectUri,
      purpose: state.purpose,
      created_at: knex.fn.now(),
      expires_at: expiresAt,
      consumed_at: null,
    });
    const signedState = encodeImapOAuthState(state, signingKey);

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
      state: signedState,
    });
  } catch (error: any) {
    if (error instanceof ProviderMutationForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (isProductAccessError(error)) {
      return toProductAccessDeniedResponse(error);
    }
    console.error('IMAP OAuth initiate error:', error);
    return NextResponse.json({ error: 'Failed to initiate IMAP OAuth. Please try again.' }, { status: 500 });
  }
}
