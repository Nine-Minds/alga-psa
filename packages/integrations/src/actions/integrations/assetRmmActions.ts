'use server';

/**
 * Asset-page RMM actions: cached vitals plus single-device refresh, reboot,
 * script and remote-control commands. Lives here rather than in the assets
 * package because feature packages may not import each other; the asset page
 * receives these through AssetCrossFeatureContext from the composition layer.
 * Per-provider work is resolved via assetDeviceActions (Tactical in CE, the
 * NinjaOne and Datto seams in EE).
 */

import { withAuth, hasPermission } from '@alga-psa/auth';
import type { RmmRemoteConnectionType } from '../../lib/rmm/assetDeviceActions';
import {
  loadAssetRmmData,
  providerLabel,
  requireAssetPermission,
  resolveDevice,
} from '../../lib/rmm/assetRmmApi';
import type { RmmCachedData } from '@alga-psa/types';

export interface RmmCommandResult {
  success: boolean;
  message: string;
  jobId?: string;
}

/**
 * Datto reboots, component runs and Web Remote sessions are raw remote command execution, so they
 * need the dedicated RMM permission on top of asset update. Other providers
 * keep their existing asset-update gate.
 */
const EXECUTE_COMMAND_DENIED_MESSAGE = 'Permission denied: Cannot execute RMM commands';

/**
 * Datto adapters throw DattoActionError for messages written for the operator;
 * anything else (knex, secret provider, axios) can carry internals, so it is
 * replaced by the generic text instead of being returned. Matched by name to
 * keep the Datto module out of this file's static imports.
 */
function dattoSafeMessage(error: unknown): string | null {
  const e = error as { name?: string; message?: string } | null;
  return e?.name === 'DattoActionError' && e.message ? e.message : null;
}

async function canExecuteCommands(user: unknown, provider: string | null | undefined): Promise<boolean> {
  if (provider !== 'datto') return true;
  return hasPermission(user as any, 'rmm', 'execute_command');
}

export const getAssetRmmData = withAuth(async (user, { tenant }, assetId: string): Promise<RmmCachedData | null> => {
  await requireAssetPermission(user, 'read');
  return (await loadAssetRmmData(tenant, assetId))?.data ?? null;
});

/** Pulls the device from its provider, then returns the refreshed cached data. */
export const refreshAssetRmmData = withAuth(async (user, { tenant }, assetId: string): Promise<RmmCachedData | null> => {
  await requireAssetPermission(user, 'update');
  const { ref, actions } = await resolveDevice(tenant, assetId);
  await actions.refresh(ref);
  return getAssetRmmData(assetId);
});

export const triggerRmmReboot = withAuth(async (user, { tenant }, assetId: string): Promise<RmmCommandResult> => {
  await requireAssetPermission(user, 'update');
  const { asset, ref, actions } = await resolveDevice(tenant, assetId);
  if (!(await canExecuteCommands(user, asset.rmm_provider))) {
    return { success: false, message: EXECUTE_COMMAND_DENIED_MESSAGE };
  }
  try {
    await actions.reboot(ref);
    return { success: true, message: `Reboot command sent to ${asset.name}` };
  } catch (error) {
    console.warn('RMM reboot command failed:', error);
    return {
      success: false,
      message: (asset.rmm_provider === 'datto'
        ? dattoSafeMessage(error)
        : error instanceof Error && error.message ? error.message : null)
        ?? 'Unable to send reboot command. Confirm the device is online and remote actions are enabled.',
    };
  }
});

export const triggerRmmScript = withAuth(async (user, { tenant }, assetId: string, scriptId: string): Promise<RmmCommandResult> => {
  await requireAssetPermission(user, 'update');
  const { asset, ref, actions } = await resolveDevice(tenant, assetId);
  if (!(await canExecuteCommands(user, asset.rmm_provider))) {
    return { success: false, message: EXECUTE_COMMAND_DENIED_MESSAGE };
  }
  if (!actions.runScript) {
    return { success: false, message: `Scripts are not supported for ${providerLabel(asset.rmm_provider)} assets` };
  }
  try {
    const result = await actions.runScript(ref, scriptId);
    return { success: true, jobId: result.jobId, message: `Script queued for execution on ${asset.name}` };
  } catch (error) {
    console.warn('RMM script execution failed:', error);
    return {
      success: false,
      message: (asset.rmm_provider === 'datto' ? dattoSafeMessage(error) : null)
        ?? 'Unable to run script. Confirm the device is online and the script is available.',
    };
  }
});

export const getAssetRemoteControlTypes = withAuth(async (
  user,
  { tenant },
  assetId: string
): Promise<RmmRemoteConnectionType[]> => {
  await requireAssetPermission(user, 'read');
  if (!await hasPermission(user as any, 'asset', 'update')) return [];
  try {
    const { asset, ref, actions } = await resolveDevice(tenant, assetId);
    // Listing is gated like opening, so the UI never offers a button that will be refused.
    if (!(await canExecuteCommands(user, asset.rmm_provider))) return [];
    if (!actions.remoteControlTypes) return [];
    return await actions.remoteControlTypes(ref);
  } catch (error) {
    console.warn('Remote control types not available:', error);
    return [];
  }
});

export const getAssetRemoteControlUrl = withAuth(async (
  user,
  { tenant },
  assetId: string,
  connectionType: RmmRemoteConnectionType = 'splashtop'
): Promise<string | null> => {
  await requireAssetPermission(user, 'update');
  const { asset, ref, actions } = await resolveDevice(tenant, assetId);
  // A Web Remote session is at least as powerful as a reboot.
  if (!(await canExecuteCommands(user, asset.rmm_provider))) throw new Error(EXECUTE_COMMAND_DENIED_MESSAGE);
  if (!actions.remoteControlUrl) return null;
  try {
    return await actions.remoteControlUrl(ref, connectionType);
  } catch (error) {
    console.warn('Remote control link not available:', error);
    return null;
  }
});
