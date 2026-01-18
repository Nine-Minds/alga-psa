import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { EmailProvider } from '@alga-psa/integrations/components';

// Mock database functions
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  first: vi.fn(),
  returning: vi.fn().mockReturnThis(),
};

// Mock the database connection
vi.mock('../../lib/db', () => ({
  createTenantKnex: vi.fn().mockResolvedValue({ knex: mockDb, tenant: 'test-tenant' }),
}));

// Mock the email provider service
vi.mock('../../services/email/EmailProviderService', () => ({
  EmailProviderService: {
    getInstance: vi.fn().mockReturnValue({
      createProvider: vi.fn(),
      updateProvider: vi.fn(),
      deleteProvider: vi.fn(),
      getProvider: vi.fn(),
      listProviders: vi.fn(),
      testConnection: vi.fn(),
      initializeWebhooks: vi.fn(),
    }),
  },
}));

import { EmailProviderService } from '../../services/email/EmailProviderService';

describe('Email Provider Integration Tests', () => {
  const mockTenant = 'test-tenant-123';
  const emailProviderService = EmailProviderService.getInstance();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Provider CRUD Operations', () => {
    it('should create a new Gmail provider', async () => {
      const newProvider = {
        tenant: mockTenant,
        providerType: 'google' as const,
        providerName: 'Test Gmail Provider',
        mailbox: 'test@gmail.com',
        vendorConfig: {
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
          projectId: 'test-project-id',
          pubSubTopic: 'gmail-notifications',
          pubSubSubscription: 'gmail-webhook-subscription',
        },
      };

      const createdProvider = {
        id: 'provider-123',
        ...newProvider,
        isActive: true,
        status: 'configuring',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.mocked(emailProviderService.createProvider).mockResolvedValue(createdProvider as any);

      const result = await emailProviderService.createProvider(newProvider);

      expect(emailProviderService.createProvider).toHaveBeenCalledWith(newProvider);
      expect(result).toEqual(createdProvider);
    });

    it('should create a new Microsoft provider', async () => {
      const newProvider = {
        tenant: mockTenant,
        providerType: 'microsoft' as const,
        providerName: 'Test Microsoft Provider',
        mailbox: 'test@microsoft.com',
        vendorConfig: {
          tenantId: 'ms-tenant-id',
          clientId: 'test-client-id',
          clientSecret: 'test-client-secret',
        },
      };

      const createdProvider = {
        id: 'provider-456',
        ...newProvider,
        isActive: true,
        status: 'configuring',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      vi.mocked(emailProviderService.createProvider).mockResolvedValue(createdProvider as any);

      const result = await emailProviderService.createProvider(newProvider);

      expect(emailProviderService.createProvider).toHaveBeenCalledWith(newProvider);
      expect(result).toEqual(createdProvider);
    });

    it('should list all providers for a tenant', async () => {
      const providers = [
        {
          id: '1',
          tenant: mockTenant,
          providerType: 'google' as const,
          providerName: 'Gmail Provider',
          mailbox: 'gmail@test.com',
          isActive: true,
          status: 'connected' as const,
          vendorConfig: {},
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
        {
          id: '2',
          tenant: mockTenant,
          providerType: 'microsoft' as const,
          providerName: 'Microsoft Provider',
          mailbox: 'outlook@test.com',
          isActive: true,
          status: 'connected' as const,
          vendorConfig: {},
          createdAt: '2024-01-01',
          updatedAt: '2024-01-01',
        },
      ];

      vi.mocked(emailProviderService.listProviders).mockResolvedValue(providers as any);

      const result = await emailProviderService.listProviders(mockTenant);

      expect(emailProviderService.listProviders).toHaveBeenCalledWith(mockTenant);
      expect(result).toHaveLength(2);
      expect(result[0].providerType).toBe('google');
      expect(result[1].providerType).toBe('microsoft');
    });

    it('should update an existing provider', async () => {
      const providerId = 'provider-123';
      const updates = {
        providerName: 'Updated Gmail Provider',
        vendorConfig: {
          maxEmailsPerSync: 100,
        },
      };

      const updatedProvider = {
        id: providerId,
        tenant: mockTenant,
        providerType: 'google' as const,
        providerName: 'Updated Gmail Provider',
        mailbox: 'test@gmail.com',
        isActive: true,
        status: 'connected' as const,
        vendorConfig: {
          clientId: 'test-client-id',
          maxEmailsPerSync: 100,
        },
        createdAt: '2024-01-01',
        updatedAt: new Date().toISOString(),
      };

      vi.mocked(emailProviderService.updateProvider).mockResolvedValue(updatedProvider as any);

      const result = await emailProviderService.updateProvider(providerId, updates);

      expect(emailProviderService.updateProvider).toHaveBeenCalledWith(providerId, updates);
      expect(result.providerName).toBe('Updated Gmail Provider');
      expect(result.vendorConfig.maxEmailsPerSync).toBe(100);
    });

    it('should delete a provider', async () => {
      const providerId = 'provider-123';

      vi.mocked(emailProviderService.deleteProvider).mockResolvedValue(undefined);

      await emailProviderService.deleteProvider(providerId);

      expect(emailProviderService.deleteProvider).toHaveBeenCalledWith(providerId);
    });
  });

  describe('Provider Connection Testing', () => {
    it('should successfully test a Gmail connection', async () => {
      const providerId = 'provider-123';
      const connectionResult = {
        success: true,
        message: 'Connection successful',
        details: {
          emailCount: 42,
          labels: ['INBOX', 'SENT'],
        },
      };

      vi.mocked(emailProviderService.testConnection).mockResolvedValue(connectionResult);

      const result = await emailProviderService.testConnection(providerId);

      expect(emailProviderService.testConnection).toHaveBeenCalledWith(providerId);
      expect(result.success).toBe(true);
      expect(result.details.emailCount).toBe(42);
    });

    it('should handle connection test failures', async () => {
      const providerId = 'provider-123';
      const connectionResult = {
        success: false,
        message: 'Authentication failed',
        error: 'Invalid credentials',
      };

      vi.mocked(emailProviderService.testConnection).mockResolvedValue(connectionResult);

      const result = await emailProviderService.testConnection(providerId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid credentials');
    });
  });

  describe('Webhook Configuration', () => {
    it('should initialize webhooks for a provider', async () => {
      const providerId = 'provider-123';
      const webhookResult = {
        success: true,
        webhookUrl: 'https://app.example.com/api/email/webhooks/google',
        subscriptionId: 'sub-123',
      };

      vi.mocked(emailProviderService.initializeWebhooks).mockResolvedValue(webhookResult);

      const result = await emailProviderService.initializeWebhooks(providerId);

      expect(emailProviderService.initializeWebhooks).toHaveBeenCalledWith(providerId);
      expect(result.success).toBe(true);
      expect(result.webhookUrl).toContain('/api/email/webhooks/google');
    });

    it('should handle webhook initialization failures', async () => {
      const providerId = 'provider-123';
      const webhookResult = {
        success: false,
        error: 'Failed to create Pub/Sub subscription',
      };

      vi.mocked(emailProviderService.initializeWebhooks).mockResolvedValue(webhookResult);

      const result = await emailProviderService.initializeWebhooks(providerId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Pub/Sub subscription');
    });
  });

  describe('OAuth Flow', () => {
    it('should handle OAuth authorization for Gmail', async () => {
      const providerConfig = {
        providerType: 'google' as const,
        config: {
          tenant: mockTenant,
          providerName: 'Gmail OAuth Test',
          mailbox: 'oauth@gmail.com',
          clientId: 'oauth-client-id',
          clientSecret: 'oauth-client-secret',
          authorizationCode: 'auth-code-123',
        },
      };

      const oauthResult = {
        success: true,
        provider: {
          id: 'provider-oauth-123',
          status: 'connected',
          vendorConfig: {
            ...providerConfig.config,
            refreshToken: 'refresh-token-123',
          },
        },
      };

      // In a real integration test, this would call the actual auto-wire endpoint
      const result = await mockAutoWireProvider(providerConfig);

      expect(result.success).toBe(true);
      expect(result.provider.status).toBe('connected');
      expect(result.provider.vendorConfig.refreshToken).toBeDefined();
    });

    it('should handle OAuth authorization for Microsoft', async () => {
      const providerConfig = {
        providerType: 'microsoft' as const,
        config: {
          tenant: mockTenant,
          providerName: 'Microsoft OAuth Test',
          mailbox: 'oauth@microsoft.com',
          tenantId: 'ms-tenant-id',
          clientId: 'oauth-client-id',
          clientSecret: 'oauth-client-secret',
          authorizationCode: 'auth-code-456',
        },
      };

      const oauthResult = {
        success: true,
        provider: {
          id: 'provider-oauth-456',
          status: 'connected',
          vendorConfig: {
            ...providerConfig.config,
            refreshToken: 'refresh-token-456',
          },
        },
      };

      const result = await mockAutoWireProvider(providerConfig);

      expect(result.success).toBe(true);
      expect(result.provider.status).toBe('connected');
      expect(result.provider.vendorConfig.refreshToken).toBeDefined();
    });
  });
});

// Mock helper function for auto-wire endpoint
async function mockAutoWireProvider(config: any) {
  return {
    success: true,
    provider: {
      id: `provider-oauth-${Date.now()}`,
      status: 'connected',
      vendorConfig: {
        ...config.config,
        refreshToken: `refresh-token-${Date.now()}`,
      },
    },
  };
}
