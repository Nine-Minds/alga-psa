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
 * object, so normalization cannot read an organization or device name off the
 * device. Those alerts are batch-enriched from the tenant's local device
 * mappings before the shared pipeline evaluates rules or creates tickets
 * (see enrichMissingDeviceDetails).
 */
export const ninjaOneAlertFetcher: RmmActiveAlertFetcher = {
  async fetchActiveAlerts({ tenantId, integrationId }) {
    const client = await createNinjaOneClient(tenantId);
    const alerts = await client.getAlerts();
    const events = alerts.map((alert) => mapAlertToEvent(alert, tenantId, integrationId));
    return enrichMissingDeviceDetails(events, tenantId);
  },
};

interface ExternalAssetMappingRow {
  external_entity_id?: string | null;
  external_realm_id?: string | null;
  asset_name?: string | null;
}

/**
 * Organization-scoped alert rules need `externalOrganizationId`; tickets also
 * need the mapped asset name when the poll payload omits its embedded device.
 * Resolve both from each device's local mapping in one tenant-scoped lookup.
 *
 * Fail-closed rules:
 * - Only the `ninjaone` provider's `asset` mappings can supply a realm, so an
 *   identical device id under another provider (or another tenant, via the
 *   tenantDb facade) can never leak an organization into this event.
 * - Organization ids are backfilled only when exactly one distinct non-empty
 *   realm is mapped. Missing, null, or blank realms and ambiguous realms leave
 *   the organization unresolved. Names are backfilled only when exactly one
 *   distinct, non-empty asset name resolves; ambiguous or absent values stay
 *   unresolved.
 * - Provider-supplied organization ids and device names are never overwritten.
 * - `client_id` is never used to infer an organization: several external
 *   organizations can map onto one Alga client.
 *
 * Alerts keep their original order and every other normalized field.
 */
export async function enrichMissingDeviceDetails(
  events: NormalizedRmmAlertEvent[],
  tenantId: string
): Promise<NormalizedRmmAlertEvent[]> {
  const deviceIdsToEnrich = Array.from(
    new Set(
      events
        .filter((event) =>
          (event.externalOrganizationId == null || event.deviceName == null) &&
          event.externalDeviceId != null
        )
        .map((event) => event.externalDeviceId as string)
    )
  );
  if (deviceIdsToEnrich.length === 0) return events;

  const mappingDetailsByDeviceId = await loadMappedDeviceDetails(tenantId, deviceIdsToEnrich);

  return events.map((event) => {
    if (event.externalDeviceId == null) return event;
    const details = mappingDetailsByDeviceId.get(event.externalDeviceId);
    if (!details) return event;
    const realms = details.realms;
    const names = details.names;
    const externalOrganizationId = event.externalOrganizationId == null && realms.length === 1
      ? realms[0]
      : event.externalOrganizationId;
    const deviceName = event.deviceName == null && names.length === 1 ? names[0] : event.deviceName;
    if (externalOrganizationId === event.externalOrganizationId && deviceName === event.deviceName) return event;
    return { ...event, externalOrganizationId, deviceName };
  });
}

async function loadMappedDeviceDetails(
  tenantId: string,
  deviceIds: string[]
): Promise<Map<string, { realms: string[]; names: string[] }>> {
  const { knex } = await createTenantKnex(tenantId);
  const db = tenantDb(knex, tenantId);
  const rows = (await db.table('tenant_external_entity_mappings')
    .leftJoin('assets', function () {
      this.on('assets.asset_id', '=', 'tenant_external_entity_mappings.alga_entity_id')
        .andOn('assets.tenant', '=', 'tenant_external_entity_mappings.tenant');
    })
    .where({
      'tenant_external_entity_mappings.integration_type': 'ninjaone',
      'tenant_external_entity_mappings.alga_entity_type': 'asset',
    })
    .whereIn('tenant_external_entity_mappings.external_entity_id', deviceIds)
    .select(
      'tenant_external_entity_mappings.external_entity_id',
      'tenant_external_entity_mappings.external_realm_id',
      'assets.name as asset_name'
    )) as ExternalAssetMappingRow[];

  const detailsByDeviceId = new Map<string, { realms: string[]; names: string[] }>();
  for (const row of rows) {
    const deviceId = row.external_entity_id != null ? String(row.external_entity_id) : null;
    const realm = row.external_realm_id != null ? String(row.external_realm_id).trim() : null;
    if (!deviceId) continue;
    const details = detailsByDeviceId.get(deviceId) ?? { realms: [], names: [] };
    if (realm) {
      const realms = details.realms;
      if (!realms.includes(realm)) realms.push(realm);
    }
    const name = row.asset_name != null ? String(row.asset_name).trim() : null;
    if (name && !details.names.includes(name)) details.names.push(name);
    detailsByDeviceId.set(deviceId, details);
  }
  return detailsByDeviceId;
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
