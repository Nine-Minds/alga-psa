import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

let mockUser: any = { user_id: 'user-1', user_type: 'internal' };
let mockCtx: any = { tenant: 'tenant-1' };

const tenantSecrets = new Map<string, string>();
const appSecrets = new Map<string, string>();
const resetUpdates: Array<{ table: string; where: Record<string, unknown>; values: Record<string, unknown> }> = [];

const getTenantSecretMock = vi.fn(async (tenant: string, key: string) => {
  return tenantSecrets.get(`${tenant}:${key}`) || null;
});
const setTenantSecretMock = vi.fn(async (tenant: string, key: string, value: string) => {
  tenantSecrets.set(`${tenant}:${key}`, value);
});
const getAppSecretMock = vi.fn(async (key: string) => appSecrets.get(key) || null);
const hasPermissionMock = vi.fn(async (..._args: unknown[]) => true);
const getMicrosoftProviderReadinessMock = vi.fn(async (..._args: unknown[]) => ({
  ready: false,
  clientIdConfigured: false,
  clientSecretConfigured: false,
}));

const knexMock: any = (table: string) => ({
  where: (conditions: Record<string, unknown>) => ({
    update: async (values: Record<string, unknown>) => {
      resetUpdates.push({ table, where: conditions, values });
      return 1;
    },
  }),
});
knexMock.fn = {
  now: vi.fn(() => 'now()'),
};

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(mockUser, mockCtx, ...args),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth:
    (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(mockUser, mockCtx, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: getTenantSecretMock,
    setTenantSecret: setTenantSecretMock,
    getAppSecret: getAppSecretMock,
  }),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: knexMock }),
}));

vi.mock('./providerReadiness', () => ({
  getMicrosoftProviderReadiness: getMicrosoftProviderReadinessMock,
}));

import {
  getMicrosoftIntegrationStatus,
  resetMicrosoftProvidersToDisconnected,
  saveMicrosoftIntegrationSettings,
} from './microsoftActions';

describe('Microsoft integration actions', () => {
  beforeEach(() => {
    mockUser = { user_id: 'user-1', user_type: 'internal' };
    mockCtx = { tenant: 'tenant-1' };
    tenantSecrets.clear();
    appSecrets.clear();
    resetUpdates.length = 0;
    hasPermissionMock.mockResolvedValue(true);
    getMicrosoftProviderReadinessMock.mockResolvedValue({
      ready: true,
      clientIdConfigured: true,
      clientSecretConfigured: true,
    });
    getTenantSecretMock.mockClear();
    setTenantSecretMock.mockClear();
    getAppSecretMock.mockClear();
  });

  it('T002/T003/T010: status returns success with masked values and derived metadata', async () => {
    tenantSecrets.set('tenant-1:microsoft_client_id', 'client-id-123');
    tenantSecrets.set('tenant-1:microsoft_client_secret', 'super-secret-value');
    tenantSecrets.set('tenant-1:microsoft_tenant_id', 'tenant-guid');
    appSecrets.set('NEXT_PUBLIC_BASE_URL', 'https://example.com');

    const result = await getMicrosoftIntegrationStatus();

    expect(result.success).toBe(true);
    expect(result.config?.clientId).toBe('client-id-123');
    expect(result.config?.clientSecretMasked?.endsWith('alue')).toBe(true);
    expect(result.config?.clientSecretMasked).not.toContain('super-secret');
    expect(JSON.stringify(result)).not.toContain('super-secret-value');
    expect(result.redirectUris?.email).toBe('https://example.com/api/auth/microsoft/callback');
    expect(result.redirectUris?.calendar).toBe('https://example.com/api/auth/microsoft/calendar/callback');
    expect(result.redirectUris?.sso).toBe('https://example.com/api/auth/callback/azure-ad');
    expect(result.scopes?.email?.length).toBeGreaterThan(0);
    expect(result.scopes?.calendar?.length).toBeGreaterThan(0);
    expect(result.scopes?.sso).toContain('openid');
  });

  it('T004: save action rejects empty client ID', async () => {
    const result = await saveMicrosoftIntegrationSettings({
      clientId: '   ',
      clientSecret: 'secret',
    });
    expect(result).toEqual({
      success: false,
      error: 'Microsoft OAuth Client ID is required',
    });
  });

  it('T005: save action rejects empty client secret', async () => {
    const result = await saveMicrosoftIntegrationSettings({
      clientId: 'client-id',
      clientSecret: '   ',
    });
    expect(result).toEqual({
      success: false,
      error: 'Microsoft OAuth Client Secret is required',
    });
  });

  it('T006/T007/T008/T009: save action persists tenant secrets and defaults tenant ID to common', async () => {
    const result = await saveMicrosoftIntegrationSettings({
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });

    expect(result).toEqual({ success: true });
    expect(setTenantSecretMock).toHaveBeenCalledWith('tenant-1', 'microsoft_client_id', 'client-id');
    expect(setTenantSecretMock).toHaveBeenCalledWith('tenant-1', 'microsoft_client_secret', 'client-secret');
    expect(setTenantSecretMock).toHaveBeenCalledWith('tenant-1', 'microsoft_tenant_id', 'common');
  });

  it('T011/T012: reset action disconnects Microsoft email and calendar providers', async () => {
    const result = await resetMicrosoftProvidersToDisconnected();

    expect(result).toEqual({ success: true });
    expect(resetUpdates.some((u) => u.table === 'email_providers' && u.where.provider_type === 'microsoft')).toBe(true);
    expect(resetUpdates.some((u) => u.table === 'calendar_providers' && u.where.provider_type === 'microsoft')).toBe(true);
    expect(
      resetUpdates.some(
        (u) =>
          u.table === 'microsoft_email_provider_config' &&
          Object.prototype.hasOwnProperty.call(u.values, 'access_token') &&
          u.values.access_token === null
      )
    ).toBe(true);
    expect(
      resetUpdates.some(
        (u) =>
          u.table === 'microsoft_calendar_provider_config' &&
          Object.prototype.hasOwnProperty.call(u.values, 'delta_link') &&
          u.values.delta_link === null
      )
    ).toBe(true);
  });

  it('T013: Microsoft actions are exported from integrations action indexes', () => {
    const repoRoot = path.resolve(process.cwd(), '..');
    const integrationsIndex = fs.readFileSync(
      path.resolve(repoRoot, 'packages/integrations/src/actions/integrations/index.ts'),
      'utf8'
    );
    const rootActionsIndex = fs.readFileSync(
      path.resolve(repoRoot, 'packages/integrations/src/actions/index.ts'),
      'utf8'
    );

    expect(integrationsIndex).toContain("from './microsoftActions';");
    expect(integrationsIndex).toContain('getMicrosoftIntegrationStatus');
    expect(integrationsIndex).toContain('saveMicrosoftIntegrationSettings');
    expect(integrationsIndex).toContain('resetMicrosoftProvidersToDisconnected');
    expect(rootActionsIndex).toContain('getMicrosoftIntegrationStatus');
    expect(rootActionsIndex).toContain('saveMicrosoftIntegrationSettings');
    expect(rootActionsIndex).toContain('resetMicrosoftProvidersToDisconnected');
  });

  it('T014: non-admin user receives permission error on save', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const result = await saveMicrosoftIntegrationSettings({
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });

    expect(result).toEqual({ success: false, error: 'Forbidden' });
  });

  it('T015: client-portal users are denied on status/save/reset', async () => {
    mockUser = { user_id: 'client-1', user_type: 'client' };

    await expect(getMicrosoftIntegrationStatus()).resolves.toEqual({
      success: false,
      error: 'Forbidden',
    });
    await expect(
      saveMicrosoftIntegrationSettings({
        clientId: 'client-id',
        clientSecret: 'client-secret',
      })
    ).resolves.toEqual({
      success: false,
      error: 'Forbidden',
    });
    await expect(resetMicrosoftProvidersToDisconnected()).resolves.toEqual({
      success: false,
      error: 'Forbidden',
    });
  });
});
