/**
 * Mock-based unit tests for qboItemImportActions.
 *
 * Covers the guard chain for both server actions:
 *  - EE edition gate (assertEnterpriseEdition)
 *  - PostHog flag gate (`qbo-item-import`) — typed "not enabled" error, never silent success
 *  - RBAC permissions (billing_settings:read for preview; billing_settings:update + service:create for execute)
 *  - Realm resolution (connected company required)
 *  - Delegation to the import service on the happy path
 */

// EE edition must be set before any module reads it at import time.
process.env.EDITION = 'ee';

/* eslint-disable custom-rules/no-feature-to-feature-imports -- mocks the QuickBooks client the import actions bridge to */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks (hoisted) ─────────────────────────────────────────────────

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (input?: any) =>
    fn({ user_id: 'user-1' }, { tenant: 'tenant-test' }, input)
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true)
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
}));

vi.mock('@alga-psa/core/server', () => ({
  featureFlags: { isEnabled: vi.fn(async () => true) }
}));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getDefaultQboRealmId: vi.fn(async () => 'realm-1'),
  QboClientService: { create: vi.fn() }
}));

const previewForTenant = vi.fn();
const executeForTenant = vi.fn();

vi.mock('../services/accountingSync/qboItemImportService', () => ({
  previewQboItemImportForTenant: (...args: any[]) => previewForTenant(...args),
  executeQboItemImportForTenant: (...args: any[]) => executeForTenant(...args)
}));

import { previewQboItemImport, executeQboItemImport } from './qboItemImportActions';
import { hasPermission } from '@alga-psa/auth/rbac';
import { featureFlags } from '@alga-psa/core/server';
import { getDefaultQboRealmId } from '@alga-psa/integrations/lib/qbo/qboClientService';

const OPTIONS = {
  includeInactive: true,
  defaults: {
    serviceTypeId: 'st-1',
    serviceBillingMethod: 'hourly',
    productBillingMethod: 'fixed',
    unitOfMeasure: 'ea'
  }
};

describe('qboItemImportActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EDITION = 'ee';
    (hasPermission as any).mockResolvedValue(true);
    (featureFlags.isEnabled as any).mockResolvedValue(true);
    (getDefaultQboRealmId as any).mockResolvedValue('realm-1');
  });

  it('preview: returns the service preview on the happy path', async () => {
    previewForTenant.mockResolvedValue({ realm: 'realm-1', summary: { create: 1, update: 0, link: 0, skip: 0 }, rows: [] });
    const result = await previewQboItemImport(OPTIONS as any);
    expect(result.realm).toBe('realm-1');
    expect(previewForTenant).toHaveBeenCalledWith({ tenant: 'tenant-test', realm: 'realm-1', options: OPTIONS });
  });

  it('execute: returns the service result on the happy path', async () => {
    executeForTenant.mockResolvedValue({ created: 1, updated: 0, linked: 0, skipped: 0, errors: [] });
    const result = await executeQboItemImport(OPTIONS as any);
    expect(result.created).toBe(1);
    expect(executeForTenant).toHaveBeenCalledWith({
      tenant: 'tenant-test', realm: 'realm-1', options: OPTIONS, userId: 'user-1'
    });
  });

  it('throws the typed "not enabled" error when the flag is off (never silent success)', async () => {
    (featureFlags.isEnabled as any).mockResolvedValue(false);
    await expect(previewQboItemImport(OPTIONS as any)).rejects.toThrow(/not enabled/i);
    await expect(executeQboItemImport(OPTIONS as any)).rejects.toThrow(/not enabled/i);
    expect(previewForTenant).not.toHaveBeenCalled();
    expect(executeForTenant).not.toHaveBeenCalled();
  });

  it('scopes the flag check to the user and tenant', async () => {
    previewForTenant.mockResolvedValue({ realm: 'realm-1', summary: { create: 0, update: 0, link: 0, skip: 0 }, rows: [] });
    await previewQboItemImport(OPTIONS as any);
    expect(featureFlags.isEnabled).toHaveBeenCalledWith('qbo-item-import', { userId: 'user-1', tenantId: 'tenant-test' });
  });

  it('rejects non-EE editions before any other work', async () => {
    process.env.EDITION = 'community';
    await expect(previewQboItemImport(OPTIONS as any)).rejects.toThrow(/Enterprise Edition/i);
    await expect(executeQboItemImport(OPTIONS as any)).rejects.toThrow(/Enterprise Edition/i);
    expect(featureFlags.isEnabled).not.toHaveBeenCalled();
    expect(previewForTenant).not.toHaveBeenCalled();
  });

  it('preview requires billing_settings:read and nothing more', async () => {
    (hasPermission as any).mockImplementation(async (_u: any, resource: string, action: string) =>
      !(resource === 'billing_settings' && action === 'read')
    );
    await expect(previewQboItemImport(OPTIONS as any)).rejects.toThrow('Forbidden');
    expect(previewForTenant).not.toHaveBeenCalled();
  });

  it('execute requires both billing_settings:update and service:create', async () => {
    // Deny service:create only.
    (hasPermission as any).mockImplementation(async (_u: any, resource: string, action: string) =>
      !(resource === 'service' && action === 'create')
    );
    await expect(executeQboItemImport(OPTIONS as any)).rejects.toThrow('Forbidden');
    expect(executeForTenant).not.toHaveBeenCalled();

    // Deny billing_settings:update only.
    (hasPermission as any).mockImplementation(async (_u: any, resource: string, action: string) =>
      !(resource === 'billing_settings' && action === 'update')
    );
    await expect(executeQboItemImport(OPTIONS as any)).rejects.toThrow('Forbidden');
    expect(executeForTenant).not.toHaveBeenCalled();
  });

  it('fails cleanly when no QuickBooks company is connected', async () => {
    (getDefaultQboRealmId as any).mockResolvedValue(null);
    await expect(previewQboItemImport(OPTIONS as any)).rejects.toThrow(/No QuickBooks company is connected/i);
    await expect(executeQboItemImport(OPTIONS as any)).rejects.toThrow(/No QuickBooks company is connected/i);
    expect(previewForTenant).not.toHaveBeenCalled();
    expect(executeForTenant).not.toHaveBeenCalled();
  });

  it('wraps service failures in a friendly message (and logs, not leaks)', async () => {
    previewForTenant.mockRejectedValue(new Error('qbo api 429'));
    await expect(previewQboItemImport(OPTIONS as any)).rejects.toThrow(/Failed to load QuickBooks/i);
    executeForTenant.mockRejectedValue(new Error('db boom'));
    await expect(executeQboItemImport(OPTIONS as any)).rejects.toThrow(/import failed/i);
  });
});
