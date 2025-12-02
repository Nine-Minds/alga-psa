/**
 * Empty RMM Actions for Community Edition
 *
 * These functions provide stubs for RMM functionality that is only available
 * in the Enterprise Edition of Alga PSA.
 */

export interface RmmData {
  deviceId?: string;
  status?: string;
  lastSeen?: string;
  // Add other fields as needed
}

export interface RmmRebootResult {
  success: boolean;
  message: string;
}

export async function getAssetRmmData(_assetId: string): Promise<RmmData | null> {
  // RMM integration is an Enterprise Edition feature
  return null;
}

export async function refreshAssetRmmData(_assetId: string): Promise<RmmData | null> {
  // RMM integration is an Enterprise Edition feature
  return null;
}

export async function triggerRmmReboot(_assetId: string): Promise<RmmRebootResult> {
  // RMM integration is an Enterprise Edition feature
  return {
    success: false,
    message: 'RMM integration is only available in the Enterprise Edition',
  };
}
