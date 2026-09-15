import type { RmmAssetDeviceActions, RmmAssetDeviceRef, RmmRemoteConnectionType } from '@alga-psa/integrations/lib/rmm/assetDeviceActions';

import { createNinjaOneClient } from './ninjaOneClient';
import { syncSingleDeviceByAssetId } from './sync/syncEngine';

function numericDeviceId(ref: RmmAssetDeviceRef): number {
  const id = parseInt(ref.deviceId, 10);
  if (!Number.isFinite(id)) throw new Error('Asset is not managed by NinjaOne');
  return id;
}

export const ninjaOneAssetDeviceActions: RmmAssetDeviceActions = {
  async refresh(ref) {
    await syncSingleDeviceByAssetId(ref.tenant, ref.assetId);
  },

  async reboot(ref) {
    const client = await createNinjaOneClient(ref.tenant);
    await client.rebootDevice(numericDeviceId(ref));
  },

  async runScript(ref, scriptId) {
    const client = await createNinjaOneClient(ref.tenant);
    return client.runScript(numericDeviceId(ref), scriptId);
  },

  async remoteControlUrl(ref, connectionType: RmmRemoteConnectionType) {
    const client = await createNinjaOneClient(ref.tenant);
    const links = await client.getDeviceLinks(numericDeviceId(ref));
    const wanted = connectionType.toUpperCase();
    return links.find((l: { type: string }) => l.type === wanted)?.url ?? null;
  },
};
