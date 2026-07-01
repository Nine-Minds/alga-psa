'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { IVendorBill, IVendorBillLine, VendorBillStatus } from '@alga-psa/types';

// NOTE: 'use server' file — export ONLY async functions (+ erased types).

/**
 * Vendor bills — light AP (F077–F080, D9). Records what the vendor invoiced,
 * optionally against a PO (prefilled from received quantities), with a due date
 * from the vendor's payment terms and a non-blocking 2-way variance vs the PO's
 * received value. No GL, no payment rails: mark-paid is a manual status change.
 */

async function requireBillPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'vendor_bill', action))) {
    throw new Error(`Permission denied: vendor_bill ${action} required`);
  }
}

/** Days from the vendor's free-text payment terms ('net30', 'NET 45', …); default 30 (F079). */
function termsToDays(paymentTerms?: string | null): number {
  const m = /(\d+)/.exec(paymentTerms ?? '');
  return m ? Number(m[1]) : 30;
}

async function getBillOrThrow(
  trx: Knex.Transaction,
  tenant: string,
  billId: string,
  opts?: { forUpdate?: boolean },
): Promise<IVendorBill> {
  const q = trx('vendor_bills').where({ tenant, bill_id: billId });
  if (opts?.forUpdate) q.forUpdate();
  const row = await q.first();
  if (!row) throw new Error('Vendor bill not found');
  return row as IVendorBill;
}

/** Received value (cents) on a PO — the 2-way match basis (F080). */
async function poReceivedValue(trx: Knex.Transaction, tenant: string, poId: string): Promise<number> {
  const rows = await trx('purchase_order_lines').where({ tenant, po_id: poId }).select('unit_cost', 'quantity_received');
  return rows.reduce((s: number, l: any) => s + Number(l.unit_cost) * Number(l.quantity_received), 0);
}

export const listVendorBills = withAuth(
  async (
    user,
    { tenant },
    filter?: { vendor_id?: string; status?: VendorBillStatus },
  ): Promise<Array<IVendorBill & { vendor_name: string | null; po_number: string | null }>> => {
    await requireBillPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const q = trx('vendor_bills as vb')
        .leftJoin('vendors as v', function () {
          this.on('v.vendor_id', '=', 'vb.vendor_id').andOn('v.tenant', '=', 'vb.tenant');
        })
        .leftJoin('purchase_orders as po', function () {
          this.on('po.po_id', '=', 'vb.po_id').andOn('po.tenant', '=', 'vb.tenant');
        })
        .where('vb.tenant', tenant)
        .orderBy('vb.bill_date', 'desc')
        .select('vb.*', 'v.vendor_name', 'po.po_number');
      if (filter?.vendor_id) q.andWhere('vb.vendor_id', filter.vendor_id);
      if (filter?.status) q.andWhere('vb.status', filter.status);
      return (await q) as any;
    });
  },
);

export interface VendorBillView extends IVendorBill {
  vendor_name: string | null;
  po_number: string | null;
  lines: Array<IVendorBillLine & { service_name: string | null }>;
  /** Bill total minus the PO's received value (cents); null without a PO (F080). */
  variance_vs_received_cents: number | null;
}

export const getVendorBill = withAuth(
  async (user, { tenant }, billId: string): Promise<VendorBillView> => {
    await requireBillPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const bill = await getBillOrThrow(trx, tenant, billId);
      const vendor = await trx('vendors').where({ tenant, vendor_id: bill.vendor_id }).first();
      const po = bill.po_id ? await trx('purchase_orders').where({ tenant, po_id: bill.po_id }).first() : null;
      const lines = (await trx('vendor_bill_lines as vbl')
        .leftJoin('service_catalog as sc', function () {
          this.on('sc.service_id', '=', 'vbl.service_id').andOn('sc.tenant', '=', 'vbl.tenant');
        })
        .where({ 'vbl.tenant': tenant, 'vbl.bill_id': billId })
        .orderBy('vbl.created_at', 'asc')
        .select('vbl.*', 'sc.service_name')) as any[];
      const variance = bill.po_id
        ? Number(bill.total_amount) - (await poReceivedValue(trx, tenant, bill.po_id))
        : null;
      return {
        ...(bill as IVendorBill),
        vendor_name: vendor?.vendor_name ?? null,
        po_number: po?.po_number ?? null,
        lines,
        variance_vs_received_cents: variance,
      };
    });
  },
);

export const createVendorBill = withAuth(
  async (
    user,
    { tenant },
    input: {
      vendor_id: string;
      bill_number: string;
      po_id?: string | null;
      bill_date?: string | Date | null;
      due_date?: string | Date | null;
      notes?: string | null;
      lines?: Array<{ service_id?: string | null; description?: string | null; quantity: number; unit_cost: number }>;
    },
  ): Promise<IVendorBill> => {
    await requireBillPerm(user, 'create');
    if (!input.vendor_id) throw new Error('vendor_id is required');
    const billNumber = (input.bill_number ?? '').trim();
    if (!billNumber) throw new Error('bill_number is required');

    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const vendor = await trx('vendors').where({ tenant, vendor_id: input.vendor_id }).first();
      if (!vendor) throw new Error('Vendor not found');

      const billDate = input.bill_date ? new Date(input.bill_date) : new Date();
      // Due date defaults from the vendor's payment terms (F079).
      const dueDate = input.due_date
        ? new Date(input.due_date)
        : new Date(billDate.getTime() + termsToDays(vendor.payment_terms) * 24 * 60 * 60 * 1000);

      const currency = (await (input.po_id
        ? trx('purchase_orders').where({ tenant, po_id: input.po_id }).first()
        : Promise.resolve(null)))?.currency_code ?? 'USD';

      const lines = (input.lines ?? []).map((l) => {
        const quantity = Number(l.quantity);
        const unitCost = Number(l.unit_cost);
        if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Line quantity must be a positive integer');
        if (!Number.isInteger(unitCost) || unitCost < 0) throw new Error('Line unit_cost must be non-negative cents');
        return { ...l, quantity, unit_cost: unitCost, amount: quantity * unitCost };
      });
      const total = lines.reduce((s, l) => s + l.amount, 0);

      const [bill] = await trx('vendor_bills')
        .insert({
          tenant,
          vendor_id: input.vendor_id,
          po_id: input.po_id ?? null,
          bill_number: billNumber,
          bill_date: billDate.toISOString(),
          due_date: dueDate.toISOString(),
          currency_code: currency,
          status: 'draft',
          total_amount: total,
          notes: input.notes ?? null,
          created_by: user.user_id,
        })
        .returning('*');

      for (const l of lines) {
        await trx('vendor_bill_lines').insert({
          tenant,
          bill_id: (bill as IVendorBill).bill_id,
          service_id: l.service_id ?? null,
          description: l.description ?? null,
          quantity: l.quantity,
          unit_cost: l.unit_cost,
          amount: l.amount,
        });
      }
      return bill as IVendorBill;
    });
  },
);

/** Prefill a bill from a PO's received quantities and costs (F078). */
export const createBillFromPo = withAuth(
  async (user, { tenant }, poId: string, billNumber: string): Promise<IVendorBill> => {
    await requireBillPerm(user, 'create');
    const { knex: db } = await createTenantKnex();
    const prefill = await withTransaction(db, async (trx: Knex.Transaction) => {
      const po = await trx('purchase_orders').where({ tenant, po_id: poId }).first();
      if (!po) throw new Error('Purchase order not found');
      const lines = (await trx('purchase_order_lines')
        .where({ tenant, po_id: poId })
        .andWhere('quantity_received', '>', 0)) as any[];
      if (lines.length === 0) throw new Error('Nothing received on this purchase order yet');
      return {
        vendor_id: po.vendor_id as string,
        lines: lines.map((l) => ({
          service_id: l.service_id as string,
          quantity: Number(l.quantity_received),
          unit_cost: Number(l.unit_cost),
        })),
      };
    });
    return (createVendorBill as any)({
      vendor_id: prefill.vendor_id,
      bill_number: billNumber,
      po_id: poId,
      lines: prefill.lines,
    });
  },
);

const TRANSITIONS: Record<VendorBillStatus, VendorBillStatus[]> = {
  draft: ['open', 'void'],
  open: ['paid', 'void'],
  paid: [],
  void: [],
};

export const setVendorBillStatus = withAuth(
  async (user, { tenant }, billId: string, status: VendorBillStatus): Promise<IVendorBill> => {
    await requireBillPerm(user, 'update');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const bill = await getBillOrThrow(trx, tenant, billId, { forUpdate: true });
      if (!TRANSITIONS[bill.status]?.includes(status)) {
        throw new Error(`Cannot move a ${bill.status} bill to ${status}`);
      }
      const [row] = await trx('vendor_bills')
        .where({ tenant, bill_id: billId })
        .update({
          status,
          ...(status === 'paid' ? { paid_at: trx.fn.now() } : {}),
          updated_at: trx.fn.now(),
        })
        .returning('*');
      return row as IVendorBill;
    });
  },
);

export interface VendorBillAgingRow {
  bill_id: string;
  vendor_name: string | null;
  bill_number: string;
  due_date: string | Date | null;
  total_amount: number;
  currency_code: string;
  /** Negative = not yet due; positive = days overdue. */
  days_overdue: number;
}

/** Open bills with aging for the dashboard widget (F082). */
export const openVendorBillsAging = withAuth(
  async (user, { tenant }): Promise<VendorBillAgingRow[]> => {
    await requireBillPerm(user, 'read');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      const rows = (await trx('vendor_bills as vb')
        .leftJoin('vendors as v', function () {
          this.on('v.vendor_id', '=', 'vb.vendor_id').andOn('v.tenant', '=', 'vb.tenant');
        })
        .where({ 'vb.tenant': tenant })
        .whereIn('vb.status', ['draft', 'open'])
        .orderBy('vb.due_date', 'asc')
        .select('vb.bill_id', 'v.vendor_name', 'vb.bill_number', 'vb.due_date', 'vb.total_amount', 'vb.currency_code')) as any[];
      const now = Date.now();
      return rows.map((r) => ({
        bill_id: r.bill_id,
        vendor_name: r.vendor_name ?? null,
        bill_number: r.bill_number,
        due_date: r.due_date ?? null,
        total_amount: Number(r.total_amount),
        currency_code: r.currency_code,
        days_overdue: r.due_date ? Math.floor((now - new Date(r.due_date).getTime()) / 86_400_000) : 0,
      }));
    });
  },
);
