import { Knex } from 'knex';
import { tenantDb, withTransaction, admitOperationalWrite } from '@alga-psa/db';
import { IStockUnit, CreateAssetRequest } from '@alga-psa/types';
import { createAsset } from '@alga-psa/assets/actions';
import { buildDefaultAssetSeeds } from './assetDefaultMetadata';

/** A delivered serialized unit awaiting post-commit asset creation (F029). */
export interface PendingAssetLink {
  unit: IStockUnit;
  serviceId: string;
  serviceName: string;
  clientId: string;
  /**
   * Product make (service_catalog.manufacturer). Seeds the created asset's
   * `manufacturer` column so the delivery preserves the product's make.
   */
  manufacturer?: string | null;
  /**
   * Ticket/project the delivery was installed on. When set, the created asset is also
   * associated with that entity (asset_associations) so it shows up in its asset section.
   */
  parentType?: 'ticket' | 'project';
  parentId?: string;
  /** User credited with the association; falls back to the tenant's earliest user. */
  createdBy?: string | null;
}

export interface UnwindDeliveredAssetInput {
  unitId: string;
  parentType: 'ticket' | 'project';
  parentId: string;
  /** The ticket/project material whose delivery is being undone. */
  materialId: string;
}

/**
 * Undo the asset side of a ticket/project material delivery whose material line is being
 * removed (material delete, undo install, restock of an unbilled line). The stock side is
 * restored by the caller.
 *
 * - The asset's association with the ticket/project (asset section) is removed.
 * - When the unit's asset was created BY this delivery (still linked to the unit and created
 *   after the delivery's consume movement), it is retired and unlinked from the unit. A wrong
 *   serial can only be fixed by remove + re-add, and every delivery creates a new asset, so
 *   leaving it active on the client would pile up duplicates. Assets that predate the delivery
 *   (e.g. an RMA asset carried over to the unit) are left as they are.
 *
 * No-op when the unit never produced an asset.
 */
export async function unwindDeliveredAsset(
  trx: Knex.Transaction,
  tenant: string,
  input: UnwindDeliveredAssetInput,
): Promise<void> {
  const db = tenantDb(trx, tenant);
  const unit = await db.table('stock_units')
    .where({ unit_id: input.unitId })
    .select('asset_id')
    .first();
  const assetId = (unit as { asset_id?: string | null } | undefined)?.asset_id;
  if (!assetId) return;
  await db.table('asset_associations')
    .where({ asset_id: assetId, entity_id: input.parentId, entity_type: input.parentType })
    .delete();

  const delivery = await db.table('stock_movements')
    .where({
      unit_id: input.unitId,
      movement_type: 'consume',
      source_doc_type: `${input.parentType}_material`,
      source_doc_id: input.materialId,
    })
    .orderBy('created_at', 'desc')
    .first('created_at');
  const asset = await db.table('assets')
    .where({ asset_id: assetId, stock_unit_id: input.unitId })
    .first('created_at');
  if (!delivery?.created_at || !asset?.created_at) return;
  if (new Date(asset.created_at).getTime() < new Date(delivery.created_at).getTime()) return;

  await admitOperationalWrite(trx, tenant, 'assets', 'asset-unwind-delivery');
  await db.table('assets')
    .where({ asset_id: assetId })
    .update({ status: 'retired', stock_unit_id: null, updated_at: trx.fn.now() });
  await db.table('stock_units')
    .where({ unit_id: input.unitId })
    .update({ asset_id: null, updated_at: trx.fn.now() });
}

/**
 * Create a managed asset for a delivered serialized unit and wire the bidirectional
 * link (assets.service_id + assets.stock_unit_id, and the stock_units.asset_id
 * back-pointer). Carries serial + warranty. See design §6.B.5 (F085/F086).
 *
 * Runs AFTER the stock transaction has committed (F029): createAsset commits in its
 * own transaction, so creating it mid-flight orphaned assets when the stock work
 * rolled back. The link updates get their own short transaction; a failure here is
 * surfaced to the caller as a warning, never an unwind of the delivery.
 */
export async function createAndLinkDeliveredAsset(
  db: Knex,
  tenant: string,
  p: PendingAssetLink,
): Promise<string | null> {
  const serial = p.unit.serial_number || p.unit.unit_id;
  // F026: the product's configured default asset type, falling back to 'unknown'.
  // Alongside it, the product's default spec metadata seeds the extension row so
  // delivered assets start out filled out (QuickAddAsset "unknown" fill semantics).
  const settings = await db('product_inventory_settings')
    .where({ tenant, service_id: p.serviceId })
    .select('default_asset_type', 'default_asset_metadata')
    .first();
  const assetType = (settings?.default_asset_type as string | null | undefined)?.trim() || 'unknown';
  const { base: specBase, extension } = buildDefaultAssetSeeds(
    assetType,
    (settings?.default_asset_metadata as Record<string, unknown> | null | undefined) ?? null,
  );
  const manufacturer = p.manufacturer?.trim();
  const req: CreateAssetRequest & Record<string, unknown> = {
    asset_type: assetType,
    client_id: p.clientId,
    // Delivery supplies inventory identity, not a scanned physical asset tag.
    // Omit asset_tag so the shared tenant sequence assigns the physical label.
    name: p.serviceName ? `${p.serviceName} ${serial}`.trim() : serial,
    status: 'active',
    serial_number: p.unit.serial_number || undefined,
    ...(manufacturer ? { manufacturer } : {}),
    ...(typeof p.unit.mac_address === 'string' && p.unit.mac_address.trim()
      ? { attributes: { mac_address: p.unit.mac_address } }
      : {}),
    ...(p.unit.warranty_expires_at
      ? { warranty_end_date: new Date(p.unit.warranty_expires_at as any).toISOString() }
      : {}),
  };
  // Seed the built-in type's extension row (workstation/server/...) from the product defaults.
  if (extension) {
    req[assetType] = extension;
  }
  // Spec values that target base asset columns (e.g. Model on assets.model for
  // types whose extension table has no model column).
  for (const [column, value] of Object.entries(specBase)) {
    req[column] = value;
  }
  // createAsset is an ABAC-respecting server action; it runs in its own transaction.
  const asset = await createAsset(req);
  if (!asset || !('asset_id' in asset)) {
    const error = asset as { actionError?: string; permissionError?: string; messageKey?: string } | null;
    throw Object.assign(new Error(error?.actionError ?? error?.permissionError ?? 'Asset creation did not return an asset'), { messageKey: error?.messageKey });
  }

  await withTransaction(db, async (trx: Knex.Transaction) => {
    await admitOperationalWrite(trx, tenant, 'assets', 'asset-link-unit');
    await trx('assets')
      .where({ tenant, asset_id: asset.asset_id })
      .update({ service_id: p.serviceId, stock_unit_id: p.unit.unit_id, updated_at: trx.fn.now() });
    await trx('stock_units')
      .where({ tenant, unit_id: p.unit.unit_id })
      .update({ asset_id: asset.asset_id, updated_at: trx.fn.now() });

    // Ticket/project installs show the delivered unit in their asset section: associate
    // the new asset with the parent (mirrors shared associateAssetWithTicket, extended
    // to projects). created_by is NOT NULL, so fall back to the tenant's earliest user.
    if (p.parentType && p.parentId) {
      const db = tenantDb(trx, tenant);
      let createdBy = p.createdBy ?? null;
      if (!createdBy) {
        const auditUser = await db.table('users').orderBy('created_at', 'asc').first('user_id');
        createdBy = (auditUser as { user_id?: string } | undefined)?.user_id ?? null;
      }
      if (createdBy) {
        try {
          await db.table('asset_associations').insert({
            tenant,
            asset_id: asset.asset_id,
            entity_id: p.parentId,
            entity_type: p.parentType,
            relationship_type: 'affected',
            created_by: createdBy,
            created_at: trx.fn.now(),
          });
        } catch (error: any) {
          // A concurrent association for the same (asset, entity) is fine.
          if (error?.code !== '23505') throw error;
        }
      }
    }
  });

  if (p.parentType && p.parentId) {
    const { revalidatePath } = await import('next/cache');
    const base = p.parentType === 'ticket' ? '/msp/tickets' : '/msp/projects';
    revalidatePath(`${base}/${p.parentId}`);
    revalidatePath('/msp/assets');
  }

  return asset.asset_id;
}
