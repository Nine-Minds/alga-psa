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
    occurredAt: parseOccurredAt(alert.createTime ?? alert.activityTime),
    raw: alert as unknown as Record<string, unknown>,
  };
}

/**
 * NinjaOne's alerts API returns createTime/activityTime as epoch seconds in
 * practice (despite the ISO-string typing); passing the raw value reaches the
 * rmm_alerts timestamp column and Postgres rejects it with "date/time field
 * value out of range". Normalize epochs explicitly, tolerating ISO strings too.
 */
function parseOccurredAt(value: string | number | undefined | null): string {
  if (value != null) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 1_000_000_000) {
      const millis = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
      return new Date(millis).toISOString();
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}
