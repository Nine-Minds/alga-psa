'use server';

import type { RmmCachedData } from '@alga-psa/types';

const eeOnlyMessage = 'RMM features require Enterprise Edition';

export async function getAssetRmmData(_assetId: string): Promise<RmmCachedData | null> {
  return null;
}

export async function refreshAssetRmmData(_assetId: string): Promise<RmmCachedData | null> {
  return null;
}

export async function getAssetRemoteControlUrl(
  _assetId: string,
  _connectionType: 'splashtop' | 'teamviewer' | 'vnc' | 'rdp' | 'shell' = 'splashtop'
): Promise<string | null> {
  return null;
}

export async function triggerRmmReboot(
  _assetId: string
): Promise<{ success: boolean; message: string }> {
  return { success: false, message: eeOnlyMessage };
}

export async function triggerRmmScript(
  _assetId: string,
  _scriptId: string
): Promise<{ success: boolean; jobId?: string; message: string }> {
  return { success: false, message: eeOnlyMessage };
}

