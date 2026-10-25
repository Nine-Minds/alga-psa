import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbState = vi.hoisted(() => ({
  tenantCompanyRow: undefined as Record<string, unknown> | undefined,
  tenantSettingsRow: undefined as Record<string, unknown> | undefined,
  tenantSettingsFails: false,
  tenantRow: undefined as Record<string, unknown> | undefined,
}));

const { getClientDocumentLogoUrlMock } = vi.hoisted(() => ({
  getClientDocumentLogoUrlMock: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn(() => ({
    table: vi.fn((table: string) => {
      const query: Record<string, unknown> = {};
      for (const method of ['select', 'where', 'whereNull', 'orderByRaw']) {
        query[method] = vi.fn(() => query);
      }
      query.first = vi.fn(() => {
        if (table === 'tenant_settings') {
          return dbState.tenantSettingsFails
            ? Promise.reject(new Error('tenant_settings unavailable'))
            : Promise.resolve(dbState.tenantSettingsRow);
        }
        if (table === 'tenants') {
          return Promise.resolve(dbState.tenantRow);
        }
        return Promise.resolve(dbState.tenantCompanyRow);
      });
      return query;
    }),
    tenantJoin: vi.fn(),
  })),
}));

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientDocumentLogoUrl: (...args: unknown[]) => getClientDocumentLogoUrlMock(...args),
}));

import { fetchTenantParty } from './tenantPartyAdapter';

const fakeKnex = { raw: vi.fn((value: string) => value) } as any;

const branding = (values: Record<string, unknown>) => ({ settings: { branding: values } });

describe('fetchTenantParty tenant logo precedence', () => {
  beforeEach(() => {
    dbState.tenantCompanyRow = { client_id: 'client-1', client_name: 'Managed Nerds' };
    dbState.tenantSettingsRow = undefined;
    dbState.tenantSettingsFails = false;
    dbState.tenantRow = undefined;
    getClientDocumentLogoUrlMock.mockReset();
    getClientDocumentLogoUrlMock.mockResolvedValue(null);
  });

  it('prefers the branding wide logo an admin configured under Settings -> Branding', async () => {
    dbState.tenantSettingsRow = branding({
      logoUrl: '/api/documents/view/11111111-1111-1111-1111-111111111111?t=1',
      logoWideUrl: '/api/documents/view/22222222-2222-2222-2222-222222222222?t=2',
      logoDarkUrl: '/api/documents/view/33333333-3333-3333-3333-333333333333',
      logoWideDarkUrl: '/api/documents/view/44444444-4444-4444-4444-444444444444',
    });
    getClientDocumentLogoUrlMock.mockResolvedValue('/api/documents/view/99999999-9999-9999-9999-999999999999');

    const party = await fetchTenantParty(fakeKnex, 'tenant-1');

    // Wide wordmark wins, the dark variants never land on white paper, and the
    // company-record lookup is not even attempted.
    expect(party?.logo_url).toBe('/api/documents/view/22222222-2222-2222-2222-222222222222?t=2');
    expect(getClientDocumentLogoUrlMock).not.toHaveBeenCalled();
  });

  it('falls back to the branding square logo when no wide wordmark is configured', async () => {
    dbState.tenantSettingsRow = branding({
      logoUrl: '/api/documents/view/11111111-1111-1111-1111-111111111111?t=1',
      // Deleting the wide slot writes an empty string rather than removing the key.
      logoWideUrl: '',
    });

    const party = await fetchTenantParty(fakeKnex, 'tenant-1');

    expect(party?.logo_url).toBe('/api/documents/view/11111111-1111-1111-1111-111111111111?t=1');
  });

  it('uses the own-company client record logo when branding has none', async () => {
    dbState.tenantSettingsRow = branding({ logoUrl: '', logoWideUrl: '' });
    getClientDocumentLogoUrlMock.mockResolvedValue('/api/documents/view/99999999-9999-9999-9999-999999999999');

    const party = await fetchTenantParty(fakeKnex, 'tenant-1');

    expect(getClientDocumentLogoUrlMock).toHaveBeenCalledWith('client-1', 'tenant-1');
    expect(party?.logo_url).toBe('/api/documents/view/99999999-9999-9999-9999-999999999999');
  });

  it('leaves the logo null when neither branding nor the company record has one', async () => {
    const party = await fetchTenantParty(fakeKnex, 'tenant-1');

    expect(party?.logo_url).toBeNull();
  });

  it('degrades to the company record logo when the settings read fails', async () => {
    dbState.tenantSettingsFails = true;
    getClientDocumentLogoUrlMock.mockResolvedValue('/api/documents/view/99999999-9999-9999-9999-999999999999');

    const party = await fetchTenantParty(fakeKnex, 'tenant-1');

    expect(party?.logo_url).toBe('/api/documents/view/99999999-9999-9999-9999-999999999999');
  });

  it('carries the branding logo on tenants that have no default company record', async () => {
    dbState.tenantCompanyRow = undefined;
    dbState.tenantRow = { client_name: 'Managed Nerds' };
    dbState.tenantSettingsRow = branding({
      logoUrl: '/api/documents/view/11111111-1111-1111-1111-111111111111?t=1',
    });

    const party = await fetchTenantParty(fakeKnex, 'tenant-1');

    expect(party).toMatchObject({
      name: 'Managed Nerds',
      logo_url: '/api/documents/view/11111111-1111-1111-1111-111111111111?t=1',
    });
  });

  it('still returns no party at all when the tenant has no name', async () => {
    dbState.tenantCompanyRow = undefined;
    dbState.tenantRow = { client_name: '  ' };
    dbState.tenantSettingsRow = branding({
      logoUrl: '/api/documents/view/11111111-1111-1111-1111-111111111111',
    });

    expect(await fetchTenantParty(fakeKnex, 'tenant-1')).toBeNull();
  });
});
