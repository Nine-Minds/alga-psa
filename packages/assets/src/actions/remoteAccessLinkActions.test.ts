import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const hasPermission = vi.fn(async () => true);
  const asset = {
    asset_type: 'workstation',
    name: 'Workstation One',
    asset_tag: 'A-1',
    serial_number: null,
    rmm_device_id: '2456',
    attributes: {},
    client_name: 'Example Client',
  };
  const links = [
    { label: 'Name link', url_template: 'https://remote.example/{asset.name}' },
    { label: 'Serial link', url_template: 'https://remote.example/{asset.serial_number}' },
    { label: 'RMM link', url_template: 'https://remote.example/#/deviceDashboard/{asset.rmm_device_id}/details' },
  ];
  const assetQuery: any = {
    select: vi.fn(() => assetQuery),
    where: vi.fn(() => assetQuery),
    first: vi.fn(async () => asset),
  };
  const linkQuery: any = {
    orderBy: vi.fn(() => linkQuery),
    insert: vi.fn(async () => undefined),
    then: (resolve: (value: typeof links) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(links).then(resolve, reject),
  };
  const db = {
    table: vi.fn((table: string) => table === 'assets' ? assetQuery : linkQuery),
    tenantJoin: vi.fn(),
  };
  return { asset, links, assetQuery, linkQuery, db, hasPermission };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: mocks.hasPermission,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: { fn: { now: () => 'now' } } })),
  tenantDb: () => mocks.db,
}));

import { getRemoteAccessLinksForAsset, saveRemoteAccessLink, listRemoteAccessLinks } from './remoteAccessLinkActions';

describe('getRemoteAccessLinksForAsset', () => {
  beforeEach(() => {
    mocks.hasPermission.mockReset();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.assetQuery.select.mockClear();
    mocks.assetQuery.where.mockClear();
    mocks.db.tenantJoin.mockClear();
    mocks.db.table.mockClear();
    mocks.linkQuery.orderBy.mockClear();
  });

  it('returns an actionError for an invalid template without throwing', async () => {
    const result = await saveRemoteAccessLink({ label: 'Bad', url_template: 'ftp://remote.example' });
    expect(result).toMatchObject({ actionError: 'Template must begin with http:// or https:// and a literal host.' });
  });

  it('returns a permissionError when settings permission is missing', async () => {
    mocks.hasPermission.mockResolvedValue(false);
    const result = await listRemoteAccessLinks();
    expect(result).toMatchObject({ permissionError: 'Permission denied: Cannot manage asset settings.' });
  });

  it('returns each template independently when an asset is missing a placeholder value', async () => {
    await expect(getRemoteAccessLinksForAsset('asset-1')).resolves.toEqual([
      { label: 'Name link', url: 'https://remote.example/Workstation%20One' },
      { label: 'Serial link', url: null },
      { label: 'RMM link', url: 'https://remote.example/#/deviceDashboard/2456/details' },
    ]);
    expect(mocks.assetQuery.select).toHaveBeenCalledWith(expect.arrayContaining(['assets.rmm_device_id']));
  });

  it('accepts the RMM device id placeholder when saving a template', async () => {
    const result = await saveRemoteAccessLink({
      label: 'NinjaOne',
      url_template: 'https://example.rmmservice.com/#/deviceDashboard/{asset.rmm_device_id}/details',
    });
    expect(result).toBeUndefined();
    expect(mocks.linkQuery.insert).toHaveBeenCalled();
  });

  it('still rejects unsupported asset placeholders when saving a template', async () => {
    const result = await saveRemoteAccessLink({ label: 'Bad', url_template: 'https://remote.example/{asset.hostname}' });
    expect(result).toMatchObject({ actionError: 'Template contains an unsupported placeholder.' });
  });
});
