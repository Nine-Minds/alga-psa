/**
 * Per-provider device actions behind the asset detail page (refresh, reboot,
 * script, remote control). The Tactical implementation is Community Edition;
 * NinjaOne arrives through the guarded @enterprise import the same way the
 * device-sync and alert-polling jobs resolve their EE strategies.
 */

export type RmmRemoteConnectionType = 'splashtop' | 'teamviewer' | 'vnc' | 'rdp' | 'shell';

export interface RmmAssetDeviceRef {
  tenant: string;
  assetId: string;
  deviceId: string;
  assetName: string;
}

export interface RmmAssetDeviceActions {
  /** Pull the single device from the provider and refresh its asset rows. */
  refresh(ref: RmmAssetDeviceRef): Promise<void>;
  /** Send an immediate reboot. Throws with a user-readable message on failure. */
  reboot(ref: RmmAssetDeviceRef): Promise<void>;
  runScript?(ref: RmmAssetDeviceRef, scriptId: string): Promise<{ jobId?: string }>;
  remoteControlUrl?(ref: RmmAssetDeviceRef, connectionType: RmmRemoteConnectionType): Promise<string | null>;
}

export async function resolveRmmAssetDeviceActions(
  provider: string | null | undefined
): Promise<RmmAssetDeviceActions | null> {
  switch (provider) {
    case 'tacticalrmm': {
      const mod = await import('./tacticalrmm/assetDeviceActions');
      return mod.tacticalRmmAssetDeviceActions;
    }
    case 'ninjaone': {
      try {
        // Real adapter in EE builds; the CE stub exports undefined.
        const mod = await import('@enterprise/lib/integrations/ninjaone/assetDeviceActions');
        return (mod.ninjaOneAssetDeviceActions as RmmAssetDeviceActions | undefined) ?? null;
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}
