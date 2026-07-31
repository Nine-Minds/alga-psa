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
} from '@alga-psa/inventory/actions/fulfillmentActions';
import {
  confirmDropShipShipment,
  ConfirmDropShipShipmentInput,
  ConfirmDropShipShipmentResult,
  DropShipLineRef,
  type InventoryActionError,
} from '@alga-psa/inventory/actions/dropShipActions';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { generateInvoiceNumber } from './invoiceGeneration';
import { getDueDate } from './billingAndTax';
import { getInitialInvoiceTaxSource } from './taxSourceActions';
import { TaxService } from '../services/taxService';
import * as invoiceService from '../services/invoiceService';

export interface InvoiceableSalesOrderForBilling {
  so_id: string;
  so_number: string;
  client_id: string;
  client_name: string | null;
  status: string;
  invoice_mode: string;
  currency_code: string;
  total_amount: number;
  billable_amount: number;
  quantity_ordered_total: number;
  quantity_fulfilled_total: number;
  quantity_invoiced_total: number;
  billable_quantity_total: number;
  line_count: number;
  drop_ship_line_count: number;
  created_at?: string | Date | null;
}

/**
 * Billing/Invoicing needs a source picker for sales-order-backed manual invoices.
 * The billable calculation intentionally matches generateInvoiceForSalesOrder:
 * manual-mode orders bill ordered minus invoiced, while on-fulfillment orders bill
 * fulfilled minus invoiced, capped by ordered quantity.
 */
export const listInvoiceableSalesOrdersForBilling = withAuth(
  async (
    user,
    { tenant },
    input?: { clientId?: string | null },
  ): Promise<InvoiceableSalesOrderForBilling[]> => {
    if (!(await hasPermission(user, 'sales_order', 'read'))) {
      throw new Error(
        'Permission denied: sales_order read required',
      );
    }

    const { knex: db } = await createTenantKnex();
    const billableQtyExpr = `
      CASE
        WHEN so.invoice_mode = 'manual'
          THEN GREATEST(COALESCE(sol.quantity_ordered, 0) - COALESCE(sol.quantity_invoiced, 0), 0)
        ELSE GREATEST(
          LEAST(COALESCE(sol.quantity_fulfilled, 0), COALESCE(sol.quantity_ordered, 0))
          - COALESCE(sol.quantity_invoiced, 0),
          0
        )
      END
    `;

    return withTransaction(db, async (trx: Knex.Transaction) => {
      const query = trx('sales_orders as so')
        .leftJoin('clients as c', function () {
          this.on('c.client_id', '=', 'so.client_id').andOn('c.tenant', '=', 'so.tenant');
        })
        .join('sales_order_lines as sol', function () {
          this.on('sol.so_id', '=', 'so.so_id').andOn('sol.tenant', '=', 'so.tenant');
        })
        .where('so.tenant', tenant)
        .whereNotIn('so.status', ['draft', 'cancelled'])
        .groupBy(
          'so.tenant',
          'so.so_id',
          'so.so_number',
          'so.client_id',
          'c.client_name',
          'so.status',
          'so.invoice_mode',
          'so.currency_code',
          'so.created_at',
        )
        .havingRaw(`COALESCE(SUM((${billableQtyExpr}) * sol.unit_price), 0) > 0`)
        .orderByRaw(`COALESCE(SUM((${billableQtyExpr}) * sol.unit_price), 0) DESC`)
        .orderBy('so.created_at', 'desc')
        .select(
          'so.so_id',
          'so.so_number',
          'so.client_id',
          'c.client_name',
          'so.status',
          'so.invoice_mode',
          'so.currency_code',
          'so.created_at',
          trx.raw('COALESCE(SUM(sol.quantity_ordered * sol.unit_price), 0)::bigint as total_amount'),
          trx.raw(`COALESCE(SUM((${billableQtyExpr}) * sol.unit_price), 0)::bigint as billable_amount`),
          trx.raw('COALESCE(SUM(sol.quantity_ordered), 0)::int as quantity_ordered_total'),
          trx.raw('COALESCE(SUM(sol.quantity_fulfilled), 0)::int as quantity_fulfilled_total'),
          trx.raw('COALESCE(SUM(sol.quantity_invoiced), 0)::int as quantity_invoiced_total'),
          trx.raw(`COALESCE(SUM(${billableQtyExpr}), 0)::int as billable_quantity_total`),
          trx.raw('COUNT(*)::int as line_count'),
          trx.raw("COUNT(*) FILTER (WHERE sol.fulfillment_type = 'drop_ship')::int as drop_ship_line_count"),
        );

      if (input?.clientId) {
        query.andWhere('so.client_id', input.clientId);
      }

      const rows = await query;
      return rows.map((row: any) => ({
        so_id: row.so_id,
        so_number: row.so_number,
        client_id: row.client_id,
        client_name: row.client_name ?? null,
        status: row.status,
        invoice_mode: row.invoice_mode,
        currency_code: row.currency_code,
        total_amount: Number(row.total_amount ?? 0),
        billable_amount: Number(row.billable_amount ?? 0),
        quantity_ordered_total: Number(row.quantity_ordered_total ?? 0),
        quantity_fulfilled_total: Number(row.quantity_fulfilled_total ?? 0),
        quantity_invoiced_total: Number(row.quantity_invoiced_total ?? 0),
        billable_quantity_total: Number(row.billable_quantity_total ?? 0),
        line_count: Number(row.line_count ?? 0),
        drop_ship_line_count: Number(row.drop_ship_line_count ?? 0),
        created_at: row.created_at,
      }));
    });
  },
);

/**
 * Sales-order invoicing — bridges sales_order_lines into the existing manual-invoice
 * path (which owns invoice numbering / tax / totals). Lives in billing to avoid a
 * billing<->inventory dependency cycle (billing already depends on inventory).
 *
 * Idempotency (F093/F094): each line tracks quantity_invoiced; only the not-yet-invoiced
 * delta is billed, capped at quantity_ordered (LEAST guard). That delta is only sound if
 * it is read and written under one lock: the whole operation runs in a single transaction
 * with the SO header FOR UPDATE, so the invoice and the counters that say it happened
 * commit together. Reading the delta in its own transaction (the original shape) let two
 * concurrent calls — or a retry after a crash mid-flight — bill the same quantity twice
 * while LEAST kept the counters looking correct.
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
      return {
        success: false,
        invoiced: 0,
        error: 'Permission denied: sales_order update required',
      };
    }
    const { knex: db } = await createTenantKnex();

    const header = await db('sales_orders').where({ tenant, so_id: soId }).first();
    if (!header) {
      return {
        success: false,
        invoiced: 0,
        error: 'Sales order not found',
      };
    }
    if (header.status === 'cancelled') {
      return {
        success: false,
        invoiced: 0,
        error: 'Cannot invoice a cancelled sales order',
      };
    }

    // Read-only prerequisites, resolved before the header lock is taken: each of these
    // opens its own connection, so running them inside the transaction would hold the
    // lock across unrelated I/O. client_id never changes on an SO, so the unlocked read
    // above is safe to key them on; the authoritative state is re-read under the lock.
    let session: Awaited<ReturnType<typeof invoiceService.validateSessionAndTenant>>['session'];
    let client: any;
    let dueDate: string;
    let taxSource: any;
    try {
      ({ session } = await invoiceService.validateSessionAndTenant());
      client = await invoiceService.getClientDetails(db, tenant, header.client_id);
      const emailValidation = await invoiceService.validateClientBillingEmail(
        db,
        tenant,
        header.client_id,
        client.client_name,
      );
      if (!emailValidation.valid) {
        return {
          success: false,
          invoiced: 0,
          error:
            emailValidation.error ??
            'Client billing email is required',
        };
      }
      const due = await getDueDate(header.client_id, Temporal.Now.plainDateISO().toString());
      if (isActionMessageError(due) || isActionPermissionError(due)) {
        return { success: false, invoiced: 0, error: getErrorMessage(due) };
      }
      dueDate = due;
      const source = await getInitialInvoiceTaxSource(header.client_id);
      if (isActionMessageError(source) || isActionPermissionError(source)) {
        return { success: false, invoiced: 0, error: getErrorMessage(source) };
      }
      taxSource = source;
    } catch (error) {
      const expected = expectedSalesOrderInvoiceErrorMessage(error);
      if (expected) {
        return { success: false, invoiced: 0, error: expected };
      }
      throw error;
    }

    try {
      return await withTransaction(db, async (trx: Knex.Transaction) => {
        const so = await trx('sales_orders').where({ tenant, so_id: soId }).forUpdate().first();
        if (!so) {
          return {
            success: false,
            invoiced: 0,
            error: 'Sales order not found',
          };
        }
        if (so.status === 'cancelled') {
          return {
            success: false,
            invoiced: 0,
            error: 'Cannot invoice a cancelled sales order',
          };
        }

        const lines = await trx('sales_order_lines').where({ tenant, so_id: soId }).forUpdate();
        const mode = opts?.mode ?? (so.invoice_mode === 'manual' ? 'ordered' : 'fulfilled');
        const billable = lines
          .map((l: any) => {
            const cap = mode === 'fulfilled' ? Number(l.quantity_fulfilled) : Number(l.quantity_ordered);
            const qty = Math.max(0, Math.min(cap, Number(l.quantity_ordered)) - Number(l.quantity_invoiced));
            return { line: l, qty };
          })
          .filter((x: any) => x.qty > 0);

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
        const existingDraft = await trx('invoices as i')
          .where({
            'i.tenant': tenant,
            'i.client_id': so.client_id,
            'i.status': 'draft',
            'i.is_manual': true,
            'i.currency_code': so.currency_code,
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
          .forUpdate()
          .first();

        // Writing invoice charges is a billing act whichever branch does it — the SO
        // grant alone must not authorize it (the append branch previously skipped this,
        // since it calls the persistence services directly rather than via the action).
        const billingAction = existingDraft ? 'update' : 'create';
        if (!(await hasPermission(user, 'billing', billingAction))) {
          return {
            success: false,
            invoiced: 0,
            error: `Permission denied: billing ${billingAction} required`,
          };
        }

        const taxService = new TaxService();
        let invoiceId: string;

        if (existingDraft) {
          invoiceId = existingDraft.invoice_id;
          const totalBefore = Math.round(Number(existingDraft.total_amount ?? 0));
          await invoiceService.persistManualInvoiceCharges(trx, invoiceId, items as any, client, session, tenant);
          await invoiceService.calculateAndDistributeTax(trx, invoiceId, client, taxService, tenant);

          // Totals like updateInvoiceTotalsAndRecordTransaction, but the transaction row
          // records only the DELTA — re-recording the full total would double the balance.
          const finalItems = await trx('invoice_charges').where({ invoice_id: invoiceId, tenant });
          const subtotal = finalItems.reduce((s: number, it: any) => s + Number(it.net_amount), 0);
          const tax = finalItems.reduce((s: number, it: any) => s + Number(it.tax_amount), 0);
          const total = Math.round(subtotal + tax);
          await trx('invoices')
            .where({ invoice_id: invoiceId, tenant })
            .update({ subtotal: Math.round(subtotal), tax: Math.round(tax), total_amount: total });
          const currentBalance = await trx('transactions')
            .where({ client_id: so.client_id, tenant })
            .orderBy('created_at', 'desc')
            .first()
            .then((lastTx: any) => lastTx?.balance_after || 0);
          await trx('transactions').insert({
            transaction_id: uuidv4(),
            client_id: so.client_id,
            invoice_id: invoiceId,
            amount: total - totalBefore,
            type: 'invoice_adjustment',
            status: 'completed',
            description: `Added sales-order items from ${so.so_number} to invoice ${existingDraft.invoice_number}`,
            created_at: Temporal.Now.instant().toString(),
            tenant,
            balance_after: currentBalance + (total - totalBefore),
          });
        } else {
          // The manual-invoice action owns its own transaction, so the SO path builds the
          // draft from the same invoiceService primitives instead — that is what lets the
          // invoice and the invoiced counters share one commit.
          invoiceId = uuidv4();
          const invoiceNumber = await generateInvoiceNumber(trx);
          await trx('invoices').insert({
            invoice_id: invoiceId,
            tenant,
            client_id: so.client_id,
            invoice_date: Temporal.Now.plainDateISO().toString(),
            due_date: dueDate,
            invoice_number: invoiceNumber,
            status: 'draft',
            currency_code: so.currency_code,
            subtotal: 0,
            tax: 0,
            total_amount: 0,
            credit_applied: 0,
            is_manual: true,
            is_prepayment: false,
            tax_source: taxSource,
          });
          await invoiceService.persistManualInvoiceCharges(trx, invoiceId, items as any, client, session, tenant);
          await invoiceService.calculateAndDistributeTax(trx, invoiceId, client, taxService, tenant);
          await invoiceService.updateInvoiceTotalsAndRecordTransaction(
            trx,
            invoiceId,
            client,
            tenant,
            invoiceNumber,
          );
        }

        // Record what was invoiced (capped at ordered) and advance SO status.
        for (const b of billable) {
          await trx('sales_order_lines')
            .where({ tenant, so_line_id: b.line.so_line_id })
            .update({
              quantity_invoiced: trx.raw('LEAST(quantity_ordered, quantity_invoiced + ?)', [b.qty]),
              updated_at: trx.fn.now(),
            });
        }
        const updatedLines = await trx('sales_order_lines').where({ tenant, so_id: soId });
        const allInvoiced = updatedLines.every(
          (l: any) => Number(l.quantity_invoiced) >= Number(l.quantity_ordered),
        );
        if (allInvoiced) {
          await trx('sales_orders')
            .where({ tenant, so_id: soId })
            .update({ status: 'invoiced', updated_at: trx.fn.now() });
        }

        return {
          success: true,
          invoiced: billable.reduce((s: number, b: any) => s + b.qty, 0),
          invoiceId,
        };
      });
    } catch (error) {
      const expected = expectedSalesOrderInvoiceErrorMessage(error);
      if (expected) {
        return { success: false, invoiced: 0, error: expected };
      }
      throw error;
    }
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
        invoice: {
          success: false,
          invoiced: 0,
          error:
            'Fulfillment was saved, but invoice generation failed. Generate the invoice manually from the sales order.',
        },
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
        invoice: {
          success: false,
          invoiced: 0,
          error:
            'Shipment was confirmed, but invoice generation failed. Generate the invoice manually from the sales order.',
        },
      };
    }
  },
);
