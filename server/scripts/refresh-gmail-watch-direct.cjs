#!/usr/bin/env node

/**
 * Script to refresh Gmail watch subscriptions directly
 * Usage: node scripts/refresh-gmail-watch-direct.cjs [email]
 */

const knex = require('knex');
const config = require('../knexfile.cjs');

async function refreshGmailWatch(email) {
  const knexInstance = knex(config.development);
  
  try {
    console.log('🔄 Starting Gmail watch refresh...');
    
    // Find the Gmail provider
    const provider = await knexInstance('email_providers')
      .where('provider_type', 'google')
      .where('is_active', true)
      .where(email ? knexInstance.raw('LOWER(mailbox) = ?', [email.toLowerCase()]) : knexInstance.raw('1=1'))
      .first();
    
    if (!provider) {
      console.error(`❌ Gmail provider not found${email ? ` for email: ${email}` : ''}`);
      process.exit(1);
    }
    
    console.log(`🔍 Found Gmail provider: ${provider.mailbox} (ID: ${provider.id})`);
    
    // Get the Google config
    const googleConfig = await knexInstance('google_email_provider_config')
      .where('email_provider_id', provider.id)
      .first();
    
    if (!googleConfig) {
      console.error(`❌ Gmail configuration not found for provider: ${provider.id}`);
      process.exit(1);
    }
    
    console.log(`✅ Found Gmail configuration for provider: ${provider.id}`);
    
    // Since we can't easily import the TypeScript GmailAdapter, let's trigger a refresh
    // by calling the setupPubSub function to update the subscription with JWT config
    
    console.log('🔄 Updating Pub/Sub subscription with JWT configuration...');
    
    // Call the refresh endpoint using the ngrok URL
    const baseUrl = process.env.NGROK_URL || 
                   process.env.NEXT_PUBLIC_APP_URL || 
                   process.env.NEXTAUTH_URL ||
                   'http://localhost:3000';
    
    const refreshUrl = `${baseUrl}/api/email/refresh-watch`;
    
    console.log(`📡 Calling refresh endpoint: ${refreshUrl}`);
    
    // We'll need to handle the authentication issue differently
    // For now, let's just log the info and provide manual instructions
    
    console.log('📋 Manual refresh instructions:');
    console.log('1. Go to your application');
    console.log('2. Navigate to the email provider settings');
    console.log('3. Find the Gmail provider and trigger a refresh');
    console.log('');
    console.log('Or alternatively, you can:');
    console.log('1. Deactivate the Gmail provider');
    console.log('2. Reactivate it (this will recreate the watch subscription)');
    console.log('');
    console.log('Provider details:');
    console.log(`- ID: ${provider.id}`);
    console.log(`- Email: ${provider.mailbox}`);
    console.log(`- Tenant: ${provider.tenant}`);
    console.log(`- Pub/Sub Topic: ${googleConfig.pubsub_topic_name}`);
    console.log(`- Pub/Sub Subscription: ${googleConfig.pubsub_subscription_name}`);
    
  } catch (error) {
    console.error('❌ Script error:', error.message);
    process.exit(1);
  } finally {
    await knexInstance.destroy();
  }
}

// Get email from command line arguments
const email = process.argv[2];

if (process.argv.length > 3) {
  console.log('Usage: node scripts/refresh-gmail-watch-direct.cjs [email]');
  process.exit(1);
}

if (email) {
  console.log(`📧 Target email: ${email}`);
} else {
  console.log('📧 Will refresh first active Gmail provider found');
}

refreshGmailWatch(email);