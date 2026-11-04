import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  AssetStatus,
  AssetStatusKind,
  CreateAssetStatusInput,
  UpdateAssetStatusInput,
} from '@alga-psa/types';
import {
  ASSET_STATUS_KINDS,
  BUILTIN_ASSET_STATUSES,
  BUILTIN_ASSET_STATUS_SLUGS,
  generateAssetStatusSlug,
  type AssetStatusRegistryError,
  type AssetStatusRegistryResult,
} from './assetStatusSchema';

// Re-export the client-safe helpers so server importers keep one entry point.
// Client components import from './assetStatusSchema' directly so the
// server-only `@alga-psa/db` barrel never reaches the browser bundle.
export * from './assetStatusSchema';

const ok = <T>(value: T): AssetStatusRegistryResult<T> => ({ ok: true, value });
const fail = <T>(error: AssetStatusRegistryError): AssetStatusRegistryResult<T> => ({ ok: false, error });

function toIsoOrEmpty(value: unknown): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function mapRow(row: any): AssetStatus {
  return {
    tenant: row.tenant,
    status_id: row.status_id,
    slug: row.slug,
    label: row.label,
    kind: row.kind as AssetStatusKind,
    is_builtin: Boolean(row.is_builtin),
    is_active: Boolean(row.is_active),
    display_order: Number(row.display_order ?? 0),
    created_at: toIsoOrEmpty(row.created_at),
    updated_at: toIsoOrEmpty(row.updated_at),
    ...(row.in_use_count === undefined ? {} : { in_use_count: Number(row.in_use_count) }),
  };
}

function statusTable(conn: Knex | Knex.Transaction, tenant: string): Knex.QueryBuilder<any, any> {
  return tenantDb(conn, tenant).table('asset_statuses') as Knex.QueryBuilder<any, any>;
}

/**
 * The tenant's statuses in display order. `includeArchived` adds rows that were
 * archived (is_active false) so a form can still show the status an asset is
 * already on.
 */
export async function listAssetStatusRows(
  conn: Knex | Knex.Transaction,
  tenant: string,
  options?: { includeArchived?: boolean; withUsage?: boolean }
): Promise<AssetStatus[]> {
  const query = statusTable(conn, tenant).select('*');
  if (!options?.includeArchived) query.where({ is_active: true });
  const rows = await query.orderBy('display_order', 'asc').orderBy('label', 'asc');

  if (!options?.withUsage) return rows.map(mapRow);

  const usage = await (tenantDb(conn, tenant).table('assets') as Knex.QueryBuilder<any, any>)
    .select('status')
    .count<{ status: string; count: string }[]>('asset_id as count')
    .groupBy('status');
  const counts = new Map(usage.map((row: any) => [row.status, Number(row.count)]));

  return rows.map((row: any) => mapRow({ ...row, in_use_count: counts.get(row.slug) ?? 0 }));
}

/**
 * Validates a status slug on an asset write (FR-B3). An archived status is
 * accepted only when it is the value the asset already carries, so a device
 * stuck on a retired status can still be edited without being forced onto a
 * new one.
 */
export async function validateAssetStatusSlug(
  conn: Knex | Knex.Transaction,
  tenant: string,
  slug: string,
  storedSlug?: string | null
): Promise<AssetStatusRegistryResult<string>> {
  const candidate = String(slug ?? '').trim();
  if (!candidate) return fail({ code: 'invalid_status', message: 'Status is required' });

  const row = await statusTable(conn, tenant).where({ slug: candidate }).first();
  if (!row) {
    // A tenant whose registry was never seeded (the standard_statuses seeding
    // gap reaches asset_statuses too) would otherwise have every asset write
    // refused. With an empty registry the builtin slugs are the honest answer,
    // the same fallback the status selects and the metrics use.
    const seeded = await statusTable(conn, tenant).first();
    if (!seeded && BUILTIN_ASSET_STATUS_SLUGS.includes(candidate)) return ok(candidate);
    return fail({ code: 'unknown_status', message: `Status "${candidate}" is not available`, slug: candidate });
  }
  if (!row.is_active && candidate !== storedSlug) {
    return fail({ code: 'archived_status', message: `Status "${row.label}" is archived`, slug: candidate });
  }
  return ok(candidate);
}

/** Slugs whose kind is `deployable` — what "deployed" means for metrics (FR-B5). */
export async function listDeployableStatusSlugs(
  conn: Knex | Knex.Transaction,
  tenant: string
): Promise<string[]> {
  const slugs: string[] = await statusTable(conn, tenant).where({ kind: 'deployable' }).pluck('slug');
  if (slugs.length > 0) return slugs;
  // A tenant whose registry has not been seeded would otherwise read as
  // "nothing is deployed"; the builtin deployable slugs are the honest default,
  // the same fallback the status selects use while the registry loads.
  return BUILTIN_ASSET_STATUSES.filter((status) => status.kind === 'deployable').map((status) => status.slug);
}

export async function createAssetStatusRow(
  conn: Knex | Knex.Transaction,
  tenant: string,
  input: CreateAssetStatusInput
): Promise<AssetStatusRegistryResult<AssetStatus>> {
  const label = String(input.label ?? '').trim();
  if (!label) return fail({ code: 'invalid_status', message: 'Label is required' });
  if (!ASSET_STATUS_KINDS.includes(input.kind)) {
    return fail({ code: 'invalid_kind', message: `Unknown status kind "${input.kind}"` });
  }

  const slug = generateAssetStatusSlug(label);
  if (!slug) return fail({ code: 'invalid_status', message: 'Label must contain at least one letter or digit' });

  const existing = await statusTable(conn, tenant).where({ slug }).first();
  if (existing?.is_active) {
    return fail({ code: 'duplicate_slug', message: `A status named "${label}" already exists`, slug });
  }
  if (existing) {
    // The slug is taken by an archived row. Re-creating the status by name is
    // exactly what "bring it back" looks like to an operator, and refusing it
    // left an archived status with no way back at all.
    const [restored] = await statusTable(conn, tenant)
      .where({ status_id: existing.status_id })
      .update({ label, kind: input.kind, is_active: true, updated_at: new Date().toISOString() })
      .returning('*');
    return ok(mapRow(restored));
  }

  const nextOrder = input.display_order ?? (await (async () => {
    const row = await statusTable(conn, tenant).max<{ max: number | null }>('display_order as max').first();
    return Number(row?.max ?? 0) + 1;
  })());

  const [row] = await statusTable(conn, tenant)
    .insert({
      tenant,
      slug,
      label,
      kind: input.kind,
      is_builtin: false,
      is_active: true,
      display_order: nextOrder,
    })
    .returning('*');

  return ok(mapRow(row));
}

export async function updateAssetStatusRow(
  conn: Knex | Knex.Transaction,
  tenant: string,
  statusId: string,
  input: UpdateAssetStatusInput
): Promise<AssetStatusRegistryResult<AssetStatus>> {
  const patch: Record<string, unknown> = {};
  if (input.label !== undefined) {
    const label = String(input.label).trim();
    if (!label) return fail({ code: 'invalid_status', message: 'Label is required' });
    patch.label = label;
  }
  if (input.kind !== undefined) {
    if (!ASSET_STATUS_KINDS.includes(input.kind)) {
      return fail({ code: 'invalid_kind', message: `Unknown status kind "${input.kind}"` });
    }
    patch.kind = input.kind;
  }
  if (input.display_order !== undefined) patch.display_order = input.display_order;

  if (Object.keys(patch).length === 0) {
    const current = await statusTable(conn, tenant).where({ status_id: statusId }).first();
    if (!current) return fail({ code: 'not_found', message: 'Status not found' });
    return ok(mapRow(current));
  }

  patch.updated_at = new Date().toISOString();
  const [row] = await statusTable(conn, tenant)
    .where({ status_id: statusId })
    .update(patch)
    .returning('*');

  if (!row) return fail({ code: 'not_found', message: 'Status not found' });
  return ok(mapRow(row));
}

/**
 * Writes the order the operator dragged the statuses into. The ids carry the
 * whole order, so `display_order` is rewritten as 0..n-1 rather than swapped —
 * a drag can move a row any distance, which pairwise swaps cannot express.
 */
export async function reorderAssetStatusRows(
  conn: Knex | Knex.Transaction,
  tenant: string,
  orderedIds: string[]
): Promise<AssetStatusRegistryResult<AssetStatus[]>> {
  const ids: string[] = [];
  for (const value of orderedIds ?? []) {
    const id = String(value ?? '').trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) {
    return fail({ code: 'invalid_status', message: 'No statuses to reorder' });
  }

  const known: string[] = await statusTable(conn, tenant).whereIn('status_id', ids).pluck('status_id');
  if (known.length !== ids.length) {
    // A stale list (someone else archived or added a status meanwhile) would
    // otherwise renumber the rows that do exist and silently drop the rest.
    return fail({ code: 'not_found', message: 'Status not found' });
  }

  const now = new Date().toISOString();
  for (const [index, statusId] of ids.entries()) {
    await statusTable(conn, tenant).where({ status_id: statusId }).update({ display_order: index, updated_at: now });
  }

  return ok(await listAssetStatusRows(conn, tenant, { includeArchived: true }));
}

/**
 * Archiving, not deleting (FR-B4): a status in use keeps every asset's history
 * honest, so the call is refused with the count of assets still on it.
 */
export async function archiveAssetStatusRow(
  conn: Knex | Knex.Transaction,
  tenant: string,
  statusId: string
): Promise<AssetStatusRegistryResult<{ status: AssetStatus; in_use_count: number }>> {
  const current = await statusTable(conn, tenant).where({ status_id: statusId }).first();
  if (!current) return fail({ code: 'not_found', message: 'Status not found' });

  const usage = await (tenantDb(conn, tenant).table('assets') as Knex.QueryBuilder<any, any>)
    .where({ status: current.slug })
    .count<{ count: string }>('asset_id as count')
    .first();
  const inUse = Number(usage?.count ?? 0);

  if (inUse > 0) {
    return fail({
      code: 'status_in_use',
      message: `${inUse} asset(s) still use "${current.label}"`,
      slug: current.slug,
      inUseCount: inUse,
    });
  }

  const [row] = await statusTable(conn, tenant)
    .where({ status_id: statusId })
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .returning('*');

  return ok({ status: mapRow(row), in_use_count: 0 });
}

/** Puts an archived status back in circulation (FR-B4 is archive, not delete). */
export async function restoreAssetStatusRow(
  conn: Knex | Knex.Transaction,
  tenant: string,
  statusId: string
): Promise<AssetStatusRegistryResult<AssetStatus>> {
  const [row] = await statusTable(conn, tenant)
    .where({ status_id: statusId })
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .returning('*');

  if (!row) return fail({ code: 'not_found', message: 'Status not found' });
  return ok(mapRow(row));
}

export { BUILTIN_ASSET_STATUSES };
