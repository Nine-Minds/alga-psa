/**
 * Hudu asset pull-sync core (EE-only, session-free).
 *
 * The sync logic behind huduAssetSyncActions.ts, lifted out of the
 * `'use server'` action file so the tenant-wide auto-sync (runHuduTenantSync)
 * can reuse it from a background job. Refreshes ONLY the synced fields (name,
 * serial_number) via the actor-injectable updateAssetRecord, plus the Hudu
 * attributes namespace (jsonb-merged). Archived/missing Hudu assets flag the
 * mapping `stale`; RMM-owned assets suppress name/serial diffs (F260).
 */

import logger from '@alga-psa/core/logger';
import { createTenantKnex } from 'server/src/lib/db';
import type { Knex } from 'knex';
import { updateAssetRecord } from '@alga-psa/assets/actions/assetActions';
import { fetchHuduCompanyAssets } from './huduDataCore';
import type { HuduErrorKind } from './huduClient';
import type { HuduAsset } from './contracts';
import {
  getHuduAssetMappingRows,
  setHuduAssetMappingStale,
  touchHuduAssetMappingsSynced,
} from './assetMapping';
import {
  buildHuduFieldsAttribute,
  huduFieldsChanged,
  writeHuduAssetAttributes,
} from './assetAttributes';

export type HuduAssetSyncResult =
  | { state: 'ok'; updated: number; unchanged: number; stale: number; rmmSkipped: number; syncedAt: string }
  | { state: 'unmapped' }
  | { state: 'error'; error: string; errorKind?: HuduErrorKind };

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function listMappedAssets(
  knex: Knex,
  tenant: string,
  assetIds: string[]
): Promise<
  Array<{
    asset_id: string;
    name: string;
    serial_number: string | null;
    attributes: Record<string, unknown> | null;
    rmm_provider: string | null;
  }>
> {
  if (assetIds.length === 0) {
    return [];
  }
  return knex('assets')
    .where({ tenant })
    .whereIn('asset_id', assetIds)
    .select('asset_id', 'name', 'serial_number', 'attributes', 'rmm_provider');
}

/** The only fields sync ever writes (FR7/F220: Hudu wins on these alone). */
function syncedFieldChanges(
  huduAsset: HuduAsset,
  algaAsset: { name: string; serial_number: string | null } | undefined
): { name?: string; serial_number?: string } {
  const changes: { name?: string; serial_number?: string } = {};
  if (!algaAsset) {
    return changes;
  }
  if (huduAsset.name && huduAsset.name !== algaAsset.name) {
    changes.name = huduAsset.name;
  }
  const huduSerial = huduAsset.primary_serial ?? null;
  if (huduSerial !== null && huduSerial !== (algaAsset.serial_number ?? null)) {
    changes.serial_number = huduSerial;
  }
  return changes;
}

/**
 * F219–F222: re-fetch the mapped company's Hudu assets (cache bypassed) and
 * walk the company's mapping rows: present+live ⇒ update changed synced fields
 * (via updateAssetRecord with the supplied actor) and clear `stale`;
 * archived/missing ⇒ set `stale` (never delete). All processed rows get
 * `last_synced_at`. Session-free — shared by the manual action and auto-sync.
 */
export async function syncHuduClientAssetsCore(
  tenant: string,
  actorUserId: string,
  clientId: string
): Promise<HuduAssetSyncResult> {
  try {
    const assetsResult = await fetchHuduCompanyAssets(tenant, clientId, { refresh: true });
    if (assetsResult.state === 'unmapped') {
      return { state: 'unmapped' };
    }
    if (assetsResult.state !== 'ok') {
      return {
        state: 'error',
        error: assetsResult.state === 'error' ? assetsResult.error : assetsResult.state,
        ...(assetsResult.state === 'error' && assetsResult.errorKind ? { errorKind: assetsResult.errorKind } : {}),
      };
    }

    const huduAssetById = new Map(assetsResult.items.map((asset) => [String(asset.id), asset]));
    const { knex } = await createTenantKnex(tenant);

    const mappingRows = await getHuduAssetMappingRows(knex, tenant, {
      huduCompanyId: assetsResult.huduCompanyId,
    });
    const algaAssets = await listMappedAssets(knex, tenant, mappingRows.map((m) => m.alga_entity_id));
    const algaAssetById = new Map(algaAssets.map((a) => [String(a.asset_id), a]));

    let updated = 0;
    let unchanged = 0;
    let stale = 0;
    let rmmSkipped = 0;
    const syncedAt = new Date().toISOString();

    for (const mapping of mappingRows) {
      const huduAsset = huduAssetById.get(mapping.external_entity_id);
      const wasStale = mapping.metadata?.stale === true;

      if (!huduAsset || huduAsset.archived === true) {
        stale += 1;
        if (!wasStale) {
          await setHuduAssetMappingStale(knex, tenant, { mappingId: mapping.id }, true);
        }
        continue;
      }

      const algaAsset = algaAssetById.get(mapping.alga_entity_id);
      const changes = syncedFieldChanges(huduAsset, algaAsset);
      let rowChanged = false;
      if (Object.keys(changes).length > 0) {
        // F260: an RMM owns device facts on its assets — Hudu never writes
        // name/serial there; the suppressed diff is surfaced as rmmSkipped.
        if (algaAsset?.rmm_provider) {
          rmmSkipped += 1;
        } else {
          await updateAssetRecord(knex, tenant, actorUserId, mapping.alga_entity_id, changes, {
            suppressRevalidate: true,
          });
          rowChanged = true;
        }
      }
      // F253: the Hudu namespace is always Hudu-won — refreshed on every mapped
      // live asset via jsonb merge (sibling attributes keys survive).
      if (algaAsset) {
        const nextFields = buildHuduFieldsAttribute(huduAsset.fields);
        if (huduFieldsChanged(algaAsset.attributes?.hudu_fields, nextFields)) {
          rowChanged = true;
        }
        await writeHuduAssetAttributes(knex, tenant, mapping.alga_entity_id, nextFields, syncedAt);
      }
      if (rowChanged) {
        updated += 1;
      } else {
        unchanged += 1;
      }
      if (wasStale) {
        await setHuduAssetMappingStale(knex, tenant, { mappingId: mapping.id }, false);
      }
    }

    await touchHuduAssetMappingsSynced(knex, tenant, mappingRows.map((m) => m.id), syncedAt);

    logger.info('[HuduAssetSyncCore] sync completed', {
      tenant,
      clientId,
      huduCompanyId: assetsResult.huduCompanyId,
      updated,
      unchanged,
      stale,
      rmmSkipped,
    });

    return { state: 'ok', updated, unchanged, stale, rmmSkipped, syncedAt };
  } catch (error) {
    logger.error('[HuduAssetSyncCore] syncHuduClientAssets failed', {
      tenant,
      clientId,
      error: toErrorMessage(error),
    });
    return { state: 'error', error: toErrorMessage(error) };
  }
}
