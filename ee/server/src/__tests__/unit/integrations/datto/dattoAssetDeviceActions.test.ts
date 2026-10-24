import { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let clientAvailable = true;
let device: any = { uid: 'dev-1', webRemoteUrl: 'https://concord.centrastage.net/csm/remote/dev-1' };
let getDeviceError: unknown = null;
let buildError: unknown = null;
let singleDeviceError: unknown = null;
let quickJobImpl: (deviceUid: string, args: any) => Promise<any>;
let settings: Record<string, any> = {};
let singleDeviceResult: { updated: boolean; assetId?: string } = { updated: true, assetId: 'asset_1' };
const quickJobCalls: Array<{ deviceUid: string; args: any }> = [];
const getDeviceCalls: string[] = [];
const singleDeviceCalls: any[] = [];

// Extension rows by table; system_info is what device sync stored.
let extensionRows: Record<string, any> = {};
const extensionLookups: Array<{ table: string; where: any }> = [];

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  tenantDb: (_knex: unknown, _tenant: string) => ({
    table: (table: string) => {
      let where: any;
      const qb: any = {
        where: (w: any) => { where = w; return qb; },
        first: async () => {
          extensionLookups.push({ table, where });
          return extensionRows[table];
        },
      };
      return qb;
    },
  }),
}));

const storedUrl = (webRemoteUrl: unknown, table = 'workstation_assets', asString = false) => {
  const info = { webRemoteUrl };
  extensionRows = { [table]: { system_info: asString ? JSON.stringify(info) : info } };
};

// This config aliases @enterprise to the CE stubs; route the seam to the EE adapter.
vi.mock('@enterprise/lib/integrations/datto/assetDeviceActions', () =>
  import('@ee/lib/integrations/datto/assetDeviceActions')
);

vi.mock('@ee/lib/integrations/datto/buildClient', () => ({
  getDattoIntegrationRow: vi.fn(async () => ({ settings })),
  buildDattoClientForTenant: vi.fn(async () => {
    if (buildError) throw buildError;
    return clientAvailable
      ? {
          getDevice: async (uid: string) => {
            getDeviceCalls.push(uid);
            if (getDeviceError) throw getDeviceError;
            return device;
          },
          createQuickJob: async (deviceUid: string, args: any) => {
            quickJobCalls.push({ deviceUid, args });
            return quickJobImpl(deviceUid, args);
          },
        }
      : null;
  }),
}));

vi.mock('@ee/lib/integrations/datto/syncSingleDevice', () => ({
  syncDattoSingleDeviceForTenant: vi.fn(async (args: any) => {
    singleDeviceCalls.push(args);
    if (singleDeviceError) throw singleDeviceError;
    return singleDeviceResult;
  }),
}));

const ref = { tenant: 'tenant_1', assetId: 'asset_1', deviceId: 'dev-1', assetName: 'pc-1' };

function httpError(status: number) {
  return new AxiosError(`HTTP ${status}`, String(status), undefined, undefined, {
    status,
    statusText: '',
    data: {},
    headers: {},
    config: {} as any,
  });
}

describe('Datto asset device actions', () => {
  beforeEach(() => {
    clientAvailable = true;
    device = { uid: 'dev-1', webRemoteUrl: 'https://concord.centrastage.net/csm/remote/dev-1' };
    getDeviceError = null;
    buildError = null;
    singleDeviceError = null;
    settings = { rebootComponentUid: 'comp-reboot' };
    singleDeviceResult = { updated: true, assetId: 'asset_1' };
    quickJobCalls.length = 0;
    getDeviceCalls.length = 0;
    singleDeviceCalls.length = 0;
    quickJobImpl = async () => ({ job: { uid: 'job-1' } });
    storedUrl('https://concord.centrastage.net/csm/remote/dev-1');
    extensionLookups.length = 0;
  });

  it('is what resolveRmmAssetDeviceActions returns for datto', async () => {
    const { resolveRmmAssetDeviceActions } = await import('@alga-psa/integrations/lib/rmm/assetDeviceActions');
    const { dattoRmmAssetDeviceActions } = await import('@ee/lib/integrations/datto/assetDeviceActions');
    expect(await resolveRmmAssetDeviceActions('datto')).toBe(dattoRmmAssetDeviceActions);
  });

  it('refresh runs the single-device sync and rejects unmapped assets', async () => {
    const { dattoRmmAssetDeviceActions } = await import('@ee/lib/integrations/datto/assetDeviceActions');
    await dattoRmmAssetDeviceActions.refresh(ref);
    expect(singleDeviceCalls).toEqual([
      { tenant: 'tenant_1', deviceUid: 'dev-1', clientOptions: { respectReconnectRequired: true } },
    ]);

    singleDeviceResult = { updated: false };
    await expect(dattoRmmAssetDeviceActions.refresh(ref)).rejects.toThrow('Asset is not mapped to a Datto RMM device');
  });

  it('offers Remote Desktop from the stored webRemoteUrl without calling Datto, and opens with a fresh read', async () => {
    const { dattoRmmAssetDeviceActions } = await import('@ee/lib/integrations/datto/assetDeviceActions');
    expect(await dattoRmmAssetDeviceActions.remoteControlTypes!(ref)).toEqual(['splashtop']);
    expect(getDeviceCalls).toEqual([]);
    expect(extensionLookups[0]).toEqual({ table: 'workstation_assets', where: { asset_id: 'asset_1' } });

    expect(await dattoRmmAssetDeviceActions.remoteControlUrl!(ref, 'splashtop')).toBe(
      'https://concord.centrastage.net/csm/remote/dev-1'
    );
    expect(getDeviceCalls).toEqual(['dev-1']);

    expect(await dattoRmmAssetDeviceActions.remoteControlUrl!(ref, 'shell')).toBeNull();

    device = { uid: 'dev-1', webRemoteUrl: '  ' };
    expect(await dattoRmmAssetDeviceActions.remoteControlUrl!(ref, 'splashtop')).toBeNull();
  });

  it('reads the stored URL from a server row or a JSON string, and offers nothing without one', async () => {
    const { dattoRmmAssetDeviceActions } = await import('@ee/lib/integrations/datto/assetDeviceActions');
    storedUrl('https://concord.centrastage.net/csm/remote/srv', 'server_assets', true);
    expect(await dattoRmmAssetDeviceActions.remoteControlTypes!(ref)).toEqual(['splashtop']);

    for (const missing of [null, '  ']) {
      storedUrl(missing);
      expect(await dattoRmmAssetDeviceActions.remoteControlTypes!(ref)).toEqual([]);
    }
    extensionRows = {};
    expect(await dattoRmmAssetDeviceActions.remoteControlTypes!(ref)).toEqual([]);
    expect(getDeviceCalls).toEqual([]);
  });

  it('reboot without a configured component throws an actionable error and calls nothing', async () => {
    settings = {};
    const { dattoRmmAssetDeviceActions } = await import('@ee/lib/integrations/datto/assetDeviceActions');
    await expect(dattoRmmAssetDeviceActions.reboot(ref)).rejects.toThrow(
      'Configure a reboot component in Datto RMM settings before rebooting from Alga.'
    );
    expect(quickJobCalls).toEqual([]);
  });

  it('reboot queues a quick job with the configured component', async () => {
    const { dattoRmmAssetDeviceActions } = await import('@ee/lib/integrations/datto/assetDeviceActions');
    await dattoRmmAssetDeviceActions.reboot(ref);
    expect(quickJobCalls).toEqual([
      { deviceUid: 'dev-1', args: { jobName: 'Alga PSA reboot — pc-1', componentUid: 'comp-reboot' } },
    ]);
  });

  it('runScript returns the quick job uid', async () => {
    const { dattoRmmAssetDeviceActions } = await import('@ee/lib/integrations/datto/assetDeviceActions');
    expect(await dattoRmmAssetDeviceActions.runScript!(ref, 'comp-x')).toEqual({ jobId: 'job-1' });
    expect(quickJobCalls).toEqual([{ deviceUid: 'dev-1', args: { jobName: 'Alga PSA — pc-1', componentUid: 'comp-x' } }]);
  });

  it('translates permission, not-found and offline failures without leaking details', async () => {
    const { dattoRmmAssetDeviceActions } = await import('@ee/lib/integrations/datto/assetDeviceActions');
    const { DattoRmmPermissionError } = await import('@ee/lib/integrations/datto/dattoApiClient');

    quickJobImpl = async () => {
      throw new DattoRmmPermissionError('Datto RMM denied access to /v2/device/dev-1/quickjob.', { status: 403, path: '/v2/device/dev-1/quickjob' });
    };
    await expect(dattoRmmAssetDeviceActions.runScript!(ref, 'comp-x')).rejects.toThrow(
      'The Datto RMM API user lacks permission for this action.'
    );
    await expect(dattoRmmAssetDeviceActions.reboot(ref)).rejects.toThrow(
      'The Datto RMM API user lacks permission for this action.'
    );

    quickJobImpl = async () => { throw httpError(404); };
    await expect(dattoRmmAssetDeviceActions.runScript!(ref, 'comp-x')).rejects.toThrow('Datto RMM no longer knows this device.');

    quickJobImpl = async () => { throw httpError(500); };
    const err = await dattoRmmAssetDeviceActions.runScript!(ref, 'comp-x').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Datto RMM could not run the job.');

    getDeviceError = httpError(404);
    await expect(dattoRmmAssetDeviceActions.remoteControlUrl!(ref, 'splashtop')).rejects.toThrow('Datto RMM no longer knows this device.');
  });

  it('surfaces the reconnect-required message from every action and hides Remote Desktop', async () => {
    const { dattoRmmAssetDeviceActions } = await import('@ee/lib/integrations/datto/assetDeviceActions');
    const { DattoRmmReconnectRequiredError } = await import('@ee/lib/integrations/datto/dattoApiClient');
    const message = 'Datto RMM needs to be reconnected: rejected.';
    buildError = new DattoRmmReconnectRequiredError('rejected.');

    await expect(dattoRmmAssetDeviceActions.reboot(ref)).rejects.toThrow(message);
    await expect(dattoRmmAssetDeviceActions.runScript!(ref, 'comp-x')).rejects.toThrow(message);
    await expect(dattoRmmAssetDeviceActions.remoteControlUrl!(ref, 'splashtop')).rejects.toThrow(message);
    singleDeviceError = buildError;
    await expect(dattoRmmAssetDeviceActions.refresh(ref)).rejects.toThrow(message);
    expect(await dattoRmmAssetDeviceActions.remoteControlTypes!(ref)).toEqual([]);

    const { buildDattoClientForTenant } = await import('@ee/lib/integrations/datto/buildClient');
    expect(buildDattoClientForTenant).toHaveBeenCalledWith('tenant_1', { respectReconnectRequired: true });
    expect(quickJobCalls).toEqual([]);
  });

  it('only returns a Web Remote URL that parses as https', async () => {
    const { dattoRmmAssetDeviceActions } = await import('@ee/lib/integrations/datto/assetDeviceActions');
    for (const bad of ['javascript:alert(1)', 'http://concord.centrastage.net/remote', 'data:text/html,hi', 'not a url', '//evil.example/x']) {
      device = { uid: 'dev-1', webRemoteUrl: bad };
      storedUrl(bad);
      expect(await dattoRmmAssetDeviceActions.remoteControlUrl!(ref, 'splashtop'), bad).toBeNull();
      expect(await dattoRmmAssetDeviceActions.remoteControlTypes!(ref), bad).toEqual([]);
    }
    device = { uid: 'dev-1', webRemoteUrl: ' https://concord.centrastage.net/csm/remote/dev-1 ' };
    expect(await dattoRmmAssetDeviceActions.remoteControlUrl!(ref, 'splashtop')).toBe(
      'https://concord.centrastage.net/csm/remote/dev-1'
    );
  });

  it('replaces unknown (non-Datto, non-axios) errors with a generic message and logs the original', async () => {
    const { dattoRmmAssetDeviceActions } = await import('@ee/lib/integrations/datto/assetDeviceActions');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const internal = 'integration row lookup failed: connect ECONNREFUSED 10.0.0.5:5432 (internal host detail)';

    quickJobImpl = async () => { throw new Error(internal); };
    for (const run of [
      () => dattoRmmAssetDeviceActions.runScript!(ref, 'comp-x'),
      () => dattoRmmAssetDeviceActions.reboot(ref),
    ]) {
      const err = await run().catch((e) => e);
      expect(err.message).toBe('Datto RMM could not run the job.');
      expect(err.name).toBe('DattoActionError');
    }

    // Failures before the Datto call (client build: knex / secret provider) are covered too.
    buildError = new Error(internal);
    for (const run of [
      () => dattoRmmAssetDeviceActions.runScript!(ref, 'comp-x'),
      () => dattoRmmAssetDeviceActions.reboot(ref),
    ]) {
      const err = await run().catch((e) => e);
      expect(err.message).toBe('Datto RMM could not run the job.');
    }
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('[DattoRMM]'), expect.objectContaining({ message: internal }));

    singleDeviceError = new Error(internal);
    const refreshErr = await dattoRmmAssetDeviceActions.refresh(ref).catch((e) => e);
    expect(refreshErr.message).toBe('Datto RMM could not refresh this device.');
    logged.mockRestore();
  });

  it('keeps operator-facing validation messages', async () => {
    settings = {};
    const { dattoRmmAssetDeviceActions } = await import('@ee/lib/integrations/datto/assetDeviceActions');
    const err = await dattoRmmAssetDeviceActions.reboot(ref).catch((e) => e);
    expect(err.name).toBe('DattoActionError');
    expect(err.message).toMatch(/Configure a reboot component/);
  });

  it('fails clearly when the integration is not configured', async () => {
    clientAvailable = false;
    const { dattoRmmAssetDeviceActions } = await import('@ee/lib/integrations/datto/assetDeviceActions');
    await expect(dattoRmmAssetDeviceActions.reboot(ref)).rejects.toThrow('No active Datto RMM integration found');
    await expect(dattoRmmAssetDeviceActions.runScript!(ref, 'c')).rejects.toThrow('No active Datto RMM integration found');
    expect(await dattoRmmAssetDeviceActions.remoteControlTypes!(ref)).toEqual([]);
  });
});
