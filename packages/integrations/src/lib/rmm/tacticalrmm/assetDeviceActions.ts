import axios from 'axios';

import type { RmmAssetDeviceActions, RmmAssetDeviceRef } from '../assetDeviceActions';
import { buildTacticalClientForTenant } from './buildClient';
import { syncTacticalSingleAgentForTenant } from './syncSingleAgent';

/**
 * Tactical answers command endpoints with HTTP 400 and a plain-string body
 * ("Unable to contact the agent") when the agent is unreachable. Surface that
 * text rather than the generic credentials hint the sync path uses for 400s.
 */
function tacticalCommandError(err: unknown, fallback: string): Error {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data;
    if (typeof body === 'string' && body.trim()) return new Error(body.trim());
    if (err.response?.status === 404) return new Error('Tactical RMM no longer knows this agent.');
  }
  return err instanceof Error && err.message ? err : new Error(fallback);
}

export const tacticalRmmAssetDeviceActions: RmmAssetDeviceActions = {
  async refresh(ref: RmmAssetDeviceRef): Promise<void> {
    const result = await syncTacticalSingleAgentForTenant({ tenant: ref.tenant, agentId: ref.deviceId });
    if (!result.updated) {
      throw new Error('Asset is not mapped to a Tactical RMM agent');
    }
  },

  async reboot(ref: RmmAssetDeviceRef): Promise<void> {
    const client = await buildTacticalClientForTenant(ref.tenant);
    if (!client) throw new Error('No active Tactical RMM integration found');
    try {
      await client.request({ method: 'POST', path: `/agents/${encodeURIComponent(ref.deviceId)}/reboot/` });
    } catch (err) {
      throw tacticalCommandError(err, 'Tactical RMM could not send the reboot command.');
    }
  },
};
