import { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';

/**
 * Middleware for authenticating email webhook requests
 * Provides security validation for webhook endpoints
 */
export class EmailWebhookAuth {
  
  /**
   * Validate Microsoft Graph webhook request
   * Microsoft Graph sends a clientState field that we can use for validation
   */
  static validateMicrosoftWebhook(req: NextApiRequest, expectedClientState?: string): boolean {
    try {
      // For subscription validation (GET requests), no auth needed
      if (req.method === 'GET') {
        return true;
      }

      // For webhook notifications (POST requests)
      if (req.method === 'POST') {
        const notifications = req.body;
        
        if (!notifications || !notifications.value || !Array.isArray(notifications.value)) {
          console.warn('⚠️ Invalid Microsoft webhook payload format');
          return false;
        }

        // Validate clientState if provided
        if (expectedClientState) {
          for (const notification of notifications.value) {
            if (notification.clientState !== expectedClientState) {
              console.warn('⚠️ Invalid clientState in Microsoft webhook notification');
              return false;
            }
          }
        }

        return true;
      }

      return false;
    } catch (error) {
      console.error('❌ Error validating Microsoft webhook:', error);
      return false;
    }
  }

  /**
   * Validate Gmail webhook request using Google's signature verification
   * Google signs webhook requests with a secret
   */
  static validateGmailWebhook(req: NextApiRequest, webhookSecret?: string): boolean {
    try {
      // For Gmail, we would validate the signature header
      const signature = req.headers['x-goog-signature'] as string;
      
      if (!signature || !webhookSecret) {
        console.warn('⚠️ Missing signature or webhook secret for Gmail webhook');
        return true; // For MVP, allow without validation
      }

      // Verify signature
      const payload = JSON.stringify(req.body);
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('base64');

      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );

      if (!isValid) {
        console.warn('⚠️ Invalid signature for Gmail webhook');
        return false;
      }

      return true;
    } catch (error) {
      console.error('❌ Error validating Gmail webhook:', error);
      return false;
    }
  }

  /**
   * Rate limiting for webhook endpoints
   * Prevents abuse of webhook endpoints
   */
  static rateLimitCheck(req: NextApiRequest, maxRequestsPerMinute: number = 60): boolean {
    try {
      // Get client IP
      const clientIp = req.headers['x-forwarded-for'] || 
                      req.headers['x-real-ip'] || 
                      req.connection?.remoteAddress || 
                      'unknown';

      // For MVP, we'll implement a simple in-memory rate limiter
      // In production, this should use Redis or a proper rate limiting service
      const now = Date.now();
      const windowMs = 60 * 1000; // 1 minute window
      
      if (!EmailWebhookAuth.rateLimitStore) {
        EmailWebhookAuth.rateLimitStore = new Map();
      }

      const key = `webhook:${clientIp}`;
      const requestLog = EmailWebhookAuth.rateLimitStore.get(key) || [];
      
      // Remove old requests outside the window
      const recentRequests = requestLog.filter((timestamp: number) => 
        now - timestamp < windowMs
      );

      if (recentRequests.length >= maxRequestsPerMinute) {
        console.warn(`⚠️ Rate limit exceeded for IP: ${clientIp}`);
        return false;
      }

      // Add current request
      recentRequests.push(now);
      EmailWebhookAuth.rateLimitStore.set(key, recentRequests);

      return true;
    } catch (error) {
      console.error('❌ Error in rate limit check:', error);
      return true; // Allow request on error to avoid blocking legitimate traffic
    }
  }

  /**
   * Validate webhook request headers
   */
  static validateHeaders(req: NextApiRequest, provider: 'microsoft' | 'google'): boolean {
    try {
      const userAgent = req.headers['user-agent'] as string;
      
      switch (provider) {
        case 'microsoft':
          // Microsoft Graph sends specific user agent patterns
          if (userAgent && !userAgent.includes('Microsoft')) {
            console.warn('⚠️ Suspicious user agent for Microsoft webhook:', userAgent);
            // For MVP, log but don't block
          }
          break;
          
        case 'google':
          // Google sends specific user agent patterns
          if (userAgent && !userAgent.includes('Google')) {
            console.warn('⚠️ Suspicious user agent for Google webhook:', userAgent);
            // For MVP, log but don't block
          }
          break;
      }

      return true;
    } catch (error) {
      console.error('❌ Error validating headers:', error);
      return true;
    }
  }

  /**
   * Main webhook authentication middleware
   */
  static authenticate(
    provider: 'microsoft' | 'google',
    options: {
      clientState?: string;
      webhookSecret?: string;
      maxRequestsPerMinute?: number;
    } = {}
  ) {
    return (req: NextApiRequest, res: NextApiResponse, next: () => void) => {
      try {
        // Rate limiting
        if (!EmailWebhookAuth.rateLimitCheck(req, options.maxRequestsPerMinute)) {
          return res.status(429).json({ error: 'Rate limit exceeded' });
        }

        // Header validation
        if (!EmailWebhookAuth.validateHeaders(req, provider)) {
          return res.status(403).json({ error: 'Invalid headers' });
        }

        // Provider-specific validation
        let isValid = false;
        
        switch (provider) {
          case 'microsoft':
            isValid = EmailWebhookAuth.validateMicrosoftWebhook(req, options.clientState);
            break;
          case 'google':
            isValid = EmailWebhookAuth.validateGmailWebhook(req, options.webhookSecret);
            break;
          default:
            console.error('❌ Unsupported provider:', provider);
            return res.status(400).json({ error: 'Unsupported provider' });
        }

        if (!isValid) {
          return res.status(403).json({ error: 'Webhook authentication failed' });
        }

        // Authentication successful, proceed to handler
        next();
      } catch (error) {
        console.error('❌ Error in webhook authentication middleware:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
    };
  }

  // Simple in-memory store for rate limiting (MVP only)
  // In production, use Redis or a proper rate limiting service
  private static rateLimitStore: Map<string, number[]>;
}