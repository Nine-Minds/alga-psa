/**
 * Empty RMM Actions for Community Edition
 *
 * These functions provide stubs for RMM functionality that is only available
 * in the Enterprise Edition of Alga PSA.
 */

import type { RmmCachedData } from '@/interfaces/asset.interfaces';

export interface RmmRebootResult {
  success: boolean;
  message: string;
}

export async function getAssetRmmData(_assetId: string): Promise<RmmCachedData | null> {
  // RMM integration is an Enterprise Edition feature
  return null;
}

export async function refreshAssetRmmData(_assetId: string): Promise<RmmCachedData | null> {
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

export interface RmmScriptResult {
  success: boolean;
  message: string;
  jobId?: string;
}

export async function triggerRmmScript(_assetId: string, _scriptId: string): Promise<RmmScriptResult> {
  // RMM integration is an Enterprise Edition feature
  return {
    success: false,
    message: 'RMM integration is only available in the Enterprise Edition',
  };
}

export async function getAssetRemoteControlUrl(
  _assetId: string,
  _connectionType: 'splashtop' | 'teamviewer' | 'vnc' | 'rdp' | 'shell'
): Promise<string | null> {
  // RMM integration is an Enterprise Edition feature
  return null;
}
