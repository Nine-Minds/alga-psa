import type {
  NormalizedRmmAlertEvent,
  NormalizedRmmAlertSeverity,
  RmmActiveAlertFetcher,
} from '@alga-psa/shared/rmm/alerts';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
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
 *
 * Real polled payloads commonly carry `deviceId` without an embedded `device`
 * object, so normalization cannot read an organization off the device. Those
 * alerts are batch-enriched from the tenant's local device mappings before the
 * shared pipeline evaluates rules (see enrichMissingOrganizationIds).
 */
export const ninjaOneAlertFetcher: RmmActiveAlertFetcher = {
  async fetchActiveAlerts({ tenantId, integrationId }) {
    const client = await createNinjaOneClient(tenantId);
    const alerts = await client.getAlerts();
    const events = alerts.map((alert) => mapAlertToEvent(alert, tenantId, integrationId));
    return enrichMissingOrganizationIds(events, tenantId);
  },
};

interface ExternalAssetMappingRow {
  external_entity_id?: string | null;
  external_realm_id?: string | null;
}

/**
 * Organization-scoped alert rules need `externalOrganizationId`; without it a
 * rule rejects an otherwise valid newly polled alert before any ticket work.
 * For every event still missing an organization after normalization, resolve
 * the mapped external realm for its device with one tenant-scoped lookup and
 * backfill the id.
 *
 * Fail-closed rules:
 * - Only the `ninjaone` provider's `asset` mappings can supply a realm, so an
 *   identical device id under another provider (or another tenant, via the
 *   tenantDb facade) can never leak an organization into this event.
 * - A device is enriched only when exactly one distinct non-empty realm is
 *   mapped; no mapping, a null realm, or several distinct realms leaves the
 *   event unresolved exactly as normalization produced it.
 * - An explicit provider-supplied organization id is never overwritten.
 * - `client_id` is never used to infer an organization: several external
 *   organizations can map onto one Alga client.
 *
 * Alerts keep their original order and every other normalized field.
 */
async function enrichMissingOrganizationIds(
  events: NormalizedRmmAlertEvent[],
  tenantId: string
): Promise<NormalizedRmmAlertEvent[]> {
  const deviceIdsToEnrich = Array.from(
    new Set(
      events
        .filter((event) => event.externalOrganizationId == null && event.externalDeviceId != null)
        .map((event) => event.externalDeviceId as string)
    )
  );
  if (deviceIdsToEnrich.length === 0) return events;

  const realmsByDeviceId = await loadMappedRealmsForDevices(tenantId, deviceIdsToEnrich);

  return events.map((event) => {
    if (event.externalOrganizationId != null || event.externalDeviceId == null) return event;
    const realms = realmsByDeviceId.get(event.externalDeviceId);
    if (!realms || realms.length !== 1) return event;
    return { ...event, externalOrganizationId: realms[0] };
  });
}

async function loadMappedRealmsForDevices(
  tenantId: string,
  deviceIds: string[]
): Promise<Map<string, string[]>> {
  const { knex } = await createTenantKnex(tenantId);
  const db = tenantDb(knex, tenantId);
  const rows = (await db.table('tenant_external_entity_mappings')
    .where({
      integration_type: 'ninjaone',
      alga_entity_type: 'asset',
    })
    .whereIn('external_entity_id', deviceIds)
    .select('external_entity_id', 'external_realm_id')) as ExternalAssetMappingRow[];

  const realmsByDeviceId = new Map<string, string[]>();
  for (const row of rows) {
    const deviceId = row.external_entity_id != null ? String(row.external_entity_id) : null;
    const realm = row.external_realm_id != null ? String(row.external_realm_id).trim() : null;
    if (!deviceId || !realm) continue;
    const realms = realmsByDeviceId.get(deviceId) ?? [];
    if (!realms.includes(realm)) realms.push(realm);
    realmsByDeviceId.set(deviceId, realms);
  }
  return realmsByDeviceId;
}

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
