import type { RmmAssetDeviceActions, RmmAssetDeviceRef, RmmRemoteConnectionType } from '@alga-psa/integrations/lib/rmm/assetDeviceActions';

import { createNinjaOneClient } from './ninjaOneClient';
import { syncSingleDeviceByAssetId } from './sync/syncEngine';

const REMOTE_CONTROL_TYPES: RmmRemoteConnectionType[] = [
  'splashtop',
  'teamviewer',
  'vnc',
  'rdp',
  'shell',
];

function isRemoteControlType(value: string): value is RmmRemoteConnectionType {
  return REMOTE_CONTROL_TYPES.includes(value as RmmRemoteConnectionType);
}

function numericDeviceId(ref: RmmAssetDeviceRef): number {
  const id = parseInt(ref.deviceId, 10);
  if (!Number.isFinite(id)) throw new Error('Asset is not managed by NinjaOne');
  return id;
}

export const ninjaOneAssetDeviceActions: RmmAssetDeviceActions = {
  async remoteControlTypes(ref) {
    const client = await createNinjaOneClient(ref.tenant);
    const links = await client.getDeviceLinks(numericDeviceId(ref));
    return links.flatMap((link: { type: string }) => {
      const type = link.type.toLowerCase();
      return isRemoteControlType(type) ? [type] : [];
    });
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
    return links.find((link: { type: string }) => link.type.toLowerCase() === connectionType)?.url ?? null;
  },
};
