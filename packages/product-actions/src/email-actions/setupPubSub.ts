'use server';

import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { getSecretProviderInstance } from '@shared/core';
import { getCurrentUser } from '@product/actions/user-actions/userActions';

export interface SetupPubSubRequest {
  projectId: string;
  topicName: string;
  subscriptionName: string;
  webhookUrl: string;
}

export async function setupPubSub(request: SetupPubSubRequest) {
  console.log(`🔧 Starting Pub/Sub setup for project ${request.projectId}:`, {
    topicName: request.topicName,
    subscriptionName: request.subscriptionName,
    webhookUrl: request.webhookUrl
  });

  try {
    const user = await getCurrentUser();
    if (!user) {
      console.error('❌ Pub/Sub setup failed: User not authenticated');
      throw new Error('Unauthorized');
    }

    console.log(`👤 Authenticated user: ${user.email || 'unknown'}`);

    // Get Google service account credentials
    const secretProvider = await getSecretProviderInstance();
    const serviceAccountKey = await secretProvider.getAppSecret('google_service_account_key');
    
    if (!serviceAccountKey) {
      console.error('❌ Google service account credentials not found');
      throw new Error('Google service account credentials not configured. Please contact your administrator.');
    }

    console.log('🔑 Google service account credentials loaded successfully');
    const credentials = JSON.parse(serviceAccountKey);

    // Create OAuth2 client with service account
    console.log('🔐 Initializing Google Auth with service account');
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
      auth: authClient as any
    });
    console.log('📡 Pub/Sub client initialized');

    // Create topic if it doesn't exist
    const topicPath = `projects/${request.projectId}/topics/${request.topicName}`;
    console.log(`🏷️  Checking if topic exists: ${topicPath}`);
    
    try {
      await pubsub.projects.topics.get({
        topic: topicPath
      });
      console.log(`✅ Topic ${topicPath} already exists`);
    } catch (error: any) {
      if (error.code === 404) {
        console.log(`🏷️  Topic not found, creating: ${topicPath}`);
        // Create the topic
        await pubsub.projects.topics.create({
          name: topicPath
        });
        console.log(`✅ Created topic ${topicPath}`);
      } else {
        console.error(`❌ Failed to check/create topic ${topicPath}:`, error);
        throw error;
      }
    }

    // Ensure Gmail can publish test messages to the topic
    try {
      console.log('🔐 Ensuring Gmail push service has publisher role on topic');
      const getPolicyResp = await pubsub.projects.topics.getIamPolicy({
        resource: topicPath,
      } as any);

      const policy = getPolicyResp.data || ({} as any);
      const bindings = Array.isArray(policy.bindings) ? policy.bindings : [];
      const member = 'serviceAccount:gmail-api-push@system.gserviceaccount.com';
      const role = 'roles/pubsub.publisher';

      const existing = bindings.find((b: any) => b.role === role);
      if (existing) {
        if (!existing.members) existing.members = [];
        if (!existing.members.includes(member)) {
          existing.members.push(member);
        }
      } else {
        bindings.push({ role, members: [member] });
      }

      await pubsub.projects.topics.setIamPolicy({
        resource: topicPath,
        requestBody: {
          policy: {
            bindings,
            etag: policy.etag,
          }
        }
      } as any);
      console.log('✅ Gmail publisher role ensured on topic');
    } catch (iamErr) {
      console.warn('⚠️ Failed to ensure Gmail publisher role on topic. Gmail watch may fail.', iamErr);
    }

    // Create subscription if it doesn't exist
    const subscriptionPath = `projects/${request.projectId}/subscriptions/${request.subscriptionName}`;
    console.log(`🔔 Checking if subscription exists: ${subscriptionPath}`);
    
    try {
      const subscription = await pubsub.projects.subscriptions.get({
        subscription: subscriptionPath
      });
      console.log(`✅ Subscription ${subscriptionPath} already exists`);
      
      // Log current push config
      const currentPushConfig = subscription.data.pushConfig;
      console.log(`📡 Current push endpoint: ${currentPushConfig?.pushEndpoint || 'none'}`);
      
      // Update the push config to ensure webhook URL is current
      console.log(`🔄 Updating push config to: ${request.webhookUrl}`);
      await pubsub.projects.subscriptions.modifyPushConfig({
        subscription: subscriptionPath,
        requestBody: {
          pushConfig: {
            pushEndpoint: request.webhookUrl,
            oidcToken: {
              serviceAccountEmail: credentials.client_email,
              audience: request.webhookUrl
            },
            attributes: {
              'x-goog-version': 'v1'
            }
          }
        }
      });
      console.log(`✅ Updated push config for subscription ${subscriptionPath}`);
    } catch (error: any) {
      if (error.code === 404) {
        console.log(`🔔 Subscription not found, creating: ${subscriptionPath}`);
        console.log(`📡 Configuring push endpoint: ${request.webhookUrl}`);
        console.log(`🔗 Linking to topic: ${topicPath}`);
        
        // Create the subscription
        const createResult = await pubsub.projects.subscriptions.create({
          name: subscriptionPath,
          requestBody: {
            topic: topicPath,
            pushConfig: {
              pushEndpoint: request.webhookUrl,
              oidcToken: {
                serviceAccountEmail: credentials.client_email,
                audience: request.webhookUrl
              },
              attributes: {
                'x-goog-version': 'v1'
              }
            },
            ackDeadlineSeconds: 600, // 10 minutes
            messageRetentionDuration: '604800s', // 7 days
            // Omit expirationPolicy to never expire (default behavior)
          }
        });
        
        console.log(`✅ Created subscription ${subscriptionPath} with config:`, {
          topic: topicPath,
          pushEndpoint: request.webhookUrl,
          ackDeadlineSeconds: 600,
          messageRetentionDuration: '604800s',
          expirationPolicy: 'never expires (default)'
        });
      } else {
        console.error(`❌ Failed to check/create subscription ${subscriptionPath}:`, error);
        throw error;
      }
    }

    console.log(`✅ Pub/Sub setup completed successfully for project ${request.projectId}`);
    const result = {
      success: true,
      topicPath,
      subscriptionPath,
      webhookUrl: request.webhookUrl
    };
    
    console.log('📋 Final configuration:', result);
    return result;

  } catch (error: any) {
    console.error(`❌ Failed to setup Pub/Sub for project ${request.projectId}:`, {
      error: error.message,
      code: error.code,
      stack: error.stack,
      config: {
        topicName: request.topicName,
        subscriptionName: request.subscriptionName,
        webhookUrl: request.webhookUrl
      }
    });
    throw new Error(`Failed to setup Google Pub/Sub: ${error.message}`);
  }
}
