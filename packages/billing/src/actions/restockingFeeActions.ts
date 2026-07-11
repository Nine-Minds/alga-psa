'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { restockReturn } from '@alga-psa/inventory/actions/restockReturnActions';
import { generateManualInvoice } from './manualInvoiceActions';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import type { IStockMovement } from '@alga-psa/types';

/**
 * Restock-to-sellable return WITH the restocking fee wired to billing (design §6.H,
 * plan §1.5). Lives in billing — billing → inventory is the allowed dependency
 * direction, so this composite may import inventory's `restockReturn` and billing's
 * own invoice engine.
 *
 * Deliberately NON-ATOMIC: the physical restock commits first (the stock genuinely
 * moved back to sellable — same semantics as fulfillAndInvoiceSoLine). If a fee is
 * present, we then attempt a DRAFT one-line manual invoice for it. A billing failure
 * NEVER unwinds the restock; it degrades to `fee_invoice_error` so the biller can
 * create the fee manually. The goods refund stays the biller's normal AR workflow.
 */
export type RestockReturnWithFeeError = ActionMessageError | ActionPermissionError;

export interface RestockReturnWithFeeResult {
  movement: IStockMovement;
  restocking_fee_cents: number | null;
  fee_invoice?: { invoice_id: string; invoice_number: string | null };
  /** Set when a fee was owed but no invoice was created — always with a specific reason. */
  fee_invoice_error?: string;
}

export const restockReturnWithFee = withAuth(
  async (
    user,
    { tenant },
    input: {
      unit_id?: string;
      service_id?: string;
      location_id?: string;
      quantity?: number;
      restocking_fee_cents?: number | null;
      /** Required for a non-serialized restock that carries a fee (serialized derives it from the unit). */
      client_id?: string;
    },
  ): Promise<RestockReturnWithFeeResult | RestockReturnWithFeeError> => {
    // Step 1 — the physical restock (checks inventory 'update' itself). Commit first.
    const restock = await restockReturn({
      unit_id: input.unit_id,
      service_id: input.service_id,
      location_id: input.location_id,
      quantity: input.quantity,
      restocking_fee_cents: input.restocking_fee_cents,
    });
    if (isActionMessageError(restock) || isActionPermissionError(restock)) {
      return restock as RestockReturnWithFeeError;
    }

    const feeCents = restock.restocking_fee_cents ?? 0;
    const result: RestockReturnWithFeeResult = {
      movement: restock.movement,
      restocking_fee_cents: restock.restocking_fee_cents,
    };
    if (feeCents <= 0) {
      return result; // No fee — nothing to bill.
    }

    // Step 2 — the fee invoice. Any failure here is reported, not thrown: the restock stands.
    try {
      // Serialized restock knows its client; non-serialized needs it from the caller.
      const clientId = restock.client_id ?? input.client_id ?? null;
      if (!clientId) {
        result.fee_invoice_error = 'No client to bill the restocking fee to. Create the fee invoice manually.';
        return result;
      }
      if (!(await hasPermission(user, 'billing', 'create'))) {
        result.fee_invoice_error =
          "You don't have permission to create invoices, so the restocking fee wasn't billed. Ask a biller to create it.";
        return result;
      }

      const label = restock.serial_number ?? (await serviceName(tenant, restock.service_id)) ?? 'restocked item';
      const invoice: any = await generateManualInvoice({
        clientId,
        items: [
          {
            service_id: restock.service_id,
            quantity: 1,
            description: `Restocking fee — ${label}`,
            rate: feeCents,
          },
        ],
      } as any);

      if (isActionMessageError(invoice) || isActionPermissionError(invoice)) {
        result.fee_invoice_error = getErrorMessage(invoice);
        return result;
      }
      if (invoice && invoice.success === false) {
        result.fee_invoice_error = invoice.error || 'The restocking fee invoice could not be created.';
        return result;
      }

      result.fee_invoice = {
        invoice_id: invoice?.invoice?.invoice_id ?? invoice?.invoiceId,
        invoice_number: invoice?.invoice?.invoice_number ?? null,
      };
      return result;
    } catch (e) {
      result.fee_invoice_error = e instanceof Error ? e.message : 'The restocking fee invoice could not be created.';
      return result;
    }
  },
);

async function serviceName(tenant: string, serviceId: string): Promise<string | null> {
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const svc = await trx('service_catalog')
      .where({ tenant, service_id: serviceId })
      .select('service_name')
      .first();
    return (svc?.service_name as string) || null;
  });
}
