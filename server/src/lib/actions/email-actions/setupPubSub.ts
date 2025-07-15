'use server';

import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { getSecretProviderInstance } from '@shared/core';
import { getCurrentUser } from '../user-actions/userActions';

export interface SetupPubSubRequest {
  projectId: string;
  topicName: string;
  subscriptionName: string;
  webhookUrl: string;
}

export async function setupPubSub(request: SetupPubSubRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('Unauthorized');
    }

    // Get Google service account credentials
    const secretProvider = getSecretProviderInstance();
    const serviceAccountKey = await secretProvider.getAppSecret('google_service_account_key');
    
    if (!serviceAccountKey) {
      throw new Error('Google service account credentials not configured. Please contact your administrator.');
    }

    const credentials = JSON.parse(serviceAccountKey);

    // Create OAuth2 client with service account
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/pubsub',
        'https://www.googleapis.com/auth/cloud-platform'
      ]
    });

    const authClient = await auth.getClient();
    
    // Initialize Pub/Sub client
    const pubsub = google.pubsub({
      version: 'v1',
      auth: authClient as any
    });

    // Create topic if it doesn't exist
    const topicPath = `projects/${request.projectId}/topics/${request.topicName}`;
    
    try {
      await pubsub.projects.topics.get({
        topic: topicPath
      });
      console.log(`Topic ${topicPath} already exists`);
    } catch (error: any) {
      if (error.code === 404) {
        // Create the topic
        await pubsub.projects.topics.create({
          name: topicPath
        });
        console.log(`Created topic ${topicPath}`);
      } else {
        throw error;
      }
    }

    // Create subscription if it doesn't exist
    const subscriptionPath = `projects/${request.projectId}/subscriptions/${request.subscriptionName}`;
    
    try {
      await pubsub.projects.subscriptions.get({
        subscription: subscriptionPath
      });
      console.log(`Subscription ${subscriptionPath} already exists`);
      
      // Update the push config to ensure webhook URL is current
      await pubsub.projects.subscriptions.modifyPushConfig({
        subscription: subscriptionPath,
        requestBody: {
          pushConfig: {
            pushEndpoint: request.webhookUrl,
            attributes: {
              'x-goog-version': 'v1'
            }
          }
        }
      });
    } catch (error: any) {
      if (error.code === 404) {
        // Create the subscription
        await pubsub.projects.subscriptions.create({
          name: subscriptionPath,
          requestBody: {
            topic: topicPath,
            pushConfig: {
              pushEndpoint: request.webhookUrl,
              attributes: {
                'x-goog-version': 'v1'
              }
            },
            ackDeadlineSeconds: 600, // 10 minutes
            messageRetentionDuration: '604800s', // 7 days
            expirationPolicy: {
              ttl: '' // Never expire
            }
          }
        });
        console.log(`Created subscription ${subscriptionPath}`);
      } else {
        throw error;
      }
    }

    return {
      success: true,
      topicPath,
      subscriptionPath,
      webhookUrl: request.webhookUrl
    };

  } catch (error: any) {
    console.error('Failed to setup Pub/Sub:', error);
    throw new Error(`Failed to setup Google Pub/Sub: ${error.message}`);
  }
}