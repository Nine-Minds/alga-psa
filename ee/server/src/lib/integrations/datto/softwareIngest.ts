import axios from 'axios';

import { createTenantKnex } from '@alga-psa/db';

import { tenantScopedTable } from './db';
import { syncAssetSoftwareList } from './softwareInventory';
import { buildDattoClientForTenant } from './buildClient';
import { DattoRmmAuthError, DattoRmmPermissionError } from './dattoApiClient';
import { DATTO_RMM_PROVIDER } from './shared';
import type { DattoSyncResult } from './deviceSync';

/** Datto rate-limits per account, so software audits fan out only this wide. */
export const DATTO_SOFTWARE_INGEST_CONCURRENCY = 4;

/**
 * Runs `fn` over `items` with at most `limit` in flight. Failures are the
 * callback's business (it must not throw), so one device never stops the rest;
 * `shouldStop` lets it end the run early for failures that hit every device.
 */
async function forEachLimited<T>(
  items: T[],
  limit: number,
  shouldStop: () => boolean,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !shouldStop()) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function auditStamp(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function isNotFound(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 404;
}

/** Credential or security-level failures are account-wide: every further device would fail the same way. */
function isAccountWideFailure(err: unknown): boolean {
  return err instanceof DattoRmmAuthError || err instanceof DattoRmmPermissionError;
}

/** Datto only has a software audit for plain devices; printers, ESXi hosts and network devices 404 or 400. */
function hasSoftwareAudit(metadata: Record<string, unknown>): boolean {
  const deviceClass = String(metadata.deviceClass ?? 'device').trim().toLowerCase();
  return deviceClass === 'device' || deviceClass === '';
}

function describeFailure(err: unknown): string {
  if (err instanceof DattoRmmAuthError) return err.message;
  if (err instanceof DattoRmmPermissionError) {
    return 'The Datto RMM API user lacks permission to read software audits.';
  }
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    return status ? `Datto RMM returned HTTP ${status}.` : 'Datto RMM could not be reached.';
  }
  return err instanceof Error && err.message ? err.message : 'Unknown error';
}

/**
 * Pulls the installed-software audit for each mapped Datto device and writes
 * it to software_catalog / asset_software. Devices whose mapping shows the same
 * lastAuditDate we already ingested are skipped unless `force` is set, so
 * repeat runs only cost one call per device that was actually re-audited.
 * Device classes without a software audit are never called. A device Datto has
 * never audited has no software to read and no date to mark it done by, so a
 * bulk run would re-fetch it every time; it is only fetched when asked for by
 * uid or forced. An auth or permission failure stops the run: the rest would
 * fail identically.
 */
export async function runDattoRmmSoftwareIngest(args: {
  tenant: string;
  deviceUids?: string[];
  force?: boolean;
}): Promise<DattoSyncResult> {
  const { tenant } = args;
  const errors: string[] = [];

  try {
    const client = await buildDattoClientForTenant(tenant);
    if (!client) {
      return {
        success: false,
        items_processed: 0,
        items_created: 0,
        items_updated: 0,
        items_failed: 0,
        error: 'Datto RMM is not configured yet. Save settings first.',
      };
    }

    const { knex } = await createTenantKnex();

    let mappingQuery = tenantScopedTable(knex, 'tenant_external_entity_mappings', tenant).where({
      integration_type: DATTO_RMM_PROVIDER,
      alga_entity_type: 'asset',
    });
    if (args.deviceUids) {
      mappingQuery = mappingQuery.whereIn('external_entity_id', args.deviceUids.map(String));
    }
    const mappings = (await mappingQuery.select(['id', 'external_entity_id', 'alga_entity_id', 'metadata'])) as Array<
      Record<string, any>
    >;

    // Mappings outlive assets that were deleted in Alga; only ingest into assets that still exist.
    const assetIds = Array.from(new Set(mappings.map((m) => String(m.alga_entity_id))));
    const existingAssets = assetIds.length
      ? ((await tenantScopedTable(knex, 'assets', tenant).whereIn('asset_id', assetIds).select(['asset_id'])) as Array<
          Record<string, any>
        >)
      : [];
    const existingAssetIds = new Set(existingAssets.map((a) => String(a.asset_id)));

    const targets = mappings.filter((m) => {
      const metadata = (typeof m.metadata === 'object' && m.metadata) || {};
      if ((metadata as any).deleted === true) return false;
      if (!existingAssetIds.has(String(m.alga_entity_id))) return false;
      if (!hasSoftwareAudit(metadata as Record<string, unknown>)) return false;
      if (args.force) return true;
      const audited = auditStamp((metadata as any).lastAuditDate);
      if (!audited) return Boolean(args.deviceUids);
      return audited !== auditStamp((metadata as any).softwareIngestedAuditDate);
    });

    const syncTs = new Date();
    let processed = 0;
    let installed = 0;
    let updatedAssets = 0;
    let failed = 0;
    let handled = 0;
    let haltReason: string | null = null;

    await forEachLimited(targets, DATTO_SOFTWARE_INGEST_CONCURRENCY, () => haltReason !== null, async (mapping) => {
      const deviceUid = String(mapping.external_entity_id);
      handled += 1;
      try {
        const software = await client.listDeviceSoftware(deviceUid);
        const softwareList = software
          .map((s) => ({
            name: String(s?.name ?? '').trim(),
            version: s?.version ? String(s.version) : null,
          }))
          .filter((s) => s.name);

        const stats = await syncAssetSoftwareList(knex, tenant, String(mapping.alga_entity_id), softwareList, syncTs);
        processed += softwareList.length;
        installed += stats.installed;
        updatedAssets += 1;

        // Merge instead of overwriting so a concurrent device sync's metadata keys survive.
        const stamp = auditStamp(((mapping.metadata as any) ?? {}).lastAuditDate);
        if (stamp) {
          await tenantScopedTable(knex, 'tenant_external_entity_mappings', tenant)
            .where({ id: mapping.id })
            .update({
              metadata: knex.raw(`COALESCE(metadata, '{}'::jsonb) || ?::jsonb`, [
                JSON.stringify({ softwareIngestedAuditDate: stamp }),
              ]),
            });
        }
      } catch (err) {
        // A device deleted in Datto since the last device sync is not a failure.
        if (isNotFound(err)) return;
        failed += 1;
        if (isAccountWideFailure(err)) {
          // Concurrent workers can hit the same failure; report it once.
          haltReason ??= describeFailure(err);
          return;
        }
        const message = `Failed to ingest software for device ${deviceUid}: ${describeFailure(err)}`;
        if (errors.length < 20) errors.push(message);
      }
    });

    if (haltReason !== null) {
      const notChecked = targets.length - handled;
      return {
        success: false,
        items_processed: processed,
        items_created: installed,
        items_updated: updatedAssets,
        items_failed: failed + notChecked,
        error: `${haltReason} Stopped software ingest${notChecked ? `; ${notChecked} devices were not checked` : ''}.`,
        errors: errors.length ? errors : undefined,
      };
    }

    return {
      success: true,
      items_processed: processed,
      items_created: installed,
      items_updated: updatedAssets,
      items_failed: failed,
      errors: errors.length ? errors : undefined,
    };
  } catch (err) {
    return {
      success: false,
      items_processed: 0,
      items_created: 0,
      items_updated: 0,
      items_failed: 0,
      error: describeFailure(err),
    };
  }
}
