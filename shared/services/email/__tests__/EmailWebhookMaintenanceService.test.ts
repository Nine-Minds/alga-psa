import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EmailWebhookMaintenanceService } from '../EmailWebhookMaintenanceService';
import { getAdminConnection } from '../../../db/admin';
import { MicrosoftGraphAdapter } from '../providers/MicrosoftGraphAdapter';

// Mock dependencies
vi.mock('../../../db/admin');
vi.mock('../providers/MicrosoftGraphAdapter');
vi.mock('../../../core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

describe('EmailWebhookMaintenanceService', () => {
  let service: EmailWebhookMaintenanceService;
  let mockKnex: any;
  let mockQueryBuilder: any;

  const mockProvider = {
    id: 'provider-123',
    tenant: 'tenant-abc',
    provider_name: 'Test Provider',
    mailbox: 'test@example.com',
    is_active: true,
    status: 'connected',
    webhook_notification_url: 'https://api.example.com/webhook',
    webhook_subscription_id: 'sub-123',
    webhook_expires_at: new Date(Date.now() - 1000).toISOString(), // Expired
    client_id: 'client-123',
    client_secret: 'secret-123',
    tenant_id: 'tenant-123',
    access_token: 'token-123',
    refresh_token: 'refresh-123',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup Knex mock
    mockQueryBuilder = {
      join: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      whereNull: vi.fn().mockReturnThis(),
      orWhere: vi.fn().mockReturnThis(),
      orWhereNull: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue([mockProvider]), // Default return
      first: vi.fn().mockResolvedValue(null), // Default for health check
      update: vi.fn().mockResolvedValue(1),
      insert: vi.fn().mockResolvedValue([1]),
    };
    
    // Handle function callback in andWhere
    mockQueryBuilder.andWhere.mockImplementation((arg: any) => {
        if (typeof arg === 'function') {
            arg.call(mockQueryBuilder);
        }
        return mockQueryBuilder;
    });

    mockKnex = vi.fn(() => mockQueryBuilder);
    (getAdminConnection as any).mockResolvedValue(mockKnex);

    // Setup Adapter mock
    (MicrosoftGraphAdapter as any).mockImplementation(() => ({
      renewWebhookSubscription: vi.fn().mockResolvedValue(undefined),
      initializeWebhook: vi.fn().mockResolvedValue({ success: true }),
      getConfig: vi.fn().mockReturnValue({ webhook_expires_at: '2099-01-01T00:00:00.000Z' }),
    }));

    service = new EmailWebhookMaintenanceService();
  });

  it('should find candidates and renew expired subscription', async () => {
    const result = await service.renewMicrosoftWebhooks({ lookAheadMinutes: 60 });

    // Verify DB Query
    expect(mockKnex).toHaveBeenCalledWith('email_providers as ep');
    expect(mockQueryBuilder.select).toHaveBeenCalled();

    // Verify Adapter Usage
    expect(MicrosoftGraphAdapter).toHaveBeenCalled();
    const mockAdapterInstance = (MicrosoftGraphAdapter as any).mock.results[0].value;
    expect(mockAdapterInstance.renewWebhookSubscription).toHaveBeenCalled();

    // Verify Health Update
    expect(mockKnex).toHaveBeenCalledWith('email_provider_health');
    expect(mockQueryBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      provider_id: 'provider-123',
      subscription_status: 'healthy',
      last_renewal_result: 'success'
    }));

    // Verify Result
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      providerId: 'provider-123',
      success: true,
      action: 'renewed'
    });
  });

  it('should recreate subscription if renewal fails with 404', async () => {
    // Mock renewal failure
    const mockAdapterInstance = {
      renewWebhookSubscription: vi.fn().mockRejectedValue({ response: { status: 404 }, message: 'ResourceNotFound' }),
      initializeWebhook: vi.fn().mockResolvedValue({ success: true }),
      getConfig: vi.fn().mockReturnValue({ webhook_expires_at: '2099-01-01T00:00:00.000Z' }),
    };
    (MicrosoftGraphAdapter as any).mockImplementation(() => mockAdapterInstance);

    const result = await service.renewMicrosoftWebhooks();

    // Verify Renewal Attempt
    expect(mockAdapterInstance.renewWebhookSubscription).toHaveBeenCalled();

    // Verify Recreation Attempt
    expect(mockAdapterInstance.initializeWebhook).toHaveBeenCalledWith(mockProvider.webhook_notification_url);

    // Verify Result
    expect(result[0]).toMatchObject({
      providerId: 'provider-123',
      success: true,
      action: 'recreated'
    });
  });

  it('should handle unexpected errors gracefully', async () => {
    // Mock renewal failure with generic error
    const mockAdapterInstance = {
      renewWebhookSubscription: vi.fn().mockRejectedValue(new Error('Random API Error')),
    };
    (MicrosoftGraphAdapter as any).mockImplementation(() => mockAdapterInstance);

    const result = await service.renewMicrosoftWebhooks();

    // Verify Result
    expect(result[0]).toMatchObject({
      providerId: 'provider-123',
      success: false,
      action: 'failed',
      error: 'Random API Error'
    });

    // Verify Health Update (Failure)
    expect(mockQueryBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      provider_id: 'provider-123',
      subscription_status: 'error',
      last_renewal_result: 'failure'
    }));
  });
});