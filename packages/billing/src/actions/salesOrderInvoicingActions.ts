'use server';

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { Temporal } from '@js-temporal/polyfill';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  fulfillSalesOrderLine,
  FulfillSalesOrderLineInput,
  FulfillSalesOrderLineResult,
  confirmDropShipShipment,
  ConfirmDropShipShipmentInput,
  ConfirmDropShipShipmentResult,
  DropShipLineRef,
  type InventoryActionError,
} from '@alga-psa/inventory/actions';
import {
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { generateManualInvoice } from './manualInvoiceActions';
import { TaxService } from '../services/taxService';
import * as invoiceService from '../services/invoiceService';

/**
 * Sales-order invoicing — bridges sales_order_lines into the existing manual-invoice
 * path (which owns invoice numbering / tax / totals). Lives in billing to avoid a
 * billing<->inventory dependency cycle (billing already depends on inventory).
 *
 * Idempotency (F093/F094): each line tracks quantity_invoiced; only the not-yet-invoiced
 * delta is billed, capped at quantity_ordered (LEAST guard) — so on-fulfillment and the
 * manual "Generate invoice" trigger can never double-bill the same quantity.
 *
 * - mode 'fulfilled' (default for invoice_mode='on_fulfillment'): bills quantity_fulfilled − quantity_invoiced
 * - mode 'ordered'   (default for invoice_mode='manual'):         bills quantity_ordered  − quantity_invoiced
 */

function expectedSalesOrderInvoiceErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;

  if (
    error.message === 'Unauthorized' ||
    error.message === 'No tenant found' ||
    error.message === 'Quantity must be greater than 0' ||
    error.message.startsWith('Client not found') ||
    error.message.startsWith('Service not found:')
  ) {
    return error.message;
  }

  return null;
}

function isInventoryActionError(value: unknown): value is InventoryActionError {
  return isActionMessageError(value) || isActionPermissionError(value);
}

export const generateInvoiceForSalesOrder = withAuth(
  async (
    user,
    { tenant },
    soId: string,
    opts?: { mode?: 'fulfilled' | 'ordered' },
  ): Promise<{ success: boolean; invoiced: number; invoiceId?: string; error?: string }> => {
    if (!(await hasPermission(user, 'sales_order', 'update'))) {
      return { success: false, invoiced: 0, error: 'Permission denied: sales_order update required' };
    }
    const { knex: db } = await createTenantKnex();

    const invoiceTarget = await withTransaction(db, async (trx: Knex.Transaction) => {
      const so = await trx('sales_orders').where({ tenant, so_id: soId }).first();
      if (!so) {
        return { so: null, billable: [], error: 'Sales order not found' };
      }
      if (so.status === 'cancelled') {
        return { so, billable: [], error: 'Cannot invoice a cancelled sales order' };
      }
      const lines = await trx('sales_order_lines').where({ tenant, so_id: soId });
      const mode = opts?.mode ?? (so.invoice_mode === 'manual' ? 'ordered' : 'fulfilled');
      const billable = lines
        .map((l: any) => {
          const cap = mode === 'fulfilled' ? Number(l.quantity_fulfilled) : Number(l.quantity_ordered);
          const qty = Math.max(0, Math.min(cap, Number(l.quantity_ordered)) - Number(l.quantity_invoiced));
          return { line: l, qty };
        })
        .filter((x: any) => x.qty > 0);
      return { so, billable };
    });

    if ('error' in invoiceTarget) {
      return { success: false, invoiced: 0, error: invoiceTarget.error };
    }
    const { so, billable } = invoiceTarget;

    if (!billable.length) return { success: true, invoiced: 0 };

    const items = billable.map((b: any) => ({
      service_id: b.line.service_id,
      quantity: b.qty,
      description: `Sales Order ${so.so_number}`,
      rate: Number(b.line.unit_price),
      // Backlink for SO↔invoice reconciliation (F047) and the line's own tax choice (F045).
      so_line_id: b.line.so_line_id,
      tax_rate_id: b.line.tax_rate_id ?? null,
    }));

    // Successive fulfillments append to the SO's open draft instead of spawning an
    // invoice per fulfill (found via the so_line_id backlink). A finalized invoice is
    // never touched — absent an appendable draft we fall through to a fresh one.
    const existingDraft = await withTransaction(db, async (trx: Knex.Transaction) =>
      trx('invoices as i')
        .where({
          'i.tenant': tenant,
          'i.client_id': so.client_id,
          'i.status': 'draft',
          'i.is_manual': true,
          'i.currency_code': so.currency_code ?? 'USD',
        })
        .whereExists(function () {
          this.select(trx.raw('1'))
            .from('invoice_charges as c')
            .join('sales_order_lines as l', function () {
              this.on('l.so_line_id', '=', 'c.so_line_id').andOn('l.tenant', '=', 'c.tenant');
            })
            .whereRaw('c.invoice_id = i.invoice_id')
            .andWhereRaw('c.tenant = i.tenant')
            .andWhere('l.so_id', soId);
        })
        .orderBy('i.created_at', 'desc')
        .first(),
    );

    let invoiceId: string | undefined;
    try {
      if (existingDraft) {
        const { session, knex } = await invoiceService.validateSessionAndTenant();
        const client = await invoiceService.getClientDetails(knex, tenant, so.client_id);
        const totalBefore = Math.round(Number(existingDraft.total_amount ?? 0));
        await knex.transaction(async (trx) => {
          await invoiceService.persistManualInvoiceCharges(
            trx,
            existingDraft.invoice_id,
            items as any,
            client,
            session,
            tenant,
          );
          const taxService = new TaxService();
          await invoiceService.calculateAndDistributeTax(trx, existingDraft.invoice_id, client, taxService, tenant);

          // Totals like updateInvoiceTotalsAndRecordTransaction, but the transaction row
          // records only the DELTA — re-recording the full total would double the balance.
          const finalItems = await trx('invoice_charges').where({ invoice_id: existingDraft.invoice_id, tenant });
          const subtotal = finalItems.reduce((s: number, it: any) => s + Number(it.net_amount), 0);
          const tax = finalItems.reduce((s: number, it: any) => s + Number(it.tax_amount), 0);
          const total = Math.round(subtotal + tax);
          await trx('invoices')
            .where({ invoice_id: existingDraft.invoice_id, tenant })
            .update({ subtotal: Math.round(subtotal), tax: Math.round(tax), total_amount: total });
          const currentBalance = await trx('transactions')
            .where({ client_id: so.client_id, tenant })
            .orderBy('created_at', 'desc')
            .first()
            .then((lastTx: any) => lastTx?.balance_after || 0);
          await trx('transactions').insert({
            transaction_id: uuidv4(),
            client_id: so.client_id,
            invoice_id: existingDraft.invoice_id,
            amount: total - totalBefore,
            type: 'invoice_adjustment',
            status: 'completed',
            description: `Added sales-order items from ${so.so_number} to invoice ${existingDraft.invoice_number}`,
            created_at: Temporal.Now.instant().toString(),
            tenant,
            balance_after: currentBalance + (total - totalBefore),
          });
        });
        invoiceId = existingDraft.invoice_id;
      } else {
        const result: any = await generateManualInvoice({
          clientId: so.client_id,
          currency_code: so.currency_code,
          items,
        } as any);

        if (result && result.success === false) {
          return { success: false, invoiced: 0, error: result.error };
        }
        invoiceId = result?.invoice?.invoice_id ?? result?.invoiceId;
      }
    } catch (error) {
      const expected = expectedSalesOrderInvoiceErrorMessage(error);
      if (expected) {
        return { success: false, invoiced: 0, error: expected };
      }
      throw error;
    }

    // Record what was invoiced (capped at ordered) and advance SO status.
    await withTransaction(db, async (trx: Knex.Transaction) => {
      for (const b of billable) {
        await trx('sales_order_lines')
          .where({ tenant, so_line_id: b.line.so_line_id })
          .update({
            quantity_invoiced: trx.raw('LEAST(quantity_ordered, quantity_invoiced + ?)', [b.qty]),
            updated_at: trx.fn.now(),
          });
      }
      const lines = await trx('sales_order_lines').where({ tenant, so_id: soId });
      const allInvoiced = lines.every((l: any) => Number(l.quantity_invoiced) >= Number(l.quantity_ordered));
      if (allInvoiced) {
        await trx('sales_orders').where({ tenant, so_id: soId }).update({ status: 'invoiced', updated_at: trx.fn.now() });
      }
    });

    return {
      success: true,
      invoiced: billable.reduce((s: number, b: any) => s + b.qty, 0),
      invoiceId,
    };
  },
);

export interface FulfillAndInvoiceResult {
  fulfillment: FulfillSalesOrderLineResult;
  /** Invoice outcome when the SO's invoice_mode is 'on_fulfillment'; null for manual mode. */
  invoice: { success: boolean; invoiced: number; invoiceId?: string; error?: string } | null;
}

export type FulfillAndInvoiceActionResult = FulfillAndInvoiceResult | InventoryActionError;

/**
 * Fulfill an SO line and, when the order's invoice_mode is 'on_fulfillment' (the
 * default), immediately bill the newly fulfilled quantity (F008/F009). Lives in
 * billing because the dependency direction is billing → inventory — inventory's
 * fulfill action cannot call the invoice engine itself.
 *
 * An invoicing failure does NOT unwind the fulfillment (the stock genuinely moved);
 * it is returned as invoice.error and remains billable via "Generate invoice".
 */
export const fulfillAndInvoiceSoLine = withAuth(
  async (
    user,
    { tenant },
    soLineId: string,
    input?: FulfillSalesOrderLineInput,
  ): Promise<FulfillAndInvoiceActionResult> => {
    // Both composed actions enforce their own permissions (sales_order update).
    const fulfillment = await fulfillSalesOrderLine(soLineId, input);
    if (isInventoryActionError(fulfillment)) {
      return fulfillment;
    }

    const { knex: db } = await createTenantKnex();
    const so = await withTransaction(db, async (trx: Knex.Transaction) =>
      trx('sales_orders').where({ tenant, so_id: fulfillment.so_id }).select('invoice_mode').first(),
    );
    if (so?.invoice_mode !== 'on_fulfillment') {
      return { fulfillment, invoice: null };
    }

    try {
      const invoice = await generateInvoiceForSalesOrder(fulfillment.so_id, { mode: 'fulfilled' });
      return { fulfillment, invoice };
    } catch (e) {
      console.error('Failed to generate invoice after sales order fulfillment:', e);
      return {
        fulfillment,
        invoice: { success: false, invoiced: 0, error: 'Fulfillment was saved, but invoice generation failed. Generate the invoice manually from the sales order.' },
      };
    }
  },
);

export interface ConfirmDropShipAndInvoiceResult {
  shipment: ConfirmDropShipShipmentResult;
  /** Invoice outcome when the SO's invoice_mode is 'on_fulfillment'; null for manual mode. */
  invoice: { success: boolean; invoiced: number; invoiceId?: string; error?: string } | null;
}

export type ConfirmDropShipAndInvoiceActionResult = ConfirmDropShipAndInvoiceResult | InventoryActionError;

/**
 * Confirm a drop-ship vendor shipment and bill it under the same rule as from-stock
 * fulfillment: invoice_mode 'on_fulfillment' invoices the newly shipped quantity
 * immediately. Drop-ship is the flow MOST prone to "shipped straight to the client,
 * nobody ever cut the invoice" — it must not bill more lazily than stock does.
 *
 * Same failure semantics as fulfillAndInvoiceSoLine: an invoicing error never unwinds
 * the shipment confirmation; it is returned in invoice.error and stays billable.
 */
export const confirmDropShipAndInvoice = withAuth(
  async (
    user,
    { tenant },
    ref: DropShipLineRef,
    input?: ConfirmDropShipShipmentInput,
  ): Promise<ConfirmDropShipAndInvoiceActionResult> => {
    // Both composed actions enforce their own permissions (sales_order update).
    const shipment = await confirmDropShipShipment(ref, input);
    if (isInventoryActionError(shipment)) {
      return shipment;
    }

    const soId = shipment.so_line.so_id;
    const { knex: db } = await createTenantKnex();
    const so = await withTransaction(db, async (trx: Knex.Transaction) =>
      trx('sales_orders').where({ tenant, so_id: soId }).select('invoice_mode').first(),
    );
    if (so?.invoice_mode !== 'on_fulfillment') {
      return { shipment, invoice: null };
    }

    try {
      const invoice = await generateInvoiceForSalesOrder(soId, { mode: 'fulfilled' });
      return { shipment, invoice };
    } catch (e) {
      console.error('Failed to generate invoice after drop-ship confirmation:', e);
      return {
        shipment,
        invoice: { success: false, invoiced: 0, error: 'Shipment was confirmed, but invoice generation failed. Generate the invoice manually from the sales order.' },
      };
    }
  },
);
