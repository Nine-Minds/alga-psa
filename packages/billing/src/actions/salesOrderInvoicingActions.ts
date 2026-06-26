'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { generateManualInvoice } from './manualInvoiceActions';

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
export const generateInvoiceForSalesOrder = withAuth(
  async (
    user,
    { tenant },
    soId: string,
    opts?: { mode?: 'fulfilled' | 'ordered' },
  ): Promise<{ success: boolean; invoiced: number; invoiceId?: string; error?: string }> => {
    if (!(await hasPermission(user, 'sales_order', 'update'))) {
      throw new Error('Permission denied: sales_order update required');
    }
    const { knex: db } = await createTenantKnex();

    const { so, billable } = await withTransaction(db, async (trx: Knex.Transaction) => {
      const so = await trx('sales_orders').where({ tenant, so_id: soId }).first();
      if (!so) throw new Error('Sales order not found');
      if (so.status === 'cancelled') throw new Error('Cannot invoice a cancelled sales order');
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

    if (!billable.length) return { success: true, invoiced: 0 };

    const items = billable.map((b: any) => ({
      service_id: b.line.service_id,
      quantity: b.qty,
      description: `Sales Order ${so.so_number}`,
      rate: Number(b.line.unit_price),
    }));

    const result: any = await generateManualInvoice({
      clientId: so.client_id,
      currency_code: so.currency_code,
      items,
    } as any);

    if (result && result.success === false) {
      return { success: false, invoiced: 0, error: result.error };
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
      invoiceId: result?.invoice?.invoice_id ?? result?.invoiceId,
    };
  },
);
