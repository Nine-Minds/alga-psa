import type { NormalizedRmmAlertEvent } from '@alga-psa/shared/rmm/alerts';
import { createTenantKnex, tenantDb } from '@alga-psa/db';

interface ExternalAssetMappingRow {
  external_entity_id?: string | null;
  external_realm_id?: string | null;
  asset_name?: string | null;
}

/**
 * Organization-scoped alert rules need `externalOrganizationId`; tickets also
 * need the mapped asset name when the payload omits its embedded device.
 * Resolve both from tenant-local NinjaOne asset mappings.
 *
 * Values are filled only when exactly one distinct non-empty value resolves.
 * Missing or ambiguous values stay unresolved. Existing provider values are
 * preserved. The tenantDb facade, integration type, and asset type keep both
 * tenant and provider isolation intact.
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
    const externalOrganizationId = event.externalOrganizationId == null && details.realms.length === 1
      ? details.realms[0]
      : event.externalOrganizationId;
    const deviceName = event.deviceName == null && details.names.length === 1
      ? details.names[0]
      : event.deviceName;
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
      this.on(knex.raw('??::text = ??', [
        'assets.asset_id',
        'tenant_external_entity_mappings.alga_entity_id',
      ]))
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
    if (!deviceId) continue;
    const details = detailsByDeviceId.get(deviceId) ?? { realms: [], names: [] };
    const realm = row.external_realm_id != null ? String(row.external_realm_id).trim() : null;
    if (realm && !details.realms.includes(realm)) details.realms.push(realm);
    const name = row.asset_name != null ? String(row.asset_name).trim() : null;
    if (name && !details.names.includes(name)) details.names.push(name);
    detailsByDeviceId.set(deviceId, details);
  }
  return detailsByDeviceId;
}
