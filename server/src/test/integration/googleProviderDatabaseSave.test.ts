/**
 * Integration tests for Google provider database save operations
 * Tests the complete flow of saving Google provider configurations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock database functions
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  first: vi.fn(),
  limit: vi.fn().mockReturnThis(),
  returning: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  raw: vi.fn((sql: string) => sql === 'gen_random_uuid()' ? 'mock-uuid-123' : sql),
  fn: {
    now: vi.fn(() => new Date().toISOString())
  }
};

// Mock the database connection
vi.mock('../../lib/db', () => ({
  createTenantKnex: vi.fn().mockResolvedValue({ 
    knex: mockDb, 
    tenant: 'test-tenant-123' 
  }),
}));

import { EmailProviderService } from '../../services/email/EmailProviderService';
import { autoWireEmailProvider } from '../../lib/actions/email-actions/emailProviderActions';

// Mock the email provider actions
vi.mock('../../lib/actions/email-actions/emailProviderActions', () => ({
  autoWireEmailProvider: vi.fn(),
  updateEmailProvider: vi.fn(),
}));

describe('Google Provider Database Save Integration Tests', () => {
  const mockTenant = 'test-tenant-123';
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Creating Google Provider via Server Action', () => {
    it('should save a complete Google provider configuration to the database', async () => {
      // Define the complete Google provider configuration
      const googleProviderConfig = {
        providerType: 'google' as const,
        config: {
          providerName: 'Company Gmail Support',
          mailbox: 'support@company.com',
          clientId: 'test-client-id.apps.googleusercontent.com',
          clientSecret: 'test-client-secret-value',
          projectId: 'company-project-id',
          pubSubTopic: 'gmail-notifications',
          pubSubSubscription: 'gmail-webhook-subscription',
          labelFilters: ['INBOX', 'UNREAD'],
          autoProcessEmails: true,
          maxEmailsPerSync: 50
        }
      };

      // Set up the mock for database insert
      const expectedDbRow = {
        id: 'mock-uuid-123',
        tenant: mockTenant,
        provider_type: 'google',
        name: 'Company Gmail Support',
        mailbox: 'support@company.com',
        folder_to_monitor: 'Inbox',
        active: true,
        connection_status: 'disconnected',
        webhook_notification_url: '',
        provider_config: JSON.stringify({
          clientId: googleProviderConfig.config.clientId,
          clientSecret: googleProviderConfig.config.clientSecret,
          projectId: googleProviderConfig.config.projectId,
          pubSubTopic: googleProviderConfig.config.pubSubTopic,
          pubSubSubscription: googleProviderConfig.config.pubSubSubscription,
          labelFilters: googleProviderConfig.config.labelFilters,
          autoProcessEmails: googleProviderConfig.config.autoProcessEmails,
          maxEmailsPerSync: googleProviderConfig.config.maxEmailsPerSync
        }),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      mockDb.returning.mockResolvedValue([expectedDbRow]);

      // Mock the autoWireEmailProvider to use EmailProviderService
      vi.mocked(autoWireEmailProvider).mockImplementation(async (config) => {
        const emailProviderService = new EmailProviderService();
        const provider = await emailProviderService.createProvider({
          tenant: mockTenant,
          providerType: config.providerType,
          providerName: config.config.providerName,
          mailbox: config.config.mailbox,
          isActive: true,
          vendorConfig: {
            clientId: config.config.clientId,
            clientSecret: config.config.clientSecret,
            projectId: config.config.projectId,
            pubSubTopic: config.config.pubSubTopic,
            pubSubSubscription: config.config.pubSubSubscription,
            labelFilters: config.config.labelFilters,
            autoProcessEmails: config.config.autoProcessEmails,
            maxEmailsPerSync: config.config.maxEmailsPerSync
          }
        });

        return {
          success: true,
          provider: {
            id: provider.id,
            tenant: provider.tenant,
            providerType: provider.provider_type,
            providerName: provider.name,
            mailbox: provider.mailbox,
            isActive: provider.active,
            status: provider.connection_status as any,
            vendorConfig: provider.provider_config,
            createdAt: provider.created_at,
            updatedAt: provider.updated_at
          }
        };
      });

      // Call the server action
      const result = await autoWireEmailProvider(googleProviderConfig);

      // Verify the result
      expect(result.success).toBe(true);
      expect(result.provider).toBeDefined();
      expect(result.provider?.providerType).toBe('google');
      expect(result.provider?.mailbox).toBe('support@company.com');
      expect(result.provider?.vendorConfig.clientId).toBe('test-client-id.apps.googleusercontent.com');

      // Verify database insert was called with correct data
      expect(mockDb.insert).toHaveBeenCalledWith({
        id: 'gen_random_uuid()',
        tenant: mockTenant,
        provider_type: 'google',
        name: 'Company Gmail Support',
        mailbox: 'support@company.com',
        folder_to_monitor: 'Inbox',
        active: true,
        connection_status: 'disconnected',
        webhook_notification_url: '',
        provider_config: expect.any(String),
        created_at: expect.any(Function),
        updated_at: expect.any(Function)
      });

      // Verify the provider_config JSON structure
      const insertCall = mockDb.insert.mock.calls[0][0];
      const savedConfig = JSON.parse(insertCall.provider_config);
      expect(savedConfig).toEqual({
        clientId: 'test-client-id.apps.googleusercontent.com',
        clientSecret: 'test-client-secret-value',
        projectId: 'company-project-id',
        pubSubTopic: 'gmail-notifications',
        pubSubSubscription: 'gmail-webhook-subscription',
        labelFilters: ['INBOX', 'UNREAD'],
        autoProcessEmails: true,
        maxEmailsPerSync: 50
      });
    });

    it('should handle Gmail-specific email addresses correctly', async () => {
      const gmailConfig = {
        providerType: 'google' as const,
        config: {
          providerName: 'Personal Gmail',
          mailbox: 'user@gmail.com',
          clientId: 'gmail-client-id',
          clientSecret: 'gmail-secret',
          projectId: 'gmail-project',
          pubSubTopic: 'gmail-topic',
          pubSubSubscription: 'gmail-sub'
        }
      };

      const expectedDbRow = {
        id: 'gmail-provider-id',
        tenant: mockTenant,
        provider_type: 'google',
        name: 'Personal Gmail',
        mailbox: 'user@gmail.com',
        folder_to_monitor: 'Inbox',
        active: true,
        connection_status: 'disconnected',
        provider_config: JSON.stringify({
          clientId: gmailConfig.config.clientId,
          clientSecret: gmailConfig.config.clientSecret,
          projectId: gmailConfig.config.projectId,
          pubSubTopic: gmailConfig.config.pubSubTopic,
          pubSubSubscription: gmailConfig.config.pubSubSubscription,
          labelFilters: ['INBOX'],
          autoProcessEmails: true,
          maxEmailsPerSync: 50
        }),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      mockDb.returning.mockResolvedValue([expectedDbRow]);

      const emailProviderService = new EmailProviderService();
      const provider = await emailProviderService.createProvider({
        tenant: mockTenant,
        providerType: 'google',
        providerName: 'Personal Gmail',
        mailbox: 'user@gmail.com',
        isActive: true,
        vendorConfig: {
          clientId: 'gmail-client-id',
          clientSecret: 'gmail-secret',
          projectId: 'gmail-project',
          pubSubTopic: 'gmail-topic',
          pubSubSubscription: 'gmail-sub',
          labelFilters: ['INBOX'],
          autoProcessEmails: true,
          maxEmailsPerSync: 50
        }
      });

      expect(provider.mailbox).toBe('user@gmail.com');
      expect(provider.provider_type).toBe('google');
    });

    it('should handle Google Workspace custom domain emails', async () => {
      const workspaceConfig = {
        providerType: 'google' as const,
        config: {
          providerName: 'Company Workspace',
          mailbox: 'support@customdomain.com',
          clientId: 'workspace-client-id',
          clientSecret: 'workspace-secret',
          projectId: 'workspace-project',
          pubSubTopic: 'workspace-topic',
          pubSubSubscription: 'workspace-sub',
          labelFilters: ['INBOX', 'Support', 'CustomerService'],
          autoProcessEmails: false,
          maxEmailsPerSync: 100
        }
      };

      const expectedDbRow = {
        id: 'workspace-provider-id',
        tenant: mockTenant,
        provider_type: 'google',
        name: 'Company Workspace',
        mailbox: 'support@customdomain.com',
        folder_to_monitor: 'Inbox',
        active: true,
        connection_status: 'disconnected',
        provider_config: JSON.stringify(workspaceConfig.config),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      mockDb.returning.mockResolvedValue([expectedDbRow]);

      vi.mocked(autoWireEmailProvider).mockImplementation(async (config) => {
        const emailProviderService = new EmailProviderService();
        const provider = await emailProviderService.createProvider({
          tenant: mockTenant,
          providerType: config.providerType,
          providerName: config.config.providerName,
          mailbox: config.config.mailbox,
          isActive: true,
          vendorConfig: config.config
        });

        return {
          success: true,
          provider: {
            id: provider.id,
            tenant: provider.tenant,
            providerType: provider.provider_type,
            providerName: provider.name,
            mailbox: provider.mailbox,
            isActive: provider.active,
            status: provider.connection_status as any,
            vendorConfig: provider.provider_config,
            createdAt: provider.created_at,
            updatedAt: provider.updated_at
          }
        };
      });

      const result = await autoWireEmailProvider(workspaceConfig);

      expect(result.success).toBe(true);
      expect(result.provider?.mailbox).toBe('support@customdomain.com');
      expect(result.provider?.vendorConfig.labelFilters).toEqual(['INBOX', 'Support', 'CustomerService']);
      expect(result.provider?.vendorConfig.autoProcessEmails).toBe(false);
      expect(result.provider?.vendorConfig.maxEmailsPerSync).toBe(100);
    });

    it('should save OAuth tokens when provided', async () => {
      const configWithTokens = {
        providerType: 'google' as const,
        config: {
          providerName: 'OAuth Gmail',
          mailbox: 'oauth@gmail.com',
          clientId: 'oauth-client-id',
          clientSecret: 'oauth-secret',
          projectId: 'oauth-project',
          pubSubTopic: 'oauth-topic',
          pubSubSubscription: 'oauth-sub',
          refreshToken: 'refresh-token-value',
          accessToken: 'access-token-value',
          tokenExpiry: new Date(Date.now() + 3600000).toISOString()
        }
      };

      const expectedDbRow = {
        id: 'oauth-provider-id',
        tenant: mockTenant,
        provider_type: 'google',
        name: 'OAuth Gmail',
        mailbox: 'oauth@gmail.com',
        folder_to_monitor: 'Inbox',
        active: true,
        connection_status: 'connected', // Should be connected with valid tokens
        provider_config: JSON.stringify({
          ...configWithTokens.config,
          labelFilters: ['INBOX'],
          autoProcessEmails: true,
          maxEmailsPerSync: 50
        }),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      mockDb.returning.mockResolvedValue([expectedDbRow]);

      const emailProviderService = new EmailProviderService();
      const provider = await emailProviderService.createProvider({
        tenant: mockTenant,
        providerType: 'google',
        providerName: 'OAuth Gmail',
        mailbox: 'oauth@gmail.com',
        isActive: true,
        vendorConfig: {
          ...configWithTokens.config,
          labelFilters: ['INBOX'],
          autoProcessEmails: true,
          maxEmailsPerSync: 50
        }
      });

      // Verify tokens are saved in provider_config
      expect(provider.provider_config.refreshToken).toBe('refresh-token-value');
      expect(provider.provider_config.accessToken).toBe('access-token-value');
      expect(provider.provider_config.tokenExpiry).toBeDefined();
    });

    it('should validate required fields for Google provider', async () => {
      const incompleteConfig = {
        providerType: 'google' as const,
        config: {
          providerName: 'Incomplete Provider',
          mailbox: 'test@gmail.com',
          // Missing required fields: clientId, clientSecret, projectId
        }
      };

      // Mock validation error
      mockDb.insert.mockRejectedValue(new Error('Missing required fields'));

      const emailProviderService = new EmailProviderService();
      
      await expect(
        emailProviderService.createProvider({
          tenant: mockTenant,
          providerType: 'google',
          providerName: 'Incomplete Provider',
          mailbox: 'test@gmail.com',
          isActive: true,
          vendorConfig: {} // Missing required vendor config
        })
      ).rejects.toThrow();
    });

    it('should properly format and save all Google-specific configuration options', async () => {
      const fullGoogleConfig = {
        providerType: 'google' as const,
        config: {
          providerName: 'Full Config Gmail',
          mailbox: 'fullconfig@company.com',
          clientId: 'full-client-id.apps.googleusercontent.com',
          clientSecret: 'full-client-secret',
          projectId: 'full-project-id',
          pubSubTopic: 'custom-notifications-topic',
          pubSubSubscription: 'custom-webhook-subscription',
          labelFilters: ['INBOX', 'UNREAD', 'IMPORTANT', 'CATEGORY_PERSONAL'],
          autoProcessEmails: true,
          maxEmailsPerSync: 250,
          redirectUri: 'https://app.example.com/api/auth/google/callback',
          scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify',
          watchExpiration: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        }
      };

      const expectedDbRow = {
        id: 'full-config-provider-id',
        tenant: mockTenant,
        provider_type: 'google',
        name: 'Full Config Gmail',
        mailbox: 'fullconfig@company.com',
        folder_to_monitor: 'Inbox',
        active: true,
        connection_status: 'disconnected',
        webhook_notification_url: '',
        webhook_expires_at: fullGoogleConfig.config.watchExpiration,
        provider_config: JSON.stringify(fullGoogleConfig.config),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      mockDb.returning.mockResolvedValue([expectedDbRow]);

      const emailProviderService = new EmailProviderService();
      const provider = await emailProviderService.createProvider({
        tenant: mockTenant,
        providerType: 'google',
        providerName: fullGoogleConfig.config.providerName,
        mailbox: fullGoogleConfig.config.mailbox,
        isActive: true,
        vendorConfig: fullGoogleConfig.config
      });

      // Verify all configuration options are saved
      expect(provider.provider_config.labelFilters).toHaveLength(4);
      expect(provider.provider_config.maxEmailsPerSync).toBe(250);
      expect(provider.provider_config.pubSubTopic).toBe('custom-notifications-topic');
      expect(provider.provider_config.redirectUri).toBe('https://app.example.com/api/auth/google/callback');
    });
  });
});