import type { Knex } from 'knex';
import type { IVendor, PurchaseOrderStatus } from '@alga-psa/types';
import { VendorCoreError } from './vendorErrors';

/**
 * Transaction-scoped vendor cores. These own the vendor invariants (trimmed,
 * case-insensitive name uniqueness per tenant) and are called by both the
 * `withAuth` vendor actions and the AMP `vendor_products` applier, which must
 * never open its own transaction or perform its own auth check.
 */

export interface CreateVendorInput {
  vendor_name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  payment_terms?: string | null;
  account_number?: string | null;
  notes?: string | null;
}

export type CreateVendorCoreResult =
  | { ok: true; vendor: IVendor }
  | { ok: false; code: 'name_required' }
  /** `name` is the requested (normalized) name; `existing` is the vendor that already holds it. */
  | { ok: false; code: 'duplicate_name'; name: string; existing: { vendor_id: string; vendor_name: string } };

/** Trim a vendor name for storage and matching. */
export function normalizeVendorName(name: string | null | undefined): string {
  return (name ?? '').trim();
}

/**
 * Find a vendor by trimmed, case-insensitive name (active or inactive),
 * optionally ignoring one vendor (the one being renamed).
 */
export async function findVendorByNameCore(
  trx: Knex.Transaction,
  tenant: string,
  vendorName: string,
  excludeVendorId?: string,
): Promise<IVendor | null> {
  const name = normalizeVendorName(vendorName);
  if (!name) return null;
  const query = trx('vendors')
    .where({ tenant })
    .whereRaw('LOWER(btrim(vendor_name)) = LOWER(?)', [name]);
  if (excludeVendorId) query.andWhereNot({ vendor_id: excludeVendorId });
  const row = await query.first();
  return (row ?? null) as IVendor | null;
}

export async function createVendorCore(
  trx: Knex.Transaction,
  tenant: string,
  input: CreateVendorInput,
): Promise<CreateVendorCoreResult> {
  const vendorName = normalizeVendorName(input.vendor_name);
  if (!vendorName) return { ok: false, code: 'name_required' };

  // vendor_name is unique per tenant; surface a clean result instead of a raw constraint violation.
  const existing = await findVendorByNameCore(trx, tenant, vendorName);
  if (existing) {
    return {
      ok: false,
      code: 'duplicate_name',
      name: vendorName,
      existing: { vendor_id: existing.vendor_id, vendor_name: existing.vendor_name },
    };
  }

  const [row] = await trx('vendors')
    .insert({
      tenant,
      vendor_name: vendorName,
      contact_name: input.contact_name ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      website: input.website ?? null,
      payment_terms: input.payment_terms ?? null,
      account_number: input.account_number ?? null,
      notes: input.notes ?? null,
      is_active: true,
    })
    .returning('*');
  return { ok: true, vendor: row as IVendor };
}

/**
 * Match an existing vendor by trimmed, case-insensitive name or create it.
 * An inactive vendor is matched, not reactivated or duplicated: the name is
 * unique per tenant regardless of status.
 */
export async function createOrMatchVendorCore(
  trx: Knex.Transaction,
  tenant: string,
  vendorName: string,
): Promise<{ vendor: IVendor; created: boolean }> {
  const existing = await findVendorByNameCore(trx, tenant, vendorName);
  if (existing) return { vendor: existing, created: false };
  const result = await createVendorCore(trx, tenant, { vendor_name: vendorName });
  if (result.ok === false) {
    throw new Error(
      result.code === 'name_required' ? 'Vendor name is required' : `A vendor named "${result.name}" already exists`,
    );
  }
  return { vendor: result.vendor, created: true };
}

/** Open PO statuses that block deactivating the vendor they belong to. */
const OPEN_PO_STATUSES: PurchaseOrderStatus[] = ['draft', 'open', 'partially_received'];

export interface QueryVendorsOptions {
  /** Case-insensitive substring match on vendor_name. */
  search?: string;
  /** Default false: only active vendors, as in the UI. */
  includeInactive?: boolean;
  /** Both must be given to paginate; omitted returns every match. */
  page?: number;
  limit?: number;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export async function queryVendors(
  trx: Knex.Transaction,
  tenant: string,
  opts: QueryVendorsOptions = {},
): Promise<{ data: IVendor[]; total: number }> {
  const filtered = () => {
    const q = trx('vendors').where({ tenant });
    if (!opts.includeInactive) q.andWhere({ is_active: true });
    const search = opts.search?.trim();
    if (search) q.andWhereRaw("vendor_name ILIKE ? ESCAPE '\\'", [`%${escapeLike(search)}%`]);
    return q;
  };

  const rows = filtered().orderBy('vendor_name', 'asc').orderBy('vendor_id', 'asc');
  if (opts.page && opts.limit) rows.limit(opts.limit).offset((opts.page - 1) * opts.limit);
  const [data, countRow] = await Promise.all([
    rows as unknown as Promise<IVendor[]>,
    filtered().count<{ count: string }[]>({ count: '*' }).first(),
  ]);
  return { data, total: Number(countRow?.count ?? 0) };
}

export async function queryVendor(
  trx: Knex.Transaction,
  tenant: string,
  vendorId: string,
): Promise<IVendor | null> {
  const row = await trx('vendors').where({ tenant, vendor_id: vendorId }).first();
  return (row ?? null) as IVendor | null;
}

export type UpdateVendorInput = Partial<
  Pick<
    IVendor,
    | 'vendor_name'
    | 'contact_name'
    | 'email'
    | 'phone'
    | 'website'
    | 'payment_terms'
    | 'account_number'
    | 'notes'
    | 'is_active'
  >
>;

const UPDATABLE_VENDOR_FIELDS = [
  'vendor_name',
  'contact_name',
  'email',
  'phone',
  'website',
  'payment_terms',
  'account_number',
  'notes',
  'is_active',
] as const;

/**
 * Patch a vendor. `is_active` is accepted so the UI can reactivate. A rename is
 * subject to the same normalized-name uniqueness as create.
 * Throws VendorCoreError: validation/name_required, conflict/duplicate_name,
 * not_found/vendor_not_found.
 */
export async function updateVendorCore(
  trx: Knex.Transaction,
  tenant: string,
  vendorId: string,
  patch: UpdateVendorInput,
): Promise<IVendor> {
  if (typeof patch.vendor_name === 'string') {
    const vendorName = normalizeVendorName(patch.vendor_name);
    if (!vendorName) {
      throw new VendorCoreError('validation', 'name_required', 'Vendor name is required', { field: 'vendor_name' });
    }
    const conflict = await findVendorByNameCore(trx, tenant, vendorName, vendorId);
    if (conflict) {
      throw new VendorCoreError('conflict', 'duplicate_name', `A vendor named "${vendorName}" already exists`, {
        name: vendorName,
        existing_vendor_id: conflict.vendor_id,
        existing_vendor_name: conflict.vendor_name,
      });
    }
  }

  const update: Record<string, unknown> = { updated_at: trx.fn.now() };
  for (const key of UPDATABLE_VENDOR_FIELDS) {
    if (key in patch) update[key] = patch[key];
  }
  if (typeof update.vendor_name === 'string') update.vendor_name = normalizeVendorName(update.vendor_name);

  const [row] = await trx('vendors').where({ tenant, vendor_id: vendorId }).update(update).returning('*');
  if (!row) throw new VendorCoreError('not_found', 'vendor_not_found', 'Vendor not found');
  return row as IVendor;
}

/**
 * Deactivate a vendor. Idempotent: an already-inactive vendor is returned
 * unchanged (no write). Guarded: an active vendor with open purchase orders
 * (draft/open/partially_received) cannot be deactivated.
 * Throws VendorCoreError: not_found/vendor_not_found, conflict/has_open_purchase_orders.
 */
export async function deactivateVendorCore(
  trx: Knex.Transaction,
  tenant: string,
  vendorId: string,
): Promise<IVendor> {
  const vendor = await queryVendor(trx, tenant, vendorId);
  if (!vendor) throw new VendorCoreError('not_found', 'vendor_not_found', 'Vendor not found');
  if (!vendor.is_active) return vendor;

  const openPo = await trx('purchase_orders')
    .where({ tenant, vendor_id: vendorId })
    .whereIn('status', OPEN_PO_STATUSES)
    .first();
  if (openPo) {
    throw new VendorCoreError('conflict', 'has_open_purchase_orders', 'Cannot deactivate a vendor with open purchase orders');
  }

  const [row] = await trx('vendors')
    .where({ tenant, vendor_id: vendorId })
    .update({ is_active: false, updated_at: trx.fn.now() })
    .returning('*');
  if (!row) throw new VendorCoreError('not_found', 'vendor_not_found', 'Vendor not found');
  return row as IVendor;
}
