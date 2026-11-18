import type { RmmAlertOutboundAdapter } from '@alga-psa/shared/rmm/alerts';
import { createLevelIoClient } from '../levelApiClient';

/** Prefix of deterministic ids minted for Level automation alerts (see automationAlertId). */
export const LEVELIO_AUTOMATION_ALERT_PREFIX = 'automation:';

/**
 * Outbound surface for the shared alert pipeline: resolves a Level alert when
 * its linked Alga ticket is closed.
 *
 * Automation alerts (`automation:<deviceId>:<name>`) have no Level-side alert
 * object to resolve, so no remote call is made; the subscriber still marks the
 * local row resolved so the next firing reopens it. Native webhook alerts use
 * Level's `data.id` and are resolved via `POST /v2/alerts/:id/resolve`.
 * Failures throw so the subscriber stamps `outbound_reset_error`.
 */
export const levelIoAlertOutboundAdapter: RmmAlertOutboundAdapter = {
  async resetAlert({ tenantId, externalAlertId }) {
    if (externalAlertId.startsWith(LEVELIO_AUTOMATION_ALERT_PREFIX)) return;
    const client = await createLevelIoClient(tenantId);
    await client.resolveAlert(externalAlertId);
  },
};
