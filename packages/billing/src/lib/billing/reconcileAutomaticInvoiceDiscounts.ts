import type { Knex } from 'knex';
import { reconcileAutomaticInvoiceDiscounts } from '../../services/invoiceAutomaticAdjustments';

/** Compatibility entry point for recurring revision reconciliation. All callers
 * share the scoped, source-linked invoice discount settlement writer. */
export async function reconcileAutomaticInvoiceAdjustments(params: {
  trx: Knex.Transaction;
  tenant: string;
  invoiceId: string;
}): Promise<number> {
  return reconcileAutomaticInvoiceDiscounts(params.trx, params.tenant, params.invoiceId);
}
