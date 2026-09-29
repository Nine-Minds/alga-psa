import { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let requestImpl: (args: any) => Promise<any>;
let requestCalls: Array<{ method: string; path: string }> = [];
let clientAvailable = true;
let singleAgentResult = { updated: true, assetId: 'asset_1' };
const singleAgentCalls: any[] = [];

vi.mock('@alga-psa/integrations/lib/rmm/tacticalrmm/buildClient', () => ({
  buildTacticalClientForTenant: vi.fn(async () =>
    clientAvailable
      ? {
          request: async (args: any) => {
            requestCalls.push({ method: args.method, path: args.path });
            return requestImpl(args);
          },
        }
      : null
  ),
}));

vi.mock('@alga-psa/integrations/lib/rmm/tacticalrmm/syncSingleAgent', () => ({
  syncTacticalSingleAgentForTenant: vi.fn(async (args: any) => {
    singleAgentCalls.push(args);
    return singleAgentResult;
  }),
}));

const ref = { tenant: 'tenant_1', assetId: 'asset_1', deviceId: 'AGENT-1', assetName: 'pc-1' };

describe('Tactical asset device actions', () => {
  beforeEach(() => {
    requestCalls = [];
    singleAgentCalls.length = 0;
    clientAvailable = true;
    singleAgentResult = { updated: true, assetId: 'asset_1' };
    requestImpl = async () => 'ok';
  });

  it('reboot posts to Tactical\'s per-agent reboot endpoint', async () => {
    const { tacticalRmmAssetDeviceActions } = await import('@alga-psa/integrations/lib/rmm/tacticalrmm/assetDeviceActions');
    await tacticalRmmAssetDeviceActions.reboot(ref);
    expect(requestCalls).toEqual([{ method: 'POST', path: '/agents/AGENT-1/reboot/' }]);
  });

  it('reboot surfaces Tactical\'s plain-text 400 body (agent unreachable)', async () => {
    requestImpl = async () => {
      throw new AxiosError('Request failed with status code 400', '400', undefined, undefined, {
        status: 400,
        statusText: 'Bad Request',
        data: 'Unable to contact the agent',
        headers: {},
        config: {} as any,
      });
    };
    const { tacticalRmmAssetDeviceActions } = await import('@alga-psa/integrations/lib/rmm/tacticalrmm/assetDeviceActions');
    await expect(tacticalRmmAssetDeviceActions.reboot(ref)).rejects.toThrow('Unable to contact the agent');
  });

  it('reboot fails clearly when the integration is not configured', async () => {
    clientAvailable = false;
    const { tacticalRmmAssetDeviceActions } = await import('@alga-psa/integrations/lib/rmm/tacticalrmm/assetDeviceActions');
    await expect(tacticalRmmAssetDeviceActions.reboot(ref)).rejects.toThrow('No active Tactical RMM integration found');
    expect(requestCalls).toEqual([]);
  });

  it('refresh runs the single-agent sync for the mapped agent and rejects unmapped assets', async () => {
    const { tacticalRmmAssetDeviceActions } = await import('@alga-psa/integrations/lib/rmm/tacticalrmm/assetDeviceActions');
    await tacticalRmmAssetDeviceActions.refresh(ref);
    expect(singleAgentCalls).toEqual([{ tenant: 'tenant_1', agentId: 'AGENT-1' }]);

    singleAgentResult = { updated: false, assetId: '' };
    await expect(tacticalRmmAssetDeviceActions.refresh(ref)).rejects.toThrow('Asset is not mapped to a Tactical RMM agent');
  });
});
