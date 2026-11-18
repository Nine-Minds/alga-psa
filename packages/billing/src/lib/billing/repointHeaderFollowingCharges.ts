import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export interface RepointHeaderFollowingChargesParams {
  tenant: string;
  invoiceId: string;
  /** The invoice header's profile before the change (null when it had none). */
  fromProfileId: string | null | undefined;
  /** The profile the header is moving to (null clears it). */
  toProfileId: string | null;
  /**
   * When given, header-following charges that move are stamped with this
   * `billing_profile_source`. Charges whose source is `contract_line`,
   * `contract` or `work_item` keep their source. When omitted, sources are
   * left untouched.
   */
  source?: 'explicit' | 'client_default';
}

/**
 * Moves the charges that were following an invoice header onto its new billing
 * profile. Charges attributed to any other profile keep both profile and source.
 *
 *   old header profile set  → charges on that profile, or with no profile
 *   old header profile null → only charges with no profile
 *
 * Shared by the invoice editor and the REST update so the two cannot diverge.
 * Runs on the caller's transaction; never opens its own.
 */
export async function repointHeaderFollowingCharges(
  trx: Knex | Knex.Transaction,
  params: RepointHeaderFollowingChargesParams
): Promise<number> {
  const { tenant, invoiceId, fromProfileId, toProfileId, source } = params;

  const query = tenantDb(trx, tenant).table('invoice_charges').where({ invoice_id: invoiceId });
  if (fromProfileId) {
    query.where((qb) => {
      qb.where('billing_profile_id', fromProfileId).orWhereNull('billing_profile_id');
    });
  } else {
    query.whereNull('billing_profile_id');
  }

  const update: Record<string, unknown> = { billing_profile_id: toProfileId };
  if (source) {
    update.billing_profile_source = trx.raw(
      `CASE WHEN billing_profile_source IN ('contract_line', 'contract', 'work_item')
            THEN billing_profile_source ELSE ? END`,
      [source]
    );
  }
  return query.update(update);
}
