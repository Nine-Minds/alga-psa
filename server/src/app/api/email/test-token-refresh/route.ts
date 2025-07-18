import { NextRequest, NextResponse } from 'next/server';
import { getAdminConnection } from '@shared/db/admin';
import { GmailAdapter } from '../../../../services/email/providers/GmailAdapter';

export async function POST(request: NextRequest) {
  try {
    const { providerId } = await request.json();
    
    if (!providerId) {
      return NextResponse.json({ error: 'Provider ID is required' }, { status: 400 });
    }

    console.log(`🔄 Testing token refresh for provider: ${providerId}`);

    // Get provider from database
    const knex = await getAdminConnection();
    const provider = await knex('email_providers')
      .where('id', providerId)
      .where('provider_type', 'google')
      .first();

    if (!provider) {
      return NextResponse.json({ error: 'Gmail provider not found' }, { status: 404 });
    }

    // Get Google config
    const googleConfig = await knex('google_email_provider_config')
      .where('email_provider_id', providerId)
      .first();

    if (!googleConfig) {
      return NextResponse.json({ error: 'Google config not found' }, { status: 404 });
    }

    // Create provider config object
    const providerConfig = {
      ...provider,
      provider_config: {
        access_token: googleConfig.access_token,
        refresh_token: googleConfig.refresh_token,
        token_expires_at: googleConfig.token_expires_at,
        client_id: googleConfig.client_id,
        client_secret: googleConfig.client_secret,
        project_id: googleConfig.project_id,
        pubsub_topic_name: googleConfig.pubsub_topic_name,
        pubsub_subscription_name: googleConfig.pubsub_subscription_name,
        history_id: googleConfig.history_id,
        watch_expiration: googleConfig.watch_expiration
      }
    };

    console.log('🔧 Provider config includes:', {
      hasAccessToken: !!providerConfig.provider_config.access_token,
      hasRefreshToken: !!providerConfig.provider_config.refresh_token,
      hasClientId: !!providerConfig.provider_config.client_id,
      hasClientSecret: !!providerConfig.provider_config.client_secret,
      tokenExpiry: providerConfig.provider_config.token_expires_at
    });

    console.log('📊 Current token expires at:', googleConfig.token_expires_at);
    console.log('🕐 Current time:', new Date().toISOString());

    // Create Gmail adapter and force a connection test (which will trigger token refresh if needed)
    const gmailAdapter = new GmailAdapter(providerConfig);
    
    console.log('🔗 Connecting to Gmail (this will load credentials and trigger token refresh if needed)...');
    await gmailAdapter.connect();
    
    console.log('🔗 Testing Gmail connection...');
    const connectionResult = await gmailAdapter.testConnection();
    
    if (!connectionResult.success) {
      return NextResponse.json({ 
        error: 'Connection test failed', 
        details: connectionResult.error 
      }, { status: 500 });
    }

    // Check if token was refreshed by comparing with database
    const updatedConfig = await knex('google_email_provider_config')
      .where('email_provider_id', providerId)
      .first();

    const tokenWasRefreshed = updatedConfig.token_expires_at !== googleConfig.token_expires_at;

    return NextResponse.json({
      success: true,
      message: 'Token refresh test completed',
      tokenWasRefreshed,
      oldExpiry: googleConfig.token_expires_at,
      newExpiry: updatedConfig.token_expires_at,
      connectionTest: connectionResult
    });

  } catch (error: any) {
    console.error('❌ Token refresh test failed:', error);
    return NextResponse.json({ 
      error: 'Token refresh test failed', 
      details: error.message 
    }, { status: 500 });
  }
}