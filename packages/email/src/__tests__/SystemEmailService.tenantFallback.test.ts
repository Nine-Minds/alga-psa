import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenant = vi.hoisted(() => ({ configured: true, send: vi.fn() }));
vi.mock('../TenantEmailService', () => ({
  TenantEmailService: {
    getInstance: () => ({
      isConfigured: async () => tenant.configured,
      sendEmail: tenant.send,
    }),
  },
}));
vi.mock('../system/SystemEmailProviderFactory', () => ({
  SystemEmailProviderFactory: {
    getConfigFingerprint: () => 'fallback-test',
    createProvider: async () => ({ providerId: 'system-email-provider', providerType: 'smtp', sendEmail: async () => ({ success: true }) }),
  },
}));
vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn(), getConnection: vi.fn() }));

import { SystemEmailService } from '../system/SystemEmailService';

describe('SystemEmailService tenant appointment fallback', () => {
  const service = SystemEmailService.getInstance();
  const systemSend = vi.spyOn(service, 'sendEmail');

  beforeEach(() => {
    tenant.configured = true;
    tenant.send.mockReset();
    systemSend.mockReset();
    systemSend.mockResolvedValue({ success: true });
  });

  it('falls back when no tenant provider is configured', async () => {
    tenant.configured = false;
    const result = await service.sendTenantScopedEmail({ tenantId: 'tenant-1', to: 'a@example.test' }, 'scheduling');
    expect(result.success).toBe(true);
    expect(systemSend).toHaveBeenCalledOnce();
    expect(tenant.send).not.toHaveBeenCalled();
  });

  it('does not fall back after routed-sender validation fails', async () => {
    tenant.send.mockRejectedValue(new Error('routed sender validation failed'));
    await expect(service.sendTenantScopedEmail({ tenantId: 'tenant-1', to: 'a@example.test' }, 'scheduling')).rejects.toThrow(/routed sender validation/);
    expect(systemSend).not.toHaveBeenCalled();
  });

  it('returns provider failures without re-sending through the system provider', async () => {
    const failure = { success: false, error: 'provider rejected message' };
    tenant.send.mockResolvedValue(failure);
    await expect(service.sendTenantScopedEmail({ tenantId: 'tenant-1', to: 'a@example.test' }, 'scheduling')).resolves.toBe(failure);
    expect(systemSend).not.toHaveBeenCalled();
  });
});
