import type { Knex } from 'knex';
import type { IVendor } from '@alga-psa/types';

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
  | { ok: false; code: 'duplicate_name'; name: string };

/** Trim a vendor name for storage and matching. */
export function normalizeVendorName(name: string | null | undefined): string {
  return (name ?? '').trim();
}

/** Find a vendor by trimmed, case-insensitive name (active or inactive). */
export async function findVendorByNameCore(
  trx: Knex.Transaction,
  tenant: string,
  vendorName: string,
): Promise<IVendor | null> {
  const name = normalizeVendorName(vendorName);
  if (!name) return null;
  const row = await trx('vendors')
    .where({ tenant })
    .whereRaw('LOWER(btrim(vendor_name)) = LOWER(?)', [name])
    .first();
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
  if (existing) return { ok: false, code: 'duplicate_name', name: vendorName };

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
