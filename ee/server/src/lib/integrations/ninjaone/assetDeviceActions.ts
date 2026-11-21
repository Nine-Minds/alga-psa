import { normalizeRmmConnectionType } from '@alga-psa/integrations/lib/rmm/connectionTypes';
import type { RmmAssetDeviceActions, RmmAssetDeviceRef } from '@alga-psa/integrations/lib/rmm/assetDeviceActions';

import { createNinjaOneClient } from './ninjaOneClient';
import { syncSingleDeviceByAssetId } from './sync/syncEngine';

function numericDeviceId(ref: RmmAssetDeviceRef): number {
  const id = parseInt(ref.deviceId, 10);
  if (!Number.isFinite(id)) throw new Error('Asset is not managed by NinjaOne');
  return id;
}

export const ninjaOneAssetDeviceActions: RmmAssetDeviceActions = {
  async remoteControlTypes(ref) {
    const client = await createNinjaOneClient(ref.tenant);
    const links = await client.getDeviceLinks(numericDeviceId(ref));
    // The provider decides which types exist: normalize, drop blanks, de-duplicate, keep its order.
    const types = links
      .map((link: { type: string }) => normalizeRmmConnectionType(link.type))
      .filter((type: string) => type !== '');
    return [...new Set<string>(types)];
  },
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

  async remoteControlUrl(ref, connectionType) {
    const client = await createNinjaOneClient(ref.tenant);
    const id = numericDeviceId(ref);
    const links = await client.getDeviceLinks(id);
    return links.find((link: { type: string }) => normalizeRmmConnectionType(link.type) === normalizeRmmConnectionType(connectionType))?.url ?? null;
  },
};
