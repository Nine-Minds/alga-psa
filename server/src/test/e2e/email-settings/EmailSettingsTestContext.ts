import { E2ETestContext, E2ETestContextOptions } from '../utils/e2e-test-context';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';

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
   * Configure OAuth provider URLs and credentials for testing
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
    
    // OAuth credentials for testing
    process.env.MICROSOFT_CLIENT_ID = 'test-microsoft-client-id';
    process.env.MICROSOFT_CLIENT_SECRET = 'test-microsoft-client-secret';
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000';
    
    console.log('🔧 Configured OAuth providers to use mock service');
    console.log(`   📍 Mock OAuth server: ${this.oauthMockUrl}`);
    console.log(`   🔐 Microsoft endpoints: ${this.oauthMockUrl}/common/oauth2/v2.0/*`);
    console.log(`   🔐 Google endpoints: ${this.oauthMockUrl}/o/oauth2/*`);
    console.log(`   🔑 OAuth credentials configured for testing`);
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
    
    // Note: Inbound ticket defaults are now tenant-level settings, not linked to providers
    console.log(`     ℹ️ Using tenant-level inbound ticket defaults (not provider-specific)`);
    
    const providerId = crypto.randomUUID();
    
    const providerData = {
      id: providerId,
      tenant: config.tenant_id,
      provider_name: `${config.provider} - ${config.mailbox}`,
      provider_type: config.provider, // Use actual provider type for tests
      mailbox: config.mailbox,
      is_active: true,
      status: 'connected',
      created_at: new Date(),
      updated_at: new Date()
    };

    console.log(`     💾 Storing provider configuration in database...`);
    const [provider] = await this.db('email_providers') // Use correct table name
      .insert(providerData)
      .returning('*');
    
    // Create vendor-specific config in separate table
    console.log(`     🔧 Creating ${config.provider} configuration...`);
    let vendorConfig;
    if (config.provider === 'microsoft') {
      const microsoftConfigData = {
        email_provider_id: providerId,
        tenant: config.tenant_id,
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        tenant_id: 'test-tenant-id',
        redirect_uri: 'http://localhost:3000/api/auth/callback',
        auto_process_emails: true,
        max_emails_per_sync: 50,
        folder_filters: JSON.stringify(['Inbox']),
        access_token: `mock-access-token-${Date.now()}`,
        refresh_token: `mock-refresh-token-${Date.now()}`,
        token_expires_at: new Date(Date.now() + 3600000).toISOString(),
        created_at: new Date(),
        updated_at: new Date()
      };
      
      const [insertedConfig] = await this.db('microsoft_email_provider_config')
        .insert(microsoftConfigData)
        .returning('*');
      vendorConfig = insertedConfig;
    } else if (config.provider === 'google') {
      const googleConfigData = {
        email_provider_id: providerId,
        tenant: config.tenant_id,
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        project_id: 'test-project-id',
        redirect_uri: 'http://localhost:3000/api/auth/callback',
        pubsub_topic_name: 'test-topic',
        pubsub_subscription_name: 'test-subscription',
        auto_process_emails: true,
        max_emails_per_sync: 50,
        label_filters: JSON.stringify(['INBOX']),
        access_token: `mock-access-token-${Date.now()}`,
        refresh_token: `mock-refresh-token-${Date.now()}`,
        token_expires_at: new Date(Date.now() + 3600000).toISOString(),
        created_at: new Date(),
        updated_at: new Date()
      };
      
      const [insertedConfig] = await this.db('google_email_provider_config')
        .insert(googleConfigData)
        .returning('*');
      vendorConfig = insertedConfig;
    }

    console.log(`     🔗 Provider linked to tenant: ${config.tenant_id.substring(0, 8)}...`);
    
    // Add provider_config field with OAuth tokens to the returned object
    const webhookToken = `webhook-token-${Date.now()}`;
    const providerWithConfig = {
      ...provider,
      provider_config: {
        accessToken: vendorConfig?.access_token,
        refreshToken: vendorConfig?.refresh_token,
        clientState: `test-client-state-${Date.now()}`,
        ...(vendorConfig && {
          client_id: vendorConfig.client_id,
          client_secret: vendorConfig.client_secret,
          token_expires_at: vendorConfig.token_expires_at
        })
      },
      webhook_verification_token: webhookToken,
      webhook_id: webhookToken, // Some tests use webhook_id instead of webhook_verification_token
      webhook_notification_url: `${process.env.BASE_URL || 'http://localhost:3000'}/api/email/webhooks/${config.provider}`,
      connection_status: 'connected'
    };
    
    console.log(`     ✅ Provider created with config: accessToken=${vendorConfig?.access_token?.substring(0, 20)}...`);
    return providerWithConfig;
  }

  /**
   * Find an existing email provider by tenant + mailbox
   */
  async findExistingEmailProvider(config: {
    provider: 'microsoft' | 'google';
    mailbox: string;
    tenant_id: string;
  }) {
    console.log(`     🔍 Looking for existing ${config.provider} provider for mailbox: ${config.mailbox}`);
    
    // Query the email_providers table for matching provider
    const [provider] = await this.db('email_providers')
      .where('tenant', config.tenant_id)
      .where('mailbox', config.mailbox)
      .where('provider_type', config.provider)
      .limit(1);
    
    if (!provider) {
      console.log(`     ❌ No existing provider found for ${config.provider} - ${config.mailbox}`);
      return null;
    }
    
    console.log(`     ✅ Found existing provider: ${provider.id}`);
    
    // Load vendor-specific config
    let vendorConfig;
    if (config.provider === 'microsoft') {
      const [microsoftConfig] = await this.db('microsoft_email_provider_config')
        .where('email_provider_id', provider.id)
        .limit(1);
      vendorConfig = microsoftConfig;
    } else if (config.provider === 'google') {
      const [googleConfig] = await this.db('google_email_provider_config')
        .where('email_provider_id', provider.id)
        .limit(1);
      vendorConfig = googleConfig;
    }
    
    if (!vendorConfig) {
      console.log(`     ⚠️ Provider found but no vendor config exists for ${provider.id}`);
      return null;
    }
    
    // Return provider object with same structure as createEmailProvider
    const webhookToken = `webhook-token-${Date.now()}`;
    const providerWithConfig = {
      ...provider,
      provider_config: {
        accessToken: vendorConfig.access_token,
        refreshToken: vendorConfig.refresh_token,
        clientState: `test-client-state-${Date.now()}`,
        client_id: vendorConfig.client_id,
        client_secret: vendorConfig.client_secret,
        token_expires_at: vendorConfig.token_expires_at
      },
      webhook_verification_token: webhookToken,
      webhook_id: webhookToken,
      webhook_notification_url: `${process.env.BASE_URL || 'http://localhost:3000'}/api/email/webhooks/${config.provider}`,
      connection_status: 'connected'
    };
    
    console.log(`     ✅ Existing provider loaded with config: accessToken=${vendorConfig.access_token?.substring(0, 20)}...`);
    return providerWithConfig;
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
    
    console.log(`     📡 Making OAuth callback request to: ${url}`);
    console.log(`     🔑 Environment check - MICROSOFT_CLIENT_ID: ${process.env.MICROSOFT_CLIENT_ID ? 'SET' : 'NOT SET'}`);
    console.log(`     🔑 Environment check - MICROSOFT_CLIENT_SECRET: ${process.env.MICROSOFT_CLIENT_SECRET ? 'SET' : 'NOT SET'}`);
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: sessionCookie ? { 'Cookie': sessionCookie } : {},
        redirect: 'manual'
      });
      
      console.log(`     📡 Fetch completed with status: ${response.status}`);
      return response;
    } catch (error: any) {
      console.log(`     ❌ Fetch failed with error: ${error.message}`);
      
      // If the server isn't running, return a mock 404 response
      if (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
        console.log(`     ⚠️ Next.js server not running on localhost:3000`);
        return new Response('Not Found', { status: 404 });
      }
      
      throw error;
    }
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
      // Search for tickets by email metadata, checking both the MailHog ID and Message-ID
      // The emailId passed in is the MailHog internal ID, but the workflow stores the Message-ID header
      const [ticket] = await this.db('tickets')
        .where('tenant', tenant_id)
        .where(function() {
          // Primary search: look for MailHog internal ID in mailhogId field
          this.whereRaw(`email_metadata->>'mailhogId' = ?`, [emailId])
          // Fallback search: look for Message-ID in messageId field (in case emailId is actually the Message-ID)
          .orWhereRaw(`email_metadata->>'messageId' = ?`, [emailId]);
        })
        .limit(1);
      
      if (ticket) {
        console.log(`     ✅ Found ticket for email ID ${emailId}: ${ticket.ticket_id}`);
        console.log(`     📧 Email metadata: ${JSON.stringify(ticket.email_metadata)}`);
        return ticket;
      }
      
      // Debug: Log what tickets exist for this tenant to help troubleshoot
      if ((Date.now() - startTime) > timeoutMs / 2) { // Only log after half the timeout
        const allTickets = await this.db('tickets')
          .where('tenant', tenant_id)
          .whereNotNull('email_metadata')
          .select('ticket_id', 'title', 'email_metadata')
          .limit(5);
        
        console.log(`     🔍 Debug: Found ${allTickets.length} tickets with email metadata:`);
        allTickets.forEach(t => {
          console.log(`       - ${t.ticket_id}: "${t.title}" -> ${JSON.stringify(t.email_metadata)}`);
        });
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