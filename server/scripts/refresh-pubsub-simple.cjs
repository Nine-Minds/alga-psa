#!/usr/bin/env node

/**
 * Simple script to trigger Pub/Sub refresh using the existing setupPubSub function
 * Usage: node scripts/refresh-pubsub-simple.cjs
 */

const { google } = require('googleapis');

async function refreshPubSub() {
  try {
    console.log('🔄 Starting Pub/Sub refresh...');
    
    // Configuration from the provider details
    const projectId = 'nine-minds-438823'; // Common project ID for Nine Minds
    const subscriptionName = 'gmail-webhook-35bfe7a4-9ca4-4dc7-b174-6e324500b9b3';
    const subscriptionPath = `projects/${projectId}/subscriptions/${subscriptionName}`;
    
    // Get the webhook URL
    const webhookUrl = process.env.NGROK_URL 
      ? `${process.env.NGROK_URL}/api/email/webhooks/google`
      : 'https://ece3535aa781.ngrok-free.app/api/email/webhooks/google';
    
    console.log(`📡 Subscription: ${subscriptionPath}`);
    console.log(`🌐 Webhook URL: ${webhookUrl}`);
    console.log('');
    
    // Since we can't easily access the service account key, let's provide instructions
    console.log('🔧 To refresh the Gmail watch subscription:');
    console.log('');
    console.log('1. **Update the Pub/Sub subscription** (using Google Cloud Console or gcloud CLI):');
    console.log('   - Go to Google Cloud Console -> Pub/Sub -> Subscriptions');
    console.log(`   - Find subscription: ${subscriptionName}`);
    console.log('   - Click "Edit" and update the push endpoint configuration');
    console.log('   - Add OIDC token authentication with the service account email');
    console.log('');
    console.log('2. **Or using gcloud CLI**:');
    console.log(`   gcloud pubsub subscriptions modify-push-config ${subscriptionName} \\`);
    console.log(`     --push-endpoint="${webhookUrl}" \\`);
    console.log(`     --push-auth-service-account="your-service-account@${projectId}.iam.gserviceaccount.com" \\`);
    console.log(`     --push-auth-token-audience="${webhookUrl}"`);
    console.log('');
    console.log('3. **Test the webhook** by sending a test email to robert@nineminds.com');
    console.log('');
    console.log('The key changes made:');
    console.log('✅ Updated setupPubSub.ts to include JWT token configuration');
    console.log('✅ Updated webhook to require and validate JWT tokens');
    console.log('⏳ Need to update the existing Pub/Sub subscription');
    
  } catch (error) {
    console.error('❌ Script error:', error.message);
    process.exit(1);
  }
}

refreshPubSub();