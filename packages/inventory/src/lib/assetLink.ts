import { Knex } from 'knex';
import { tenantDb, withTransaction, admitOperationalWrite } from '@alga-psa/db';
import { IStockUnit, CreateAssetRequest } from '@alga-psa/types';
import { createAsset } from '@alga-psa/assets/actions';
import { buildDefaultAssetExtension } from './assetDefaultMetadata';

/** A delivered serialized unit awaiting post-commit asset creation (F029). */
export interface PendingAssetLink {
  unit: IStockUnit;
  serviceId: string;
  serviceName: string;
  clientId: string;
  /**
   * Ticket/project the delivery was installed on. When set, the created asset is also
   * associated with that entity (asset_associations) so it shows up in its asset section.
   */
  parentType?: 'ticket' | 'project';
  parentId?: string;
  /** User credited with the association; falls back to the tenant's earliest user. */
  createdBy?: string | null;
}

/**
 * Un-assign a delivered unit's asset from the ticket/project its material sat on.
 * Deleting the material restores the stock unit (client/delivery cleared on the stock
 * side); the ticket's asset section is fed by asset_associations, so those rows for
 * this (asset, entity) are removed here. No-op when the unit never produced an asset.
 */
export async function detachDeliveredAssetAssociation(
  trx: Knex.Transaction,
  tenant: string,
  unitId: string,
  parentType: 'ticket' | 'project',
  parentId: string,
): Promise<void> {
  const unit = await trx('stock_units')
    .where({ tenant, unit_id: unitId })
    .select('asset_id')
    .first();
  const assetId = (unit as { asset_id?: string | null } | undefined)?.asset_id;
  if (!assetId) return;
  await tenantDb(trx, tenant)
    .table('asset_associations')
    .where({ asset_id: assetId, entity_id: parentId, entity_type: parentType })
    .delete();
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
  const extension = buildDefaultAssetExtension(
    assetType,
    (settings?.default_asset_metadata as Record<string, unknown> | null | undefined) ?? null,
  );
  const req: CreateAssetRequest & Record<string, unknown> = {
    asset_type: assetType,
    client_id: p.clientId,
    // Delivery supplies inventory identity, not a scanned physical asset tag.
    // Omit asset_tag so the shared tenant sequence assigns the physical label.
    name: p.serviceName ? `${p.serviceName} ${serial}`.trim() : serial,
    status: 'active',
    serial_number: p.unit.serial_number || undefined,
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
