import type { RmmAlertOutboundAdapter } from '@alga-psa/shared/rmm/alerts';
import { createNinjaOneClient } from '../ninjaOneClient';

/**
 * Outbound surface for the shared alert pipeline: resets (acknowledges) an
 * alert in NinjaOne when its linked Alga ticket is closed.
 */
export const ninjaOneAlertOutboundAdapter: RmmAlertOutboundAdapter = {
  async resetAlert({ tenantId, externalAlertId }) {
    const client = await createNinjaOneClient(tenantId);
    await client.resetAlert(externalAlertId);
  },
};
