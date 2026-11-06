import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { LabelLinkedAssetInfo } from '@alga-psa/types';

import { EXTENSION_TABLE_BY_ASSET_TYPE } from './assetTypeAttributes';

/**
 * The full identification block a full-page ticket worksheet prints for the ONE asset its label is
 * about. The 4 x 2 in tag keeps using the tag + serial suffix only. Read-only, and the caller must
 * already have run the asset read check for every base row handed in.
 *
 * Make/Model are first-class columns on `assets` (procurement migration). CPU/RAM/Storage/OS live on
 * the per-type extension tables; only workstation and server carry hardware specs, mobile carries its
 * model + OS, and printers only a model. 'unknown' and custom registry slugs have no extension table
 * and contribute only the base columns. Spec lines are pre-composed so templates never concatenate.
 */

export interface LinkedAssetInfoBase {
  asset_id: string;
  asset_type: string | null;
  name: string | null;
  manufacturer: string | null;
  model: string | null;
}

export type FormatCpuCoreCount = (count: number) => string;

const formatEnglishCpuCoreCount: FormatCpuCoreCount = (count) =>
  `${count} ${count === 1 ? 'core' : 'cores'}`;

/** Columns worth reading from each extension table for the worksheet block (everything else stays off the tag). */
const EXTENSION_SPEC_COLUMNS_BY_TABLE: Readonly<Record<string, readonly string[]>> = {
  workstation_assets: ['os_type', 'os_version', 'cpu_model', 'cpu_cores', 'ram_gb', 'storage_type', 'storage_capacity_gb'],
  server_assets: ['os_type', 'os_version', 'cpu_model', 'cpu_cores', 'ram_gb', 'storage_config'],
  mobile_device_assets: ['os_type', 'os_version', 'model'],
  printer_assets: ['model'],
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * One `server_assets.storage_config` entry is free-form JSON (the form stores whatever the operator
 * typed, `z.array(z.unknown())`; RMM syncs write flat `{ name, capacity_gb, free_gb, file_system }`).
 * Flatten strings as-is and objects by their printable scalar values, suffixing `*_gb` sizes with
 * "GB" and skipping `free*` usage fields (runtime state, not hardware spec). Nested values and
 * entries with nothing printable print nothing.
 */
export function summarizeServerStorage(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const parts: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      const s = entry.trim();
      if (s) parts.push(s);
      continue;
    }
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const s = Object.entries(entry as Record<string, unknown>)
        .filter(([key]) => !key.toLowerCase().startsWith('free'))
        .map(([key, v]) => {
          if (typeof v === 'number' && Number.isFinite(v)) return key.toLowerCase().endsWith('_gb') ? `${v} GB` : String(v);
          return typeof v === 'string' ? v.trim() : '';
        })
        .filter(Boolean)
        .join(' ');
      if (s) parts.push(s);
    }
  }
  return parts.length > 0 ? parts.join('; ') : null;
}

/** Pure composition of the printable lines from base columns + one extension row. Exported for tests. */
export function composeLinkedAssetInfo(
  base: LinkedAssetInfoBase,
  extension: Record<string, unknown> | null,
  formatCpuCoreCount: FormatCpuCoreCount = formatEnglishCpuCoreCount
): LabelLinkedAssetInfo {
  const osLine = [text(extension?.os_type), text(extension?.os_version)].filter((s): s is string => Boolean(s)).join(' ') || null;

  const cpuModel = text(extension?.cpu_model);
  const cores = wholeNumber(extension?.cpu_cores);
  const coreCount = cores != null ? formatCpuCoreCount(cores) : null;
  const cpuLine =
    cpuModel && coreCount ? `${cpuModel} / ${coreCount}` : cpuModel || coreCount;

  const ramGb = wholeNumber(extension?.ram_gb);
  const ramLine = ramGb != null ? `${ramGb} GB` : null;

  const storageType = text(extension?.storage_type);
  const capacityGb = wholeNumber(extension?.storage_capacity_gb);
  const storageLine =
    storageType || capacityGb != null
      ? [storageType, capacityGb != null ? `${capacityGb} GB` : null].filter((s): s is string => Boolean(s)).join(' ')
      : summarizeServerStorage(extension?.storage_config);

  return {
    assetId: base.asset_id,
    name: text(base.name),
    manufacturer: text(base.manufacturer),
    model: text(base.model) ?? text(extension?.model),
    osLine,
    cpuLine,
    ramLine,
    storageLine,
  };
}

/**
 * One composed info block per base row, keyed by asset_id. The extension tables are read once per
 * table (assets grouped by their type slug), never per asset. Rows whose type has no extension table
 * still get an info block from the base columns alone.
 */
export async function getLinkedAssetInfoForAssets(
  knex: Knex,
  tenant: string,
  bases: ReadonlyArray<LinkedAssetInfoBase>,
  formatCpuCoreCount?: FormatCpuCoreCount
): Promise<Map<string, LabelLinkedAssetInfo>> {
  const db = tenantDb(knex, tenant);

  const idsByTable = new Map<string, string[]>();
  for (const base of bases) {
    const table = base.asset_type ? EXTENSION_TABLE_BY_ASSET_TYPE[base.asset_type.toLowerCase()] : undefined;
    if (!table || !EXTENSION_SPEC_COLUMNS_BY_TABLE[table]) continue;
    const ids = idsByTable.get(table) ?? [];
    if (!ids.includes(base.asset_id)) ids.push(base.asset_id);
    idsByTable.set(table, ids);
  }

  const extensionById = new Map<string, Record<string, unknown>>();
  for (const [table, ids] of idsByTable) {
    const columns = EXTENSION_SPEC_COLUMNS_BY_TABLE[table];
    const rows = await db
      .table(table)
      .whereIn('asset_id', ids)
      .select<Array<Record<string, unknown>>>(...columns, 'asset_id');
    for (const row of rows) {
      const assetId = row.asset_id;
      if (typeof assetId === 'string') extensionById.set(assetId, row);
    }
  }

  return new Map(bases.map((base) => [
    base.asset_id,
    composeLinkedAssetInfo(base, extensionById.get(base.asset_id) ?? null, formatCpuCoreCount),
  ]));
}
