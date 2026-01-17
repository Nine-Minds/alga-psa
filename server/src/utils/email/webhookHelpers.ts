/**
 * Webhook Helper Functions for Email Providers
 */

import { createHmac } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import logger from '@alga-psa/core/logger';

// Path to ngrok URL file (written by ngrok-sync container)
const NGROK_URL_FILE = '/app/ngrok/url';

// Check if running in development mode
const isDevelopment = process.env.NODE_ENV === 'development' || process.env.APP_ENV === 'development';

/**
 * Get the webhook base URL dynamically.
 * Priority:
 *   1. Ngrok URL from file (development mode only, for local tunneling)
 *   2. Environment variables (NGROK_URL, NEXT_PUBLIC_BASE_URL, NEXTAUTH_URL, etc.)
 *   3. Default localhost
 * 
 * This function provides the same dynamic URL resolution as ninjaone webhooks,
 * allowing ngrok URLs to be automatically detected in development environments.
 */
export function getWebhookBaseUrl(fallbackEnvVars?: string[]): string {
  // In development mode, check for ngrok URL file first
  if (isDevelopment) {
    try {
      if (fs.existsSync(NGROK_URL_FILE)) {
        const ngrokUrl = fs.readFileSync(NGROK_URL_FILE, 'utf-8').trim();
        if (ngrokUrl) {
          logger.debug('[Webhook] Using ngrok URL from file', { url: ngrokUrl });
          return ngrokUrl;
        }
      }
    } catch (error) {
      // Ignore file read errors, fall back to env vars
      logger.debug('[Webhook] Could not read ngrok URL file, using environment variables');
    }
  }

  // Fall back to environment variables
  const envVars = fallbackEnvVars || [
    'NGROK_URL',
    'NEXT_PUBLIC_BASE_URL',
    'NEXTAUTH_URL',
    'PUBLIC_WEBHOOK_BASE_URL'
  ];

  for (const envVar of envVars) {
    const value = process.env[envVar];
    if (value) {
      return value;
    }
  }

  return 'http://localhost:3000';
}

/**
 * Generate a secure client state for Microsoft webhook validation
 */
export function generateWebhookClientState(): string {
  return Buffer.from(Math.random().toString(36).substring(2) + Date.now().toString(36)).toString('base64');
}

/**
 * Validate Microsoft webhook signature
 */
export function validateMicrosoftWebhookSignature(
  clientState: string,
  expectedClientState: string
): boolean {
  return clientState === expectedClientState;
}

/**
 * Create webhook validation token for storage
 */
export function createWebhookValidationToken(providerId: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(providerId);
  return hmac.digest('hex');
}

/**
 * Format webhook URL for provider
 */
export function formatWebhookUrl(baseUrl: string, provider: 'microsoft' | 'google'): string {
  // Remove trailing slash if present
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  return `${cleanBaseUrl}/api/email/webhooks/${provider}`;
}

/**
 * Calculate webhook retry delay with exponential backoff
 */
export function calculateWebhookRetryDelay(attemptNumber: number): number {
  const baseDelay = 1000; // 1 second
  const maxDelay = 60000; // 60 seconds
  const delay = Math.min(baseDelay * Math.pow(2, attemptNumber), maxDelay);
  
  // Add jitter to prevent thundering herd
  const jitter = Math.random() * 0.1 * delay;
  return Math.floor(delay + jitter);
}

/**
 * Check if webhook error is retryable
 */
export function isRetryableWebhookError(error: any): boolean {
  // Network errors
  if (error.code === 'ECONNREFUSED' || 
      error.code === 'ETIMEDOUT' || 
      error.code === 'ENOTFOUND') {
    return true;
  }

  // HTTP status codes that are retryable
  const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
  if (error.response?.status && retryableStatusCodes.includes(error.response.status)) {
    return true;
  }

  // Rate limiting errors
  if (error.message?.toLowerCase().includes('rate limit') ||
      error.message?.toLowerCase().includes('too many requests')) {
    return true;
  }

  return false;
}

/**
 * Extract tenant from webhook payload
 */
export function extractTenantFromWebhook(
  provider: 'microsoft' | 'google',
  payload: any
): string | null {
  try {
    if (provider === 'microsoft' && payload.value?.[0]?.tenantId) {
      return payload.value[0].tenantId;
    }
    
    // For Google, tenant is determined by email lookup
    return null;
  } catch (error) {
    console.error('Error extracting tenant from webhook payload:', error);
    return null;
  }
}

/**
 * Sanitize webhook payload for logging
 */
export function sanitizeWebhookPayload(payload: any): any {
  const sanitized = JSON.parse(JSON.stringify(payload));
  
  // Remove sensitive data
  const sensitiveFields = ['clientState', 'authorization', 'access_token', 'refresh_token'];
  
  function removeSensitive(obj: any) {
    if (typeof obj !== 'object' || obj === null) return;
    
    for (const key in obj) {
      if (sensitiveFields.includes(key.toLowerCase())) {
        obj[key] = '[REDACTED]';
      } else if (typeof obj[key] === 'object') {
        removeSensitive(obj[key]);
      }
    }
  }
  
  removeSensitive(sanitized);
  return sanitized;
}