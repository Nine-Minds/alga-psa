import { E2ETestContext, E2ETestContextOptions } from '../utils/e2e-test-context';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export interface EmailSettingsTestContextOptions extends E2ETestContextOptions {
  /**
   * OAuth mock service URL
   * @default 'http://localhost:8081'
   */
  oauthMockUrl?: string;
}

/**
 * Extended E2ETestContext for email settings integration tests
 */
export class EmailSettingsTestContext extends E2ETestContext {
  private oauthMockUrl: string;
  private testKeyPair?: { publicKey: string; privateKey: string };

  constructor(options: EmailSettingsTestContextOptions = {}) {
    super(options);
    this.oauthMockUrl = options.oauthMockUrl || 'http://localhost:8081';
  }

  /**
   * Initialize email settings test context
   */
  async initialize(): Promise<void> {
    await super.initialize();
    
    // Generate test key pair for JWT signing
    this.testKeyPair = this.generateTestKeyPair();
    
    // Set OAuth URLs to point to mock service
    this.setupOAuthProviders();
  }

  /**
   * Configure OAuth provider URLs to use mock service
   */
  setupOAuthProviders(): void {
    // Microsoft OAuth endpoints
    process.env.MICROSOFT_OAUTH_AUTHORIZE_URL = `${this.oauthMockUrl}/common/oauth2/v2.0/authorize`;
    process.env.MICROSOFT_OAUTH_TOKEN_URL = `${this.oauthMockUrl}/common/oauth2/v2.0/token`;
    process.env.MICROSOFT_GRAPH_API_URL = `${this.oauthMockUrl}`;
    
    // Google OAuth endpoints
    process.env.GOOGLE_OAUTH_AUTHORIZE_URL = `${this.oauthMockUrl}/o/oauth2/v2/auth`;
    process.env.GOOGLE_OAUTH_TOKEN_URL = `${this.oauthMockUrl}/token`;
    process.env.GOOGLE_API_URL = `${this.oauthMockUrl}`;
    process.env.GOOGLE_PUBSUB_API_URL = `${this.oauthMockUrl}`;
    
    console.log('🔧 Configured OAuth providers to use mock service');
    console.log(`   📍 Mock OAuth server: ${this.oauthMockUrl}`);
    console.log(`   🔐 Microsoft endpoints: ${this.oauthMockUrl}/common/oauth2/v2.0/*`);
    console.log(`   🔐 Google endpoints: ${this.oauthMockUrl}/o/oauth2/*`);
  }

  /**
   * Create an email provider configuration
   */
  async createEmailProvider(config: {
    provider: 'microsoft' | 'google';
    mailbox: string;
    tenant_id: string;
    company_id?: string;
  }) {
    console.log(`     📋 Generating OAuth tokens for ${config.provider} provider...`);
    
    const providerData = {
      id: crypto.randomUUID(),
      tenant: config.tenant_id,
      name: `${config.provider} - ${config.mailbox}`,
      provider_type: config.provider,
      mailbox: config.mailbox,
      active: true,
      connection_status: 'connected',
      provider_config: {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'http://localhost:3000/api/auth/callback',
        accessToken: `mock-access-token-${Date.now()}`,
        refreshToken: `mock-refresh-token-${Date.now()}`,
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
        clientState: crypto.randomBytes(16).toString('hex')
      },
      webhook_notification_url: `http://localhost:3000/api/webhooks/${config.provider}`,
      webhook_verification_token: crypto.randomBytes(32).toString('hex'),
      created_at: new Date(),
      updated_at: new Date()
    };

    console.log(`     💾 Storing provider configuration in database...`);
    const [provider] = await this.db('email_provider_configs')
      .insert(providerData)
      .returning('*');

    console.log(`     🔗 Provider linked to tenant: ${config.tenant_id.substring(0, 8)}...`);
    return provider;
  }

  /**
   * Simulate OAuth callback
   */
  async simulateOAuthCallback(
    provider: string, 
    code: string, 
    state: string,
    sessionCookie?: string
  ): Promise<Response> {
    const url = `http://localhost:3000/api/auth/${provider}/callback?code=${code}&state=${state}`;
    
    return fetch(url, {
      method: 'GET',
      headers: sessionCookie ? { 'Cookie': sessionCookie } : {},
      redirect: 'manual'
    });
  }

  /**
   * Simulate email webhook
   */
  async simulateEmailWebhook(
    provider: 'microsoft' | 'google',
    payload: any,
    headers: Record<string, string> = {}
  ): Promise<Response> {
    const endpoint = provider === 'microsoft' 
      ? '/api/email/webhooks/microsoft'
      : '/api/email/webhooks/google';
    
    const defaultHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    
    return fetch(`http://localhost:3000${endpoint}`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify(payload)
    });
  }

  /**
   * Create Microsoft webhook payload
   */
  createMicrosoftWebhookPayload(options: {
    clientState: string;
    subscriptionId: string;
    changeType?: string;
    resource?: string;
    resourceData?: any;
  }) {
    return {
      value: [{
        subscriptionId: options.subscriptionId,
        clientState: options.clientState,
        changeType: options.changeType || 'created',
        resource: options.resource || '/users/test@example.com/messages/AAA123',
        resourceData: options.resourceData || {
          '@odata.type': '#microsoft.graph.message',
          id: `msg-${Date.now()}`,
          subject: 'Test Email',
          from: {
            emailAddress: { address: 'sender@example.com' }
          },
          body: {
            content: 'Test email content',
            contentType: 'text'
          }
        },
        subscriptionExpirationDateTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        tenantId: 'test-tenant-id'
      }]
    };
  }

  /**
   * Create Google Pub/Sub message
   */
  createGooglePubSubMessage(data: any, attributes?: Record<string, string>) {
    return {
      message: {
        data: Buffer.from(JSON.stringify(data)).toString('base64'),
        messageId: `msg-${Date.now()}`,
        publishTime: new Date().toISOString(),
        attributes: attributes || {}
      }
    };
  }

  /**
   * Create JWT for Google Pub/Sub authentication
   */
  createGooglePubSubJWT(payload: {
    iss: string;
    sub: string;
    aud: string;
    iat?: number;
    exp?: number;
  }): string {
    if (!this.testKeyPair) {
      throw new Error('Test key pair not initialized');
    }
    
    const jwtPayload = {
      ...payload,
      iat: payload.iat || Math.floor(Date.now() / 1000),
      exp: payload.exp || Math.floor(Date.now() / 1000) + 3600
    };
    
    return jwt.sign(jwtPayload, this.testKeyPair.privateKey, {
      algorithm: 'RS256',
      header: {
        kid: 'test-key-id'
      }
    });
  }

  /**
   * Generate test RSA key pair for JWT signing
   */
  private generateTestKeyPair(): { publicKey: string; privateKey: string } {
    const { generateKeyPairSync } = crypto;
    return generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
  }

  /**
   * Wait for email to be processed into a ticket
   */
  async waitForTicketCreation(
    tenant_id: string,
    emailId: string,
    timeoutMs: number = 30000
  ): Promise<any> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const [ticket] = await this.db('tickets')
        .where('tenant', tenant_id)
        .whereRaw(`email_metadata->>'messageId' = ?`, [emailId])
        .limit(1);
      
      if (ticket) {
        return ticket;
      }
      
      // Wait 500ms before checking again
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    throw new Error(`Timeout waiting for ticket creation for email ${emailId}`);
  }

  /**
   * Create test helpers specific to email settings
   */
  static createEmailSettingsHelpers() {
    return {
      beforeAll: async (options: EmailSettingsTestContextOptions = {}) => {
        const context = new EmailSettingsTestContext(options);
        await context.initialize();
        return context;
      },
      
      afterAll: async (context: EmailSettingsTestContext) => {
        await context.cleanup();
      },
      
      beforeEach: async (context: EmailSettingsTestContext) => {
        // Clear emails before each test
        if (context.mailhogClient) {
          await context.mailhogClient.clearMessages();
        }
      },
      
      afterEach: async (context: EmailSettingsTestContext) => {
        // Clean up test data after each test
        await context.emailTestFactory.cleanup();
      }
    };
  }
}