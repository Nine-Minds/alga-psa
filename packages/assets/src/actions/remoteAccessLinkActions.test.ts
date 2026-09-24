import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const asset = {
    asset_type: 'workstation',
    name: 'Workstation One',
    asset_tag: 'A-1',
    serial_number: null,
    attributes: {},
    client_name: 'Example Client',
  };
  const links = [
    { label: 'Name link', url_template: 'https://remote.example/{asset.name}' },
    { label: 'Serial link', url_template: 'https://remote.example/{asset.serial_number}' },
  ];
  const assetQuery: any = {
    select: vi.fn(() => assetQuery),
    where: vi.fn(() => assetQuery),
    first: vi.fn(async () => asset),
  };
  const linkQuery: any = {
    orderBy: vi.fn(() => linkQuery),
    then: (resolve: (value: typeof links) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(links).then(resolve, reject),
  };
  const db = {
    table: vi.fn((table: string) => table === 'assets' ? assetQuery : linkQuery),
    tenantJoin: vi.fn(),
  };
  return { asset, links, assetQuery, linkQuery, db };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  tenantDb: () => mocks.db,
}));

import { getRemoteAccessLinksForAsset } from './remoteAccessLinkActions';

describe('getRemoteAccessLinksForAsset', () => {
  beforeEach(() => {
    mocks.assetQuery.select.mockClear();
    mocks.assetQuery.where.mockClear();
    mocks.db.tenantJoin.mockClear();
    mocks.db.table.mockClear();
    mocks.linkQuery.orderBy.mockClear();
  });

  it('returns each template independently when an asset is missing a placeholder value', async () => {
    await expect(getRemoteAccessLinksForAsset('asset-1')).resolves.toEqual([
      { label: 'Name link', url: 'https://remote.example/Workstation%20One' },
      { label: 'Serial link', url: null },
    ]);
  });
});
