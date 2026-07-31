import { NextRequest, NextResponse } from 'next/server';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
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
    let body: { providerId?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }

    const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : '';
    
    if (!providerId) {
      return NextResponse.json({ error: 'Provider ID is required' }, { status: 400 });
    }
    
    console.log(`🔍 Refreshing Gmail watch for provider: ${providerId}`);
    
    // Get database connection
    const knex = await getAdminConnection();
    const db = tenantDb(knex, user.tenant);
    
    // Get the email provider and its Google config
    const provider = await db.table('email_providers')
      .where('id', providerId)
      .where('provider_type', 'google')
      .where('is_active', true)
      .first();
    
    if (!provider) {
      return NextResponse.json({ error: 'Gmail provider not found' }, { status: 404 });
    }
    
    const googleConfig = await db.table('google_email_provider_config')
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
    const result = await configureGmailProvider({
      tenant: provider.tenant,
      providerId: providerId,
      projectId: googleConfig.project_id,
      force: true // Force refresh even if recently initialized
    });

    if (!result.success) {
      return NextResponse.json({
        success: false,
        error: 'Gmail provider refresh failed. Check Pub/Sub and Gmail watch configuration, then try again.',
        warnings: result.warnings
      }, { status: 409 });
    }
    
    console.log('✅ Gmail provider refresh completed successfully');
    
    return NextResponse.json({
      success: true,
      message: 'Gmail provider refreshed successfully (Pub/Sub + Watch)',
      providerId: providerId,
      mailbox: provider.mailbox,
      warnings: result.warnings
    });
    
  } catch (error: any) {
    console.error('❌ Failed to refresh Gmail provider:', {
      error: error.message,
      stack: error.stack
    });
    
    return NextResponse.json({
      success: false,
      error: 'Failed to refresh Gmail provider. Please try again.'
    }, { status: 500 });
  }
}
