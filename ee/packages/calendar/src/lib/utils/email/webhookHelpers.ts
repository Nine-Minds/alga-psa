/**
 * Webhook helper functions for calendar providers.
 */

import { createHmac } from 'crypto';
import fs from 'fs';
import logger from '@alga-psa/core/logger';

const NGROK_URL_FILE = '/app/ngrok/url';
const isDevelopment =
  process.env.NODE_ENV === 'development' || process.env.APP_ENV === 'development';

export function getWebhookBaseUrl(fallbackEnvVars?: string[]): string {
  if (isDevelopment) {
    try {
      if (fs.existsSync(NGROK_URL_FILE)) {
        const ngrokUrl = fs.readFileSync(NGROK_URL_FILE, 'utf-8').trim();
        if (ngrokUrl) {
          logger.debug('[Webhook] Using ngrok URL from file', { url: ngrokUrl });
          return ngrokUrl;
        }
      }
    } catch {
      logger.debug('[Webhook] Could not read ngrok URL file, using environment variables');
    }
  }

  const envVars = fallbackEnvVars || [
    'NGROK_URL',
    'NEXT_PUBLIC_BASE_URL',
    'NEXTAUTH_URL',
    'PUBLIC_WEBHOOK_BASE_URL',
  ];

  for (const envVar of envVars) {
    const value = process.env[envVar];
    if (value) {
      return value;
    }
  }

  return 'http://localhost:3000';
}

export function generateWebhookClientState(): string {
  return Buffer.from(
    `${Math.random().toString(36).substring(2)}${Date.now().toString(36)}`
  ).toString('base64');
}

export function validateMicrosoftWebhookSignature(
  clientState: string,
  expectedClientState: string
): boolean {
  return clientState === expectedClientState;
}

export function createWebhookValidationToken(providerId: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(providerId);
  return hmac.digest('hex');
}
