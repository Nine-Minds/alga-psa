'use server';

import { google } from 'googleapis';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import {
  GMAIL_PUBLISHER_ROLE,
  GMAIL_PUSH_SERVICE_ACCOUNT,
  GmailPubSubSetupError,
} from '../../utils/email/gmailPubSub';

export interface SetupPubSubRequest {
  tenantId: string;
  projectId: string;
  topicName: string;
  subscriptionName: string;
  webhookUrl: string;
}

export interface SetupPubSubResult {
  success: true;
  topicPath: string;
  subscriptionPath: string;
  webhookUrl: string;
  /** Push endpoint read back from Google after provisioning. */
  pushEndpoint: string;
  /** OIDC audience read back from Google after provisioning. */
  audience: string;
}

export async function setupPubSub(request: SetupPubSubRequest): Promise<SetupPubSubResult> {
  console.log(`🔧 Starting Pub/Sub setup for project ${request.projectId}:`, {
    topicName: request.topicName,
    subscriptionName: request.subscriptionName,
    webhookUrl: request.webhookUrl
  });

  try {
    // Get Google service account credentials
    const secretProvider = await getSecretProviderInstance();
    const serviceAccountKey = await secretProvider.getTenantSecret(request.tenantId, 'google_service_account_key');
    
    if (!serviceAccountKey) {
      console.error('❌ Google service account credentials not found');
      throw new Error('GOOGLE_SERVICE_ACCOUNT_MISSING');
    }

    console.log('🔑 Google service account credentials loaded successfully');
    let credentials: Record<string, any>;
    try {
      credentials = JSON.parse(serviceAccountKey);
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_INVALID_JSON');
    }

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

    // Ensure Gmail can publish to the topic. Without this binding Gmail's
    // watch() call is rejected and no notification is ever published, so a
    // failure here is a failure of the whole setup — not a warning.
    try {
      console.log('🔐 Ensuring Gmail push service has publisher role on topic');
      const getPolicyResp = await pubsub.projects.topics.getIamPolicy({
        resource: topicPath,
      } as any);

      const policy = getPolicyResp.data || ({} as any);
      const bindings = Array.isArray(policy.bindings) ? policy.bindings : [];
      const member = `serviceAccount:${GMAIL_PUSH_SERVICE_ACCOUNT}`;
      const role = GMAIL_PUBLISHER_ROLE;

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
    } catch (iamErr: any) {
      const detail = iamErr?.message ? String(iamErr.message) : String(iamErr);
      throw new GmailPubSubSetupError(
        `Could not grant ${GMAIL_PUBLISHER_ROLE} to ${GMAIL_PUSH_SERVICE_ACCOUNT} on ${topicPath}. ` +
          'Without that binding Gmail cannot publish notifications and no inbound mail will arrive. ' +
          'The service account Alga authenticates with needs pubsub.topics.getIamPolicy and ' +
          `pubsub.topics.setIamPolicy on this topic (roles/pubsub.admin covers both). Google reported: ${detail}`
      );
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

    // Read the subscription back rather than trusting the write. A push
    // endpoint or audience that does not match what the webhook route verifies
    // against produces a 401 on every delivery, which is exactly the silent
    // failure this setup path exists to prevent.
    const verified = await pubsub.projects.subscriptions.get({
      subscription: subscriptionPath
    });
    const pushEndpoint = verified.data.pushConfig?.pushEndpoint || '';
    const audience = verified.data.pushConfig?.oidcToken?.audience || '';

    if (pushEndpoint !== request.webhookUrl || audience !== request.webhookUrl) {
      throw new GmailPubSubSetupError(
        `Pub/Sub subscription ${subscriptionPath} is not delivering to this Alga instance. ` +
          `Expected push endpoint and OIDC audience ${request.webhookUrl}, but Google reports ` +
          `push endpoint ${pushEndpoint || '(none)'} and audience ${audience || '(none)'}. ` +
          'Delete the subscription in Google Cloud and run setup again, or correct the base URL Alga is configured with.'
      );
    }

    console.log(`✅ Pub/Sub setup completed successfully for project ${request.projectId}`);
    const result: SetupPubSubResult = {
      success: true,
      topicPath,
      subscriptionPath,
      webhookUrl: request.webhookUrl,
      pushEndpoint,
      audience
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
    // Messages built above are already written for the administrator; passing
    // them through is the whole point of raising them.
    if (error instanceof GmailPubSubSetupError) {
      throw error;
    }

    if (error instanceof Error) {
      if (error.message === 'GOOGLE_SERVICE_ACCOUNT_MISSING') {
        throw new GmailPubSubSetupError('Google service account credentials are not configured for this tenant.');
      }
      if (error.message === 'GOOGLE_SERVICE_ACCOUNT_INVALID_JSON') {
        throw new GmailPubSubSetupError('Google service account credentials are not valid JSON.');
      }
    }

    const detail = error?.message ? String(error.message) : String(error);
    throw new GmailPubSubSetupError(
      `Unable to configure Google Pub/Sub topic ${request.topicName} in project ${request.projectId}. ` +
        'Check the Google Cloud project, the service account permissions, and the webhook base URL. ' +
        `Google reported: ${detail}`
    );
  }
}
