/**
 * Refreshes one Datto device on demand — the asset Refresh action and the
 * alert webhook both land here.
 *
 * Reads the device fresh, resolves the Alga client from its site's mapping and
 * writes through the same shared ingestion service as the bulk sync. The audit
 * is always fetched (unlike the bulk sync, which skips unchanged ones): someone
 * asked for this device specifically, and a single extra call is cheap.
 *
 * Auto-sync still governs creation: a device that already has an asset is
 * refreshed whenever its site maps to a client, but a new asset is created only
 * when the site is mapped to a client AND has auto-sync on, so a webhook for an
 * unmanaged site cannot create assets the admin did not ask for.
 */
import { createTenantKnex } from '@alga-psa/db';
import { ingestNormalizedRmmDeviceSnapshot } from '@alga-psa/shared/rmm/sharedAssetIngestionService';

import { tenantScopedTable } from './db';
import { buildDattoClientForTenant, getDattoIntegrationRow } from './buildClient';
import {
  carryOverDattoMappingMetadata,
  DattoSyncConfigError,
  dattoSnapshotSyncHash,
  fetchDattoHardware,
  loadExistingDeviceState,
} from './deviceSync';
import { DattoRmmPermissionError } from './dattoApiClient';
import { mapDattoDeviceToSnapshot, type DattoHardware } from './mappers';

export async function syncDattoSingleDeviceForTenant(args: {
  tenant: string;
  deviceUid: string;
  /** Retry budget for request handlers (the webhook) that must not sleep out a rate-limit window. */
  clientOptions?: { maxRetries?: number; maxRetryAfterMs?: number; respectReconnectRequired?: boolean };
}): Promise<{ updated: boolean; assetId?: string }> {
  const tenant = String(args.tenant || '').trim();
  const deviceUid = String(args.deviceUid || '').trim();
  if (!tenant || !deviceUid) return { updated: false };

  const { knex } = await createTenantKnex();
  const integration = await getDattoIntegrationRow(knex, tenant);
  if (!integration?.integration_id) return { updated: false };

  const client = await buildDattoClientForTenant(tenant, { allowInactive: true, ...args.clientOptions });
  if (!client) {
    throw new DattoSyncConfigError('Datto RMM credentials are not configured. Save and test the connection first.');
  }

  const device = await client.getDevice(deviceUid);
  const siteUid = String(device?.siteUid ?? '').trim();
  if (!device?.uid || !siteUid) return { updated: false };

  const mapping = await tenantScopedTable(knex, 'rmm_organization_mappings', tenant)
    .where({ integration_id: integration.integration_id, external_organization_id: siteUid })
    .whereNotNull('client_id')
    .first(['client_id', 'external_organization_name', 'auto_sync_assets', 'contact_assignment_mode']);
  if (!mapping?.client_id) return { updated: false };

  const prior = (await loadExistingDeviceState(knex, tenant, [device.uid])).get(device.uid);
  if (!prior?.assetId && mapping.auto_sync_assets !== true) return { updated: false };

  let hardware: DattoHardware | null = null;
  let auditDenied = false;
  if (device.deleted !== true) {
    try {
      hardware = await fetchDattoHardware(client, device);
    } catch (err) {
      // A restricted API user can read devices but not audits; the device
      // itself is still worth refreshing. Anything else is a real failure.
      if (!(err instanceof DattoRmmPermissionError)) throw err;
      auditDenied = true;
    }
  }

  const snapshot = mapDattoDeviceToSnapshot(device, {
    integrationId: String(integration.integration_id),
    siteUid,
    siteName: String(mapping.external_organization_name ?? '').trim() || null,
    hardware,
  });

  // Ingestion rewrites serial_number on update; do not blank one the asset has.
  if (!snapshot.serialNumber && prior?.serialNumber) snapshot.serialNumber = prior.serialNumber;
  // ...and replaces the mapping's metadata wholesale, so carry the software marker.
  carryOverDattoMappingMetadata(snapshot, prior);
  // No audit was read, so leave the marker alone and let a later sync retry it.
  if (auditDenied && snapshot.metadata) snapshot.metadata.lastAuditDate = prior?.storedLastAuditDate ?? null;

  // Same stamp the bulk sync writes, so its next incremental run skips this
  // device instead of re-ingesting what a webhook or Refresh just wrote.
  const clientId = String(mapping.client_id);
  const assignmentMode = mapping.contact_assignment_mode ? String(mapping.contact_assignment_mode) : null;
  if (snapshot.metadata) snapshot.metadata.syncHash = dattoSnapshotSyncHash(snapshot, { clientId, assignmentMode });

  const outcome = await ingestNormalizedRmmDeviceSnapshot({
    tenant,
    snapshot,
    resolvedClientId: clientId,
    knex,
  });

  if (outcome.action === 'failed') {
    throw new Error(outcome.error || 'Datto RMM device refresh failed.');
  }
  const updated = outcome.action === 'created' || outcome.action === 'updated';
  return { updated, assetId: outcome.assetId };
}
