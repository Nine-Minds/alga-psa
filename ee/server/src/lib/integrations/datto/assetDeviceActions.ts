import axios from 'axios';

import { createTenantKnex } from '@alga-psa/db';

import type { RmmAssetDeviceActions, RmmAssetDeviceRef, RmmRemoteConnectionType } from '@alga-psa/integrations/lib/rmm/assetDeviceActions';
import { buildDattoClientForTenant, getDattoIntegrationRow } from './buildClient';
import {
  DattoRmmAuthError,
  DattoRmmPermissionError,
  DattoRmmRateLimitError,
  DattoRmmReconnectRequiredError,
  type DattoRmmClient,
} from './dattoApiClient';
import type { DattoRmmIntegrationSettingsJson } from './shared';
import { syncDattoSingleDeviceForTenant } from './syncSingleDevice';

/**
 * An error whose message was written for the operator and is safe to show.
 * Anything else that reaches the asset actions (knex, secret provider, axios)
 * is replaced by a generic message and logged server-side; assetRmmActions
 * recognizes this class by name.
 */
export class DattoActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DattoActionError';
  }
}

const GENERIC_JOB_ERROR = 'Datto RMM could not run the job.';

/**
 * Turns failures into messages that are safe to show in the UI. Axios errors
 * and unknown errors are never passed through verbatim so request details (and
 * the bearer token in them) or internal messages cannot reach the user.
 */
function dattoActionError(err: unknown, fallback: string): DattoActionError {
  if (err instanceof DattoActionError) return err;
  if (err instanceof DattoRmmPermissionError) {
    return new DattoActionError('The Datto RMM API user lacks permission for this action.');
  }
  if (err instanceof DattoRmmAuthError) {
    return new DattoActionError('Datto RMM rejected the stored credentials. Reconnect the integration in settings.');
  }
  if (err instanceof DattoRmmRateLimitError || err instanceof DattoRmmReconnectRequiredError) {
    return new DattoActionError(err.message);
  }
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (status === 404) return new DattoActionError('Datto RMM no longer knows this device.');
    if (status === 409 || status === 400) {
      return new DattoActionError('Datto RMM could not run this action. The device may be offline.');
    }
    return new DattoActionError(fallback);
  }
  console.error('[DattoRMM] Unexpected error in asset device action:', err);
  return new DattoActionError(fallback);
}

// Interactive actions fail fast on a flagged integration rather than re-send known-bad credentials.
const ACTION_CLIENT_OPTIONS = { respectReconnectRequired: true } as const;

async function requireClient(tenant: string): Promise<DattoRmmClient> {
  const client = await buildDattoClientForTenant(tenant, ACTION_CLIENT_OPTIONS);
  if (!client) throw new DattoActionError('No active Datto RMM integration found');
  return client;
}

async function readRebootComponentUid(tenant: string): Promise<string | null> {
  const { knex } = await createTenantKnex();
  const row = await getDattoIntegrationRow(knex, tenant);
  const settings = (row?.settings ?? {}) as DattoRmmIntegrationSettingsJson;
  const uid = typeof settings.rebootComponentUid === 'string' ? settings.rebootComponentUid.trim() : '';
  return uid || null;
}

async function currentWebRemoteUrl(ref: RmmAssetDeviceRef, client: DattoRmmClient): Promise<string | null> {
  const device = await client.getDevice(ref.deviceId);
  const raw = typeof device?.webRemoteUrl === 'string' ? device.webRemoteUrl.trim() : '';
  if (!raw) return null;
  // The URL comes from the Datto API and is opened in the user's browser, so
  // only an https URL is ever handed on (no javascript:, data:, or plain http).
  try {
    return new URL(raw).protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}

export const dattoRmmAssetDeviceActions: RmmAssetDeviceActions = {
  async refresh(ref: RmmAssetDeviceRef): Promise<void> {
    let result;
    try {
      result = await syncDattoSingleDeviceForTenant({
        tenant: ref.tenant,
        deviceUid: ref.deviceId,
        clientOptions: ACTION_CLIENT_OPTIONS,
      });
    } catch (err) {
      throw dattoActionError(err, 'Datto RMM could not refresh this device.');
    }
    if (!result.updated) {
      throw new DattoActionError('Asset is not mapped to a Datto RMM device');
    }
  },

  // Datto's Web Remote is a browser session; it reuses the 'splashtop' slot the
  // asset UI labels "Remote Desktop", the same as Tactical's MeshCentral control.
  async remoteControlTypes(ref): Promise<RmmRemoteConnectionType[]> {
    try {
      const client = await buildDattoClientForTenant(ref.tenant, ACTION_CLIENT_OPTIONS);
      if (!client) return [];
      return (await currentWebRemoteUrl(ref, client)) ? ['splashtop'] : [];
    } catch {
      // The button simply does not render when the device cannot be read.
      return [];
    }
  },

  async remoteControlUrl(ref, connectionType) {
    if (connectionType !== 'splashtop') return null;
    try {
      const client = await requireClient(ref.tenant);
      // Fresh read: the stored URL can be stale after a device reinstall.
      return await currentWebRemoteUrl(ref, client);
    } catch (err) {
      throw dattoActionError(err, 'Datto RMM could not open a Web Remote session.');
    }
  },

  async reboot(ref: RmmAssetDeviceRef): Promise<void> {
    try {
      const componentUid = await readRebootComponentUid(ref.tenant);
      if (!componentUid) {
        throw new DattoActionError('Configure a reboot component in Datto RMM settings before rebooting from Alga.');
      }
      const client = await requireClient(ref.tenant);
      await client.createQuickJob(ref.deviceId, {
        jobName: `Alga PSA reboot — ${ref.assetName}`,
        componentUid,
      });
    } catch (err) {
      throw dattoActionError(err, GENERIC_JOB_ERROR);
    }
  },

  async runScript(ref: RmmAssetDeviceRef, componentUid: string): Promise<{ jobId?: string }> {
    try {
      const client = await requireClient(ref.tenant);
      const created = await client.createQuickJob(ref.deviceId, {
        jobName: `Alga PSA — ${ref.assetName}`,
        componentUid,
      });
      return { jobId: created?.job?.uid };
    } catch (err) {
      throw dattoActionError(err, GENERIC_JOB_ERROR);
    }
  },
};
