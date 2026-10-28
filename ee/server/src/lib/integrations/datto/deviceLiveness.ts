import { admitOperationalWrite } from '@alga-psa/db';
import type { Knex } from 'knex';

export interface DattoDeviceLivenessTouch {
  assetId: string;
  /** The asset's type; picks the extension table that carries uptime. */
  assetType: string | null;
  lastSeenAt?: string | null;
  uptimeSeconds?: number | null;
}

function parseIsoDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extensionTableFor(assetType: string | null): 'workstation_assets' | 'server_assets' | null {
  if (assetType === 'server') return 'server_assets';
  if (assetType === 'workstation') return 'workstation_assets';
  return null;
}

/**
 * Refreshes only the readings that move on every poll (last seen, uptime, last
 * sync time) for assets whose snapshot is otherwise unchanged, in one UPDATE per
 * table instead of a full ingest per device. Callers decide "unchanged"; this
 * writes nothing else, so it cannot clobber an admin-owned field.
 */
export async function touchDattoDeviceLiveness(
  knex: Knex | Knex.Transaction,
  tenant: string,
  rows: DattoDeviceLivenessTouch[]
): Promise<void> {
  if (!rows.length) return;

  const assetValues = rows.map(() => '(?::uuid, ?::timestamptz)').join(', ');
  const assetBindings = rows.flatMap((row) => [row.assetId, parseIsoDate(row.lastSeenAt)]);
  await admitOperationalWrite(knex, tenant, 'assets', 'raw:datto-device-liveness');
  await knex.raw(
    `UPDATE assets AS a
        SET last_seen_at = v.last_seen_at,
            last_rmm_sync_at = now()
       FROM (VALUES ${assetValues}) AS v(asset_id, last_seen_at)
      WHERE a.tenant = ?::uuid AND a.asset_id = v.asset_id`,
    [...assetBindings, tenant]
  );

  const byTable = new Map<string, DattoDeviceLivenessTouch[]>();
  for (const row of rows) {
    const table = extensionTableFor(row.assetType);
    if (!table) continue;
    const list = byTable.get(table) ?? [];
    list.push(row);
    byTable.set(table, list);
  }
  for (const [table, list] of byTable) {
    const values = list.map(() => '(?::uuid, ?::bigint)').join(', ');
    const bindings = list.flatMap((row) => [row.assetId, row.uptimeSeconds ?? null]);
    await knex.raw(
      `UPDATE ${table} AS e
          SET uptime_seconds = v.uptime_seconds
         FROM (VALUES ${values}) AS v(asset_id, uptime_seconds)
        WHERE e.tenant = ?::uuid AND e.asset_id = v.asset_id`,
      [...bindings, tenant]
    );
  }
}
