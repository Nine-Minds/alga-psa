import type {
  NormalizedRmmAlertEvent,
  NormalizedRmmAlertSeverity,
  RmmActiveAlertFetcher,
} from '@alga-psa/shared/rmm/alerts';
import { createNinjaOneClient } from '../ninjaOneClient';
import {
  NinjaOneAlert,
  NinjaOneAlertSeverity,
  mapAlertSeverity,
} from '../../../../interfaces/ninjaone.interfaces';

/**
 * Lists currently-active NinjaOne alerts for reconciliation. Note the id
 * space: the alerts API returns condition uids, while webhooks carry activity
 * ids — the reconciliation core only trusts poller-ingested ids for staleness,
 * and per-device+condition dedup absorbs cross-source near-duplicates.
 */
export const ninjaOneAlertFetcher: RmmActiveAlertFetcher = {
  async fetchActiveAlerts({ tenantId, integrationId }) {
    const client = await createNinjaOneClient(tenantId);
    const alerts = await client.getAlerts();
    return alerts.map((alert) => mapAlertToEvent(alert, tenantId, integrationId));
  },
};

function mapAlertToEvent(alert: NinjaOneAlert, tenantId: string, integrationId: string): NormalizedRmmAlertEvent {
  const data = (alert.data ?? {}) as Record<string, unknown>;
  const statusCode = typeof data.statusCode === 'string' ? data.statusCode : null;
  return {
    tenantId,
    integrationId,
    provider: 'ninjaone',
    kind: 'triggered',
    externalAlertId: alert.uid,
    externalDeviceId: alert.deviceId != null ? String(alert.deviceId) : null,
    conditionIdentity: statusCode || alert.sourceConfigUid || alert.sourceName || alert.sourceType || null,
    activityType: 'CONDITION',
    alertClass: statusCode || alert.sourceName || null,
    sourceType: alert.sourceType ? String(alert.sourceType).toLowerCase() : 'condition',
    severity: mapAlertSeverity((alert.severity || 'NONE') as NinjaOneAlertSeverity) as NormalizedRmmAlertSeverity,
    message: alert.message ?? alert.sourceName ?? null,
    deviceName: alert.device?.displayName || alert.device?.systemName || null,
    externalOrganizationId:
      alert.device?.organizationId != null ? String(alert.device.organizationId) : null,
    occurredAt: alert.createTime || alert.activityTime || new Date().toISOString(),
    raw: alert as unknown as Record<string, unknown>,
  };
}
