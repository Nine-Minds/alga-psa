import { NextRequest, NextResponse } from 'next/server';
import { getAdminConnection } from '@shared/db/admin';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { GmailAdapter } from '@/services/email/providers/GmailAdapter';

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 Gmail watch refresh request received');
    
    // Check user authentication
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    console.log(`👤 User requesting refresh: ${user.email || 'unknown'}`);
    
    // Get the email provider ID from request body
    const { providerId } = await request.json();
    
    if (!providerId) {
      return NextResponse.json({ error: 'Provider ID is required' }, { status: 400 });
    }
    
    console.log(`🔍 Refreshing Gmail watch for provider: ${providerId}`);
    
    // Get database connection
    const knex = await getAdminConnection();
    
    // Get the email provider and its Google config
    const provider = await knex('email_providers')
      .where('id', providerId)
      .where('provider_type', 'google')
      .where('is_active', true)
      .first();
    
    if (!provider) {
      return NextResponse.json({ error: 'Gmail provider not found' }, { status: 404 });
    }
    
    const googleConfig = await knex('google_email_provider_config')
      .where('email_provider_id', providerId)
      .first();
    
    if (!googleConfig) {
      return NextResponse.json({ error: 'Gmail configuration not found' }, { status: 404 });
    }
    
    console.log(`✅ Found Gmail provider: ${provider.mailbox}`);
    
    // Create properly formatted configuration for Gmail adapter
    const adapterConfig = {
      ...provider,
      name: provider.provider_name,
      provider_type: provider.provider_type,
      active: provider.is_active,
      connection_status: provider.status || 'disconnected',
      webhook_notification_url: googleConfig.redirect_uri,
      provider_config: {
        project_id: googleConfig.project_id,
        pubsub_topic_name: googleConfig.pubsub_topic_name,
        pubsub_subscription_name: googleConfig.pubsub_subscription_name,
        client_id: googleConfig.client_id,
        access_token: googleConfig.access_token,
        refresh_token: googleConfig.refresh_token,
        token_expires_at: googleConfig.token_expires_at,
        history_id: googleConfig.history_id,
        watch_expiration: googleConfig.watch_expiration
      }
    };
    
    // Create Gmail adapter instance
    const adapter = new GmailAdapter(adapterConfig);
    
    // Refresh the watch subscription
    console.log('🔄 Starting watch subscription renewal...');
    await adapter.renewWebhookSubscription();
    
    console.log('✅ Gmail watch subscription refreshed successfully');
    
    return NextResponse.json({
      success: true,
      message: 'Gmail watch subscription refreshed successfully',
      providerId: providerId,
      mailbox: provider.mailbox
    });
    
  } catch (error: any) {
    console.error('❌ Failed to refresh Gmail watch subscription:', {
      error: error.message,
      stack: error.stack
    });
    
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}