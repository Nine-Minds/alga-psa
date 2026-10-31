import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('@alga-psa/core/rateLimit', () => ({
  TokenBucketRateLimiter: { getInstance: () => ({ isReady: () => false }) },
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(), publishEvent: vi.fn(), publishNonCatalogWorkflowEvent: vi.fn(),
  publishStoredWorkflowEvent: vi.fn(), publishBuiltWorkflowPayload: vi.fn(),
  publishNonCatalogEventByName: vi.fn(), publishUnregisteredEventType: vi.fn(),
}));
vi.mock('../features', () => ({ isEnterprise: false }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  getConnection: vi.fn(async () => ({})),
  isTenantSuspended: vi.fn(async () => false),
  tenantDb: vi.fn(),
}));
vi.mock('../providers/EmailProviderManager', () => ({
  EmailProviderManager: class {
    initialize = mocks.initialize;
    sendEmail = mocks.sendEmail;
    async getAvailableProviders() { return [{ providerId: 'p1' }]; }
  },
}));

import { TenantEmailService } from '../TenantEmailService';

const settings = {
  tenantId: 'tenant-1',
  emailProvider: 'smtp',
  providerConfigs: [{ providerId: 'p1', providerType: 'smtp', isEnabled: true, config: {} }],
} as any;

describe('TenantEmailService.testConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initialize.mockResolvedValue(undefined);
    vi.spyOn(TenantEmailService, 'getTenantEmailSettings').mockResolvedValue(settings);
  });

  it('takes only a tenant id and verifies without sending, even if a recipient is smuggled in', async () => {
    expect(TenantEmailService.testConnection.length).toBe(1);

    const result = await (TenantEmailService.testConnection as any)('tenant-1', 'victim@example.com');

    expect(result).toEqual({ success: true, message: 'SMTP connection verified.' });
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
