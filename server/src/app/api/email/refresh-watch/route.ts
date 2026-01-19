import { NextRequest, NextResponse } from 'next/server';
import { getAdminConnection } from '@alga-psa/db/admin';
import { getCurrentUser } from '@alga-psa/users/actions';
import { configureGmailProvider } from '@alga-psa/integrations/actions/email-actions/configureGmailProvider';

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
    
    if (!googleConfig.project_id) {
      return NextResponse.json({ error: 'Gmail provider missing project_id configuration' }, { status: 400 });
    }
    
    // Use the new configureGmailProvider orchestrator with force=true
    // This will refresh both Pub/Sub setup and Gmail watch subscription
    console.log('🔄 Starting complete Gmail provider refresh (Pub/Sub + Watch)...');
    await configureGmailProvider({
      tenant: provider.tenant,
      providerId: providerId,
      projectId: googleConfig.project_id,
      force: true // Force refresh even if recently initialized
    });
    
    console.log('✅ Gmail provider refresh completed successfully');
    
    return NextResponse.json({
      success: true,
      message: 'Gmail provider refreshed successfully (Pub/Sub + Watch)',
      providerId: providerId,
      mailbox: provider.mailbox
    });
    
  } catch (error: any) {
    console.error('❌ Failed to refresh Gmail provider:', {
      error: error.message,
      stack: error.stack
    });
    
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
