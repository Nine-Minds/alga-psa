import { NextRequest, NextResponse } from 'next/server';
import { getAdminConnection } from '@shared/db/admin';
import { OAuth2Client } from 'google-auth-library';

export async function POST(request: NextRequest) {
  try {
    const { providerId } = await request.json();
    
    if (!providerId) {
      return NextResponse.json({ error: 'Provider ID is required' }, { status: 400 });
    }

    console.log(`🔄 Force refreshing token for provider: ${providerId}`);

    // Get provider from database
    const knex = await getAdminConnection();
    const googleConfig = await knex('google_email_provider_config')
      .where('email_provider_id', providerId)
      .first();

    if (!googleConfig) {
      return NextResponse.json({ error: 'Google config not found' }, { status: 404 });
    }

    console.log('📊 Current token expires at:', googleConfig.token_expires_at);
    console.log('🕐 Current time:', new Date().toISOString());
    console.log('⏰ Token expired:', new Date(googleConfig.token_expires_at) < new Date());

    // Create OAuth2 client with credentials from database
    const oauth2Client = new OAuth2Client(
      googleConfig.client_id,
      googleConfig.client_secret
    );

    // Set the refresh token
    oauth2Client.setCredentials({
      refresh_token: googleConfig.refresh_token
    });

    console.log('🔄 Attempting to refresh access token...');
    
    // Get new access token
    const { credentials } = await oauth2Client.refreshAccessToken();
    
    if (!credentials.access_token) {
      throw new Error('Failed to obtain new access token');
    }

    console.log('✅ Token refreshed successfully');

    // Calculate expiry with 5-minute buffer
    const expiryTime = credentials.expiry_date 
      ? new Date(credentials.expiry_date - 300000) 
      : new Date(Date.now() + 3300000); // Default to 55 minutes

    // Update database with new tokens
    await knex('google_email_provider_config')
      .where('email_provider_id', providerId)
      .update({
        access_token: credentials.access_token,
        refresh_token: credentials.refresh_token || googleConfig.refresh_token,
        token_expires_at: expiryTime.toISOString(),
        updated_at: new Date().toISOString()
      });

    console.log('💾 Database updated with new token');

    return NextResponse.json({
      success: true,
      message: 'Token refreshed successfully',
      oldExpiry: googleConfig.token_expires_at,
      newExpiry: expiryTime.toISOString(),
      tokenChanged: true
    });

  } catch (error: any) {
    console.error('❌ Token refresh failed:', error);
    return NextResponse.json({ 
      error: 'Token refresh failed', 
      details: error.message 
    }, { status: 500 });
  }
}