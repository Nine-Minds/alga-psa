import { Knex } from 'knex';
import { withTransaction } from '@alga-psa/db';
import { IStockUnit, CreateAssetRequest, Asset } from '@alga-psa/types';
import { createAsset } from '@alga-psa/assets/actions';

/** A delivered serialized unit awaiting post-commit asset creation (F029). */
export interface PendingAssetLink {
  unit: IStockUnit;
  serviceId: string;
  serviceName: string;
  clientId: string;
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
  const settings = await db('product_inventory_settings')
    .where({ tenant, service_id: p.serviceId })
    .select('default_asset_type')
    .first();
  const assetType = (settings?.default_asset_type as string | null | undefined)?.trim() || 'unknown';
  const req: CreateAssetRequest = {
    asset_type: assetType,
    client_id: p.clientId,
    asset_tag: serial,
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
  // createAsset is an ABAC-respecting server action; it runs in its own transaction.
  const asset = (await createAsset(req)) as Asset;
  if (!asset?.asset_id) return null;

  await withTransaction(db, async (trx: Knex.Transaction) => {
    await trx('assets')
      .where({ tenant, asset_id: asset.asset_id })
      .update({ service_id: p.serviceId, stock_unit_id: p.unit.unit_id, updated_at: trx.fn.now() });
    await trx('stock_units')
      .where({ tenant, unit_id: p.unit.unit_id })
      .update({ asset_id: asset.asset_id, updated_at: trx.fn.now() });
  });

  return asset.asset_id;
}
