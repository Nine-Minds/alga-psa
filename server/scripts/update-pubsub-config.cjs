#!/usr/bin/env node

/**
 * Script to update Pub/Sub subscription with JWT configuration
 * Usage: node scripts/update-pubsub-config.cjs
 */

const { google } = require('googleapis');

async function updatePubSubConfig() {
  try {
    console.log('🔄 Starting Pub/Sub configuration update...');
    
    // Get Google service account credentials from environment
    const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    
    if (!serviceAccountKey) {
      console.error('❌ GOOGLE_SERVICE_ACCOUNT_KEY environment variable not set');
      console.log('Please set the environment variable with your Google service account JSON key');
      process.exit(1);
    }
    
    const credentials = JSON.parse(serviceAccountKey);
    console.log('🔑 Google service account credentials loaded successfully');
    
    // Initialize Google Auth
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/pubsub',
        'https://www.googleapis.com/auth/cloud-platform'
      ]
    });
    
    const authClient = await auth.getClient();
    console.log('✅ Google Auth client initialized successfully');
    
    // Initialize Pub/Sub client
    const pubsub = google.pubsub({
      version: 'v1',
      auth: authClient
    });
    
    // Configuration from the script output
    const projectId = credentials.project_id;
    const subscriptionName = 'gmail-webhook-35bfe7a4-9ca4-4dc7-b174-6e324500b9b3';
    const subscriptionPath = `projects/${projectId}/subscriptions/${subscriptionName}`;
    
    // Get the webhook URL
    const webhookUrl = process.env.NGROK_URL 
      ? `${process.env.NGROK_URL}/api/email/webhooks/google`
      : 'http://localhost:3000/api/email/webhooks/google';
    
    console.log(`📡 Updating subscription: ${subscriptionPath}`);
    console.log(`🌐 Webhook URL: ${webhookUrl}`);
    console.log(`📧 Service Account Email: ${credentials.client_email}`);
    
    // Update the push configuration with JWT token
    const updateResult = await pubsub.projects.subscriptions.modifyPushConfig({
      subscription: subscriptionPath,
      requestBody: {
        pushConfig: {
          pushEndpoint: webhookUrl,
          oidcToken: {
            serviceAccountEmail: credentials.client_email,
            audience: webhookUrl
          },
          attributes: {
            'x-goog-version': 'v1'
          }
        }
      }
    });
    
    console.log('✅ Pub/Sub subscription updated successfully with JWT configuration');
    
    // Verify the update by getting the subscription
    const subscription = await pubsub.projects.subscriptions.get({
      subscription: subscriptionPath
    });
    
    const pushConfig = subscription.data.pushConfig;
    console.log('📋 Updated configuration:');
    console.log(`  Push Endpoint: ${pushConfig.pushEndpoint}`);
    console.log(`  OIDC Token Service Account: ${pushConfig.oidcToken?.serviceAccountEmail}`);
    console.log(`  OIDC Token Audience: ${pushConfig.oidcToken?.audience}`);
    console.log(`  Attributes: ${JSON.stringify(pushConfig.attributes)}`);
    
  } catch (error) {
    console.error('❌ Failed to update Pub/Sub configuration:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  }
}

updatePubSubConfig();