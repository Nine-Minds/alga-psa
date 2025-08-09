/**
 * Webhook validation and testing utilities for Gmail Pub/Sub
 */

import { OAuth2Client } from 'google-auth-library';

export interface WebhookTestResult {
  success: boolean;
  error?: string;
  details?: any;
}

export interface GmailWebhookPayload {
  message: {
    data: string; // Base64 encoded
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

export interface GmailNotification {
  emailAddress: string;
  historyId: string;
}

/**
 * Validate Gmail webhook payload structure
 */
export function validateWebhookPayload(payload: any): WebhookTestResult {
  try {
    // Check required fields
    if (!payload.message) {
      return {
        success: false,
        error: 'Missing message field in payload'
      };
    }

    if (!payload.message.data) {
      return {
        success: false,
        error: 'Missing message.data field in payload'
      };
    }

    if (!payload.message.messageId) {
      return {
        success: false,
        error: 'Missing message.messageId field in payload'
      };
    }

    if (!payload.subscription) {
      return {
        success: false,
        error: 'Missing subscription field in payload'
      };
    }

    // Validate base64 encoding
    try {
      const decodedData = Buffer.from(payload.message.data, 'base64').toString();
      const notification: GmailNotification = JSON.parse(decodedData);
      
      if (!notification.emailAddress) {
        return {
          success: false,
          error: 'Missing emailAddress in decoded notification'
        };
      }

      if (!notification.historyId) {
        return {
          success: false,
          error: 'Missing historyId in decoded notification'
        };
      }

      return {
        success: true,
        details: {
          messageId: payload.message.messageId,
          subscription: payload.subscription,
          emailAddress: notification.emailAddress,
          historyId: notification.historyId
        }
      };

    } catch (error) {
      return {
        success: false,
        error: `Failed to decode message data: ${error instanceof Error ? error.message : String(error)}`
      };
    }

  } catch (error) {
    return {
      success: false,
      error: `Payload validation failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Create a test webhook payload for Gmail notifications
 */
export function createTestWebhookPayload(
  emailAddress: string,
  historyId: string,
  subscriptionName: string
): GmailWebhookPayload {
  const notification: GmailNotification = {
    emailAddress,
    historyId
  };

  const encodedData = Buffer.from(JSON.stringify(notification)).toString('base64');
  
  return {
    message: {
      data: encodedData,
      messageId: `test-message-${Date.now()}`,
      publishTime: new Date().toISOString()
    },
    subscription: subscriptionName
  };
}

/**
 * Test webhook endpoint connectivity
 */
export async function testWebhookEndpoint(
  webhookUrl: string,
  payload: GmailWebhookPayload
): Promise<WebhookTestResult> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Gmail-Webhook-Tester/1.0'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        details: {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries())
        }
      };
    }

    const responseData = await response.json();
    
    return {
      success: true,
      details: {
        status: response.status,
        response: responseData,
        headers: Object.fromEntries(response.headers.entries())
      }
    };

  } catch (error) {
    return {
      success: false,
      error: `Network error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Verify JWT token from Google Pub/Sub (for production validation)
 */
export async function verifyGoogleJWT(token: string): Promise<WebhookTestResult> {
  try {
    const client = new OAuth2Client();
    
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: undefined, // Accept any audience for Pub/Sub
    });
    
    const payload = ticket.getPayload();
    
    // Verify it's from Google Pub/Sub
    if (payload?.email !== 'pubsub-publishing@system.gserviceaccount.com' &&
        !payload?.email?.endsWith('@system.gserviceaccount.com')) {
      return {
        success: false,
        error: 'Invalid token issuer - not from Google Pub/Sub service'
      };
    }

    return {
      success: true,
      details: {
        issuer: payload?.iss,
        audience: payload?.aud,
        email: payload?.email,
        expirationTime: payload?.exp
      }
    };

  } catch (error) {
    return {
      success: false,
      error: `JWT verification failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Generate standard Pub/Sub names for testing
 */
export function generateTestPubSubNames(tenantId: string = 'test-tenant') {
  return {
    topicName: `gmail-notifications-${tenantId}`,
    subscriptionName: `gmail-webhook-${tenantId}`,
    webhookUrl: `${process.env.NGROK_URL || 'http://localhost:3000'}/api/email/webhooks/google`
  };
}

/**
 * Comprehensive webhook test suite
 */
export async function runWebhookTestSuite(
  webhookUrl: string,
  emailAddress: string,
  subscriptionName: string
): Promise<{
  overallSuccess: boolean;
  tests: Record<string, WebhookTestResult>;
}> {
  const results: Record<string, WebhookTestResult> = {};
  
  // Test 1: Basic payload validation
  const testPayload = createTestWebhookPayload(emailAddress, 'test-history-123', subscriptionName);
  results.payloadValidation = validateWebhookPayload(testPayload);
  
  // Test 2: Endpoint connectivity
  results.endpointConnectivity = await testWebhookEndpoint(webhookUrl, testPayload);
  
  // Test 3: Invalid payload handling
  const invalidPayload = { invalid: 'payload' };
  results.invalidPayloadHandling = validateWebhookPayload(invalidPayload);
  
  // Test 4: Malformed base64 data
  const malformedPayload = {
    ...testPayload,
    message: {
      ...testPayload.message,
      data: 'invalid-base64-data'
    }
  };
  results.malformedDataHandling = validateWebhookPayload(malformedPayload);
  
  const overallSuccess = results.payloadValidation.success && 
                         results.endpointConnectivity.success &&
                         !results.invalidPayloadHandling.success && // Should fail
                         !results.malformedDataHandling.success;   // Should fail
  
  return {
    overallSuccess,
    tests: results
  };
}