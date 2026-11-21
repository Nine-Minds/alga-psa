import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const hasPermission = vi.fn(async () => true);
  const asset = {
    asset_id: 'asset-1',
    client_id: 'client-2',
    asset_type: 'workstation',
    name: 'Workstation One',
    asset_tag: 'A-1',
    serial_number: null,
    rmm_device_id: '12345',
    rmm_provider: 'ninjaone',
    rmm_organization_id: null,
    attributes: {},
    client_name: 'Example Client',
  };
  const links = [
    { label: 'Name link', url_template: 'https://remote.example/{asset.name}' },
    { label: 'Serial link', url_template: 'https://remote.example/{asset.serial_number}' },
    { label: 'Ninja link', url_template: 'https://app.ninjarmm.com/#/deviceDashboard/{asset.rmm_device_id}/overview' },
    { label: 'Org link', url_template: 'https://remote.example/{asset.rmm_organization_id}' },
    { label: 'RMM link', url_template: 'https://remote.example/#/deviceDashboard/{asset.rmm_device_id}/details' },
  ];
  const events: string[] = [];
  const allowedClientIds = new Set(['client-2']);
  const context = { allowedClientIds };
  const assetQuery: any = {
    selectedColumns: [] as string[],
    select: vi.fn((...columns: Array<string[] | string>) => {
      assetQuery.selectedColumns = columns.flatMap((column) => Array.isArray(column) ? column : [column]);
      events.push(assetQuery.selectedColumns.includes('client_id') ? 'asset-identity' : 'asset-operational-fields');
      return assetQuery;
    }),
    where: vi.fn(() => assetQuery),
    first: vi.fn(async () => assetQuery.selectedColumns.includes('client_id')
      ? { asset_id: asset.asset_id, client_id: asset.client_id }
      : asset),
  };
  const linkQuery: any = {
    orderBy: vi.fn(() => linkQuery),
    insert: vi.fn(async () => undefined),
    then: (resolve: (value: typeof links) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(links).then(resolve, reject),
  };
  const db = {
    table: vi.fn((table: string) => {
      if (table === 'assets') return assetQuery;
      if (table === 'asset_remote_access_links') events.push('remote-access-templates');
      return linkQuery;
    }),
    tenantJoin: vi.fn(),
  };
  return { asset, links, assetQuery, linkQuery, db, hasPermission, events, context };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: mocks.hasPermission,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: { fn: { now: () => 'now' } } })),
  tenantDb: () => mocks.db,
  withTransaction: vi.fn(async (_knex: unknown, callback: (trx: unknown) => unknown) => callback(mocks.db)),
}));

vi.mock('../lib/assetReadAuthorization', () => ({
  createAssetReadContext: vi.fn(async () => mocks.context),
  // No seat authority applies to the users these tests act as.
  isAssetOperationClosed: vi.fn(() => false),
  isAssetOperationClosedForUser: vi.fn(async () => false),
  isAssetReadAllowed: vi.fn(async (_trx: unknown, _tenant: string, context: typeof mocks.context, record: { client_id: string }) =>
    context.allowedClientIds.has(record.client_id)),
}));

import { getRemoteAccessLinksForAsset, saveRemoteAccessLink, listRemoteAccessLinks } from './remoteAccessLinkActions';

describe('getRemoteAccessLinksForAsset', () => {
  beforeEach(() => {
    mocks.hasPermission.mockReset();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.events.length = 0;
    mocks.context.allowedClientIds.clear();
    mocks.context.allowedClientIds.add('client-2');
    mocks.asset.client_id = 'client-2';
    mocks.assetQuery.selectedColumns = [];
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

  it('accepts RMM placeholders when saving a template', async () => {
    const result = await saveRemoteAccessLink({
      label: 'Ninja',
      url_template: 'https://app.ninjarmm.com/#/deviceDashboard/{asset.rmm_device_id}/overview',
    });
    expect(result).toBeUndefined();
    expect(mocks.linkQuery.insert).toHaveBeenCalled();
    expect(await saveRemoteAccessLink({ label: 'P', url_template: 'https://remote.example/{asset.rmm_provider}/{asset.rmm_organization_id}' })).toBeUndefined();
  });

  it('still rejects unsupported asset placeholders', async () => {
    const result = await saveRemoteAccessLink({ label: 'Bad', url_template: 'https://remote.example/{asset.attributes}' });
    expect(result).toMatchObject({ actionError: 'Template contains an unsupported placeholder.' });
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
      { label: 'Ninja link', url: 'https://app.ninjarmm.com/#/deviceDashboard/12345/overview' },
      { label: 'Org link', url: null },
      { label: 'RMM link', url: 'https://remote.example/#/deviceDashboard/12345/details' },
    ]);
    expect(mocks.assetQuery.select).toHaveBeenCalledWith(expect.arrayContaining([
      'assets.rmm_device_id',
      'assets.rmm_provider',
      'assets.rmm_organization_id',
    ]));
  });

  it('returns no links for a selected-client restricted caller when the asset belongs to an excluded client', async () => {
    mocks.asset.client_id = 'client-excluded';

    await expect(getRemoteAccessLinksForAsset('asset-1')).resolves.toEqual([]);
    expect(mocks.events).toEqual(['asset-identity']);
  });

  it('returns the same empty response for denied and missing assets', async () => {
    mocks.asset.client_id = 'client-excluded';
    const denied = await getRemoteAccessLinksForAsset('asset-1');

    mocks.assetQuery.first.mockResolvedValueOnce(undefined);
    mocks.events.length = 0;
    const missing = await getRemoteAccessLinksForAsset('missing-asset');

    expect(denied).toEqual(missing);
    expect(denied).toEqual([]);
    expect(mocks.events).toEqual(['asset-identity']);
  });

  it('loads templates and renders links for an asset in an allowed client', async () => {
    await expect(getRemoteAccessLinksForAsset('asset-1')).resolves.toEqual([
      { label: 'Name link', url: 'https://remote.example/Workstation%20One' },
      { label: 'Serial link', url: null },
      { label: 'Ninja link', url: 'https://app.ninjarmm.com/#/deviceDashboard/12345/overview' },
      { label: 'Org link', url: null },
      { label: 'RMM link', url: 'https://remote.example/#/deviceDashboard/12345/details' },
    ]);
    expect(mocks.events).toEqual(['asset-identity', 'asset-operational-fields', 'remote-access-templates']);
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
