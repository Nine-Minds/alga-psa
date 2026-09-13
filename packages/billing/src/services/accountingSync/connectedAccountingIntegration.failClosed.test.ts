import { describe, expect, it, vi, beforeEach } from 'vitest';

const settingsMock = vi.hoisted(() => vi.fn(async () => ({ defaultRealm: null })));
const defaultRealmMock = vi.hoisted(() => vi.fn(async () => null));
const qboCredsMock = vi.hoisted(() => vi.fn(async () => ({})));
const xeroConnectionsMock = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('./accountingSyncSettings', () => ({
  getAccountingSyncSettings: settingsMock,
  resolveDefaultRealm: defaultRealmMock
}));
vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getStoredQboCredentialsMap: qboCredsMock
}));
vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  getStoredXeroConnections: xeroConnectionsMock
}));

import { resolveConnectedAccountingIntegration } from './connectedAccountingIntegration';

beforeEach(() => {
  vi.clearAllMocks();
  settingsMock.mockResolvedValue({ defaultRealm: null });
  defaultRealmMock.mockResolvedValue(null);
  qboCredsMock.mockResolvedValue({});
  xeroConnectionsMock.mockResolvedValue({});
});

describe('resolveConnectedAccountingIntegration organisation selection', () => {
  it('fails closed when an explicitly requested Xero organisation is gone', async () => {
    xeroConnectionsMock.mockResolvedValue({ 'other-organisation': {} });

    const result = await resolveConnectedAccountingIntegration({} as any, 'tenant-a', {
      preferredAdapterType: 'xero',
      preferredTargetRealm: 'removed-organisation'
    });

    expect(result).toBeNull();
  });

  it('selects the second Xero organisation when explicitly requested', async () => {
    xeroConnectionsMock.mockResolvedValue({ 'org-1': {}, 'org-2': {} });

    const result = await resolveConnectedAccountingIntegration({} as any, 'tenant-a', {
      preferredAdapterType: 'xero',
      preferredTargetRealm: 'org-2'
    });

    expect(result).toEqual({ adapterType: 'xero', targetRealm: 'org-2' });
  });

  it('fails closed when an explicitly requested QBO realm is gone', async () => {
    qboCredsMock.mockResolvedValue({ 'realm-1': {} });

    const result = await resolveConnectedAccountingIntegration({} as any, 'tenant-a', {
      preferredAdapterType: 'quickbooks_online',
      preferredTargetRealm: 'realm-removed'
    });

    expect(result).toBeNull();
  });

  it('fails closed for an explicit organisation request with no owning provider', async () => {
    qboCredsMock.mockResolvedValue({ 'realm-1': {} });
    xeroConnectionsMock.mockResolvedValue({ 'org-1': {} });

    const result = await resolveConnectedAccountingIntegration({} as any, 'tenant-a', {
      preferredTargetRealm: 'gone'
    });

    expect(result).toBeNull();
  });

  it('selects Xero when only Xero is connected and both are requested by settings', async () => {
    qboCredsMock.mockResolvedValue({});
    xeroConnectionsMock.mockResolvedValue({ 'org-1': {}, 'org-2': {} });
    settingsMock.mockResolvedValue({ defaultRealm: 'org-2' } as any);

    const result = await resolveConnectedAccountingIntegration({} as any, 'tenant-a');
    expect(result).toEqual({ adapterType: 'xero', targetRealm: 'org-2' });
  });

  it('prefers QBO when both providers are connected and no organisation is selected', async () => {
    qboCredsMock.mockResolvedValue({ 'realm-1': {} });
    xeroConnectionsMock.mockResolvedValue({ 'org-1': {} });
    defaultRealmMock.mockResolvedValue('realm-1' as any);

    const result = await resolveConnectedAccountingIntegration({} as any, 'tenant-a');
    expect(result).toEqual({ adapterType: 'quickbooks_online', targetRealm: 'realm-1' });
  });
});
