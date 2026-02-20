import { beforeEach, describe, expect, it, vi } from 'vitest';

const createDirectProviderAdapterMock = vi.fn();
const createCippProviderAdapterMock = vi.fn();

vi.mock('@ee/lib/integrations/entra/providers/direct/directProviderAdapter', () => ({
  createDirectProviderAdapter: createDirectProviderAdapterMock,
}));

vi.mock('@ee/lib/integrations/entra/providers/cipp/cippProviderAdapter', () => ({
  createCippProviderAdapter: createCippProviderAdapterMock,
}));

describe('getEntraProviderAdapter', () => {
  beforeEach(() => {
    vi.resetModules();
    createDirectProviderAdapterMock.mockReset();
    createCippProviderAdapterMock.mockReset();
  });

  it('T046: returns direct adapter when connection type is direct', async () => {
    const directAdapter = {
      connectionType: 'direct',
      listManagedTenants: vi.fn(),
      listUsersForTenant: vi.fn(),
    };
    createDirectProviderAdapterMock.mockReturnValue(directAdapter);

    const { getEntraProviderAdapter } = await import('@ee/lib/integrations/entra/providers');
    const adapter = getEntraProviderAdapter('direct');

    expect(createDirectProviderAdapterMock).toHaveBeenCalledTimes(1);
    expect(adapter).toBe(directAdapter);
  });

  it('T047: returns CIPP adapter when connection type is cipp', async () => {
    const cippAdapter = {
      connectionType: 'cipp',
      listManagedTenants: vi.fn(),
      listUsersForTenant: vi.fn(),
    };
    createCippProviderAdapterMock.mockReturnValue(cippAdapter);

    const { getEntraProviderAdapter } = await import('@ee/lib/integrations/entra/providers');
    const adapter = getEntraProviderAdapter('cipp');

    expect(createCippProviderAdapterMock).toHaveBeenCalledTimes(1);
    expect(adapter).toBe(cippAdapter);
  });
});
