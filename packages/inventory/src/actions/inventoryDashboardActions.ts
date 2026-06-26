'use server';

import { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';

/**
 * Consolidated data feed for the Inventory dashboard ("Command Center").
 * One permission check, one transaction. All monetary values are integer cents.
 * See docs/plans/2026-06-26-inventory-module-design.md §10/§11.
 */

export type AttentionSeverity = 'red' | 'amber' | 'info';
export type AttentionIcon = 'package' | 'rma' | 'po' | 'warranty' | 'so';

export interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  icon: AttentionIcon;
  title: string;
  subtitle: string;
  badge: { label: string; tone: 'err' | 'warn' | 'info' };
  action: { label: string; href: string; primary?: boolean };
}

export interface ReceivingPo {
  po_id: string;
  po_number: string;
  vendor_name: string | null;
  status: string;
  ordered: number;
  received: number;
  total_value: number;
  outstanding_value: number;
  eta_label: string | null;
}

export interface DashboardMovement {
  movement_id: string;
  movement_type: string;
  service_name: string | null;
  serial_number: string | null;
  quantity: number;
  from_location_name: string | null;
  to_location_name: string | null;
  source_doc_type: string | null;
  performed_by_name: string | null;
  created_at: string | Date;
}

export interface DashboardLocationValue {
  location_id: string;
  location_name: string;
  location_type: string;
  total_value: number;
}

export interface InventoryDashboardData {
  location_count: number;
  van_count: number;
  inventory_value: { by_location: DashboardLocationValue[]; grand_total: number };
  on_hand: { total_units: number; serialized_units: number };
  on_order: { open_po_count: number; on_order_value: number; arriving_today: number };
  margin_mtd: { revenue: number; cogs: number; margin: number; margin_pct: number };
  this_week: { received: number; deployed: number; transfers: number; rmas_opened: number };
  attention: AttentionItem[];
  receiving_queue: ReceivingPo[];
  recent_movements: DashboardMovement[];
}

const OPEN_PO_STATUSES = ['draft', 'open', 'partially_received'];

function etaLabel(expected: Date | string | null | undefined): string | null {
  if (!expected) return null;
  const d = new Date(expected);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  const days = Math.round((d.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'ETA today';
  if (days === 1) return 'ETA tomorrow';
  return `ETA ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export const getInventoryDashboardData = withAuth(async (user, { tenant }): Promise<InventoryDashboardData> => {
  if (!(await hasPermission(user, 'inventory', 'read'))) {
    throw new Error('Permission denied: inventory read required');
  }
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const locations = await trx('stock_locations')
      .where({ tenant, is_active: true })
      .select<{ location_id: string; name: string; location_type: string }[]>('location_id', 'name', 'location_type');
    const nameById = new Map(locations.map((l) => [l.location_id, l.name]));
    const typeById = new Map(locations.map((l) => [l.location_id, l.location_type]));
    const van_count = locations.filter((l) => l.location_type === 'van').length;

    // ---- Inventory value by location (non-serialized avg_cost + serialized unit_cost) ----
    const valueByLocation = new Map<string, number>();
    const nonSer = await trx('stock_levels as sl')
      .join('product_inventory_settings as pis', function () {
        this.on('sl.service_id', '=', 'pis.service_id').andOn('sl.tenant', '=', 'pis.tenant');
      })
      .where({ 'sl.tenant': tenant, 'pis.is_serialized': false })
      .andWhere('sl.quantity_on_hand', '>', 0)
      .groupBy('sl.location_id')
      .select<{ location_id: string; value: string }[]>(
        'sl.location_id as location_id',
        trx.raw('SUM(sl.quantity_on_hand * COALESCE(pis.average_cost, 0)) as value'),
      );
    for (const r of nonSer) valueByLocation.set(r.location_id, (valueByLocation.get(r.location_id) ?? 0) + Number(r.value ?? 0));

    const ser = await trx('stock_units')
      .where({ tenant, status: 'in_stock' })
      .whereNotNull('location_id')
      .groupBy('location_id')
      .select<{ location_id: string; value: string }[]>('location_id', trx.raw('SUM(COALESCE(unit_cost,0)) as value'));
    for (const r of ser) valueByLocation.set(r.location_id, (valueByLocation.get(r.location_id) ?? 0) + Number(r.value ?? 0));

    const by_location: DashboardLocationValue[] = [...valueByLocation.entries()]
      .map(([location_id, total_value]) => ({
        location_id,
        location_name: nameById.get(location_id) ?? location_id,
        location_type: typeById.get(location_id) ?? 'other',
        total_value: Math.round(total_value),
      }))
      .sort((a, b) => b.total_value - a.total_value);
    const grand_total = by_location.reduce((s, r) => s + r.total_value, 0);

    // ---- On-hand units ----
    const onHandRow = await trx('stock_levels').where({ tenant }).sum<{ s: string }>('quantity_on_hand as s').first();
    const serRow = await trx('stock_units').where({ tenant, status: 'in_stock' }).count<{ c: string }>('* as c').first();
    const total_units = Number(onHandRow?.s ?? 0);
    const serialized_units = Number(serRow?.c ?? 0);

    // ---- Open POs + receiving queue ----
    const poRows = await trx('purchase_orders as po')
      .leftJoin('vendors as v', function () {
        this.on('po.vendor_id', '=', 'v.vendor_id').andOn('po.tenant', '=', 'v.tenant');
      })
      .leftJoin('purchase_order_lines as l', function () {
        this.on('po.po_id', '=', 'l.po_id').andOn('po.tenant', '=', 'l.tenant');
      })
      .where({ 'po.tenant': tenant })
      .whereIn('po.status', OPEN_PO_STATUSES)
      .groupBy('po.po_id', 'po.po_number', 'po.status', 'po.expected_date', 'po.order_date', 'v.vendor_name')
      .orderBy('po.order_date', 'desc')
      .select<any[]>(
        'po.po_id as po_id',
        'po.po_number as po_number',
        'po.status as status',
        'po.expected_date as expected_date',
        'v.vendor_name as vendor_name',
        trx.raw('COALESCE(SUM(l.quantity_ordered),0) as ordered'),
        trx.raw('COALESCE(SUM(l.quantity_received),0) as received'),
        trx.raw('COALESCE(SUM(l.quantity_ordered * l.unit_cost),0) as total_value'),
        trx.raw('COALESCE(SUM((l.quantity_ordered - l.quantity_received) * l.unit_cost),0) as outstanding_value'),
      );
    const receiving_queue: ReceivingPo[] = poRows.map((r) => ({
      po_id: r.po_id,
      po_number: r.po_number,
      vendor_name: r.vendor_name ?? null,
      status: r.status,
      ordered: Number(r.ordered),
      received: Number(r.received),
      total_value: Number(r.total_value),
      outstanding_value: Number(r.outstanding_value),
      eta_label: etaLabel(r.expected_date),
    }));
    const on_order_value = receiving_queue.reduce((s, r) => s + r.outstanding_value, 0);
    const arriving_today = receiving_queue.filter((r) => r.eta_label === 'ETA today').length;

    // ---- Margin (month to date) ----
    const marginRow = await trx('stock_movements as sm')
      .leftJoin('sales_order_lines as sol', function () {
        this.on('sm.source_doc_id', '=', 'sol.so_line_id').andOn('sm.tenant', '=', 'sol.tenant');
      })
      .where({ 'sm.tenant': tenant, 'sm.movement_type': 'consume', 'sm.source_doc_type': 'sales_order' })
      .andWhereRaw("sm.created_at >= date_trunc('month', now())")
      .select<{ revenue: string; cogs: string }[]>(
        trx.raw('COALESCE(SUM(sm.quantity * COALESCE(sol.unit_price,0)),0) as revenue'),
        trx.raw('COALESCE(SUM(COALESCE(sm.cogs_cost,0)),0) as cogs'),
      )
      .first();
    const revenue = Math.round(Number(marginRow?.revenue ?? 0));
    const cogs = Math.round(Number(marginRow?.cogs ?? 0));
    const margin = revenue - cogs;
    const margin_pct = revenue > 0 ? (margin / revenue) * 100 : 0;

    // ---- This week (trailing 7 days) ----
    const wk = await trx('stock_movements')
      .where({ tenant })
      .andWhereRaw("created_at >= now() - interval '7 days'")
      .select<{ received: string; deployed: string; transfers: string }[]>(
        trx.raw("COALESCE(SUM(quantity) FILTER (WHERE movement_type='receipt'),0) as received"),
        trx.raw("COALESCE(SUM(quantity) FILTER (WHERE movement_type='consume'),0) as deployed"),
        trx.raw("COUNT(*) FILTER (WHERE movement_type='transfer_out') as transfers"),
      )
      .first();
    const rmaWkRow = await trx('rma_cases')
      .where({ tenant })
      .andWhereRaw("opened_at >= now() - interval '7 days'")
      .count<{ c: string }>('* as c')
      .first();
    const this_week = {
      received: Number(wk?.received ?? 0),
      deployed: Number(wk?.deployed ?? 0),
      transfers: Number(wk?.transfers ?? 0),
      rmas_opened: Number(rmaWkRow?.c ?? 0),
    };

    // ---- Attention worklist ----
    const attention: AttentionItem[] = [];

    // Low / out of stock
    const lowRows = await trx('stock_levels as sl')
      .join('product_inventory_settings as pis', function () {
        this.on('sl.service_id', '=', 'pis.service_id').andOn('sl.tenant', '=', 'pis.tenant');
      })
      .join('service_catalog as sc', function () {
        this.on('sl.service_id', '=', 'sc.service_id').andOn('sl.tenant', '=', 'sc.tenant');
      })
      .leftJoin('stock_locations as loc', function () {
        this.on('sl.location_id', '=', 'loc.location_id').andOn('sl.tenant', '=', 'loc.tenant');
      })
      .where({ 'sl.tenant': tenant, 'pis.track_stock': true })
      .whereRaw('COALESCE(sl.reorder_point, pis.reorder_point) IS NOT NULL')
      .whereRaw('(sl.quantity_on_hand - sl.reserved_quantity - sl.held_quantity) <= COALESCE(sl.reorder_point, pis.reorder_point)')
      .select<any[]>(
        'sc.service_name as service_name',
        'loc.name as location_name',
        trx.raw('(sl.quantity_on_hand - sl.reserved_quantity - sl.held_quantity) as available'),
        trx.raw('COALESCE(sl.reorder_point, pis.reorder_point) as reorder_point'),
        'sl.service_id as service_id',
        'sl.location_id as location_id',
      )
      .orderByRaw('(sl.quantity_on_hand - sl.reserved_quantity - sl.held_quantity) asc');
    for (const r of lowRows) {
      const avail = Number(r.available);
      const out = avail <= 0;
      attention.push({
        id: `low-${r.service_id}-${r.location_id}`,
        severity: out ? 'red' : 'amber',
        icon: 'package',
        title: out ? `${r.service_name} — out of stock` : `${r.service_name} — below reorder point`,
        subtitle: `${avail} on hand of ${r.reorder_point} · ${r.location_name ?? 'Unassigned'}`,
        badge: out ? { label: 'Out of stock', tone: 'err' } : { label: `Low: ${avail} / ${r.reorder_point}`, tone: 'warn' },
        action: { label: out ? 'Create PO' : 'Reorder', href: '/msp/inventory/purchase-orders', primary: out },
      });
    }

    // Dead units owed
    const deadRows = await trx('rma_cases as r')
      .leftJoin('clients as c', function () {
        this.on('r.client_id', '=', 'c.client_id').andOn('r.tenant', '=', 'c.tenant');
      })
      .leftJoin('service_catalog as sc', function () {
        this.on('r.service_id', '=', 'sc.service_id').andOn('r.tenant', '=', 'sc.tenant');
      })
      .where({ 'r.tenant': tenant, 'r.status': 'dead_unit_owed' })
      .select<any[]>(
        'r.rma_id as rma_id',
        'r.rma_reference as rma_reference',
        'r.dead_unit_due_date as due',
        'c.client_name as client_name',
        'sc.service_name as service_name',
      )
      .orderBy('r.dead_unit_due_date', 'asc');
    for (const r of deadRows) {
      let daysRemaining: number | null = null;
      if (r.due) daysRemaining = Math.ceil((new Date(r.due).getTime() - Date.now()) / 86_400_000);
      const overdue = daysRemaining != null && daysRemaining < 0;
      const urgent = daysRemaining != null && daysRemaining <= 2;
      attention.push({
        id: `rma-${r.rma_id}`,
        severity: overdue || urgent ? 'red' : 'amber',
        icon: 'rma',
        title: `${r.rma_reference ?? 'RMA'} · ${r.service_name ?? 'unit'} owed to ${r.client_name ?? 'client'}`,
        subtitle: 'Advance-replaced · dead unit return outstanding',
        badge: overdue
          ? { label: `${Math.abs(daysRemaining!)}d overdue`, tone: 'err' }
          : { label: daysRemaining == null ? 'No due date' : `${daysRemaining} days`, tone: urgent ? 'err' : 'warn' },
        action: { label: 'Ship replacement', href: '/msp/inventory/rma' },
      });
    }

    // Partially-received POs
    for (const po of receiving_queue.filter((p) => p.status === 'partially_received')) {
      attention.push({
        id: `po-${po.po_id}`,
        severity: 'amber',
        icon: 'po',
        title: `${po.po_number} · ${po.vendor_name ?? 'vendor'} — partial delivery`,
        subtitle: `${po.received} of ${po.ordered} received · ${po.ordered - po.received} outstanding`,
        badge: { label: 'Partially received', tone: 'warn' },
        action: { label: 'Receive', href: '/msp/inventory/purchase-orders' },
      });
    }

    // Expiring warranties (30d)
    const warrRow = await trx('stock_units')
      .where({ tenant })
      .whereNotNull('warranty_expires_at')
      .whereNot('status', 'retired')
      .andWhereRaw("warranty_expires_at <= now() + interval '30 days'")
      .count<{ c: string }>('* as c')
      .first();
    const warrCount = Number(warrRow?.c ?? 0);
    if (warrCount > 0) {
      attention.push({
        id: 'warranties',
        severity: 'amber',
        icon: 'warranty',
        title: `${warrCount} warrant${warrCount === 1 ? 'y expires' : 'ies expire'} within 30 days`,
        subtitle: 'Review deployed and in-stock units before coverage lapses',
        badge: { label: 'Review', tone: 'warn' },
        action: { label: 'View units', href: '/msp/inventory/units' },
      });
    }

    // Sales orders ready to invoice (fulfilled but not fully invoiced)
    const soRows = await trx('sales_orders as so')
      .leftJoin('clients as c', function () {
        this.on('so.client_id', '=', 'c.client_id').andOn('so.tenant', '=', 'c.tenant');
      })
      .leftJoin('sales_order_lines as l', function () {
        this.on('so.so_id', '=', 'l.so_id').andOn('so.tenant', '=', 'l.tenant');
      })
      .where({ 'so.tenant': tenant, 'so.status': 'fulfilled' })
      .groupBy('so.so_id', 'so.so_number', 'so.order_date', 'c.client_name')
      .havingRaw('COALESCE(SUM(l.quantity_fulfilled - l.quantity_invoiced),0) > 0')
      .select<any[]>(
        'so.so_id as so_id',
        'so.so_number as so_number',
        'c.client_name as client_name',
        trx.raw('COALESCE(SUM((l.quantity_fulfilled - l.quantity_invoiced) * l.unit_price),0) as uninvoiced_value'),
      )
      .orderBy('so.order_date', 'desc');
    for (const so of soRows) {
      const val = Number(so.uninvoiced_value);
      attention.push({
        id: `so-${so.so_id}`,
        severity: 'info',
        icon: 'so',
        title: `${so.so_number} · ${so.client_name ?? 'client'} — fulfilled`,
        subtitle: `All lines shipped · ready to invoice ($${(val / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })})`,
        badge: { label: 'Ready to invoice', tone: 'info' },
        action: { label: 'Invoice', href: '/msp/inventory/sales-orders', primary: true },
      });
    }

    const sevRank: Record<AttentionSeverity, number> = { red: 0, amber: 1, info: 2 };
    attention.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

    // ---- Recent movements ----
    const fromLoc = trx.ref('from_loc.name');
    const movements = await trx('stock_movements as sm')
      .leftJoin('service_catalog as sc', function () {
        this.on('sm.service_id', '=', 'sc.service_id').andOn('sm.tenant', '=', 'sc.tenant');
      })
      .leftJoin('stock_units as su', function () {
        this.on('sm.unit_id', '=', 'su.unit_id').andOn('sm.tenant', '=', 'su.tenant');
      })
      .leftJoin('stock_locations as from_loc', function () {
        this.on('sm.from_location_id', '=', 'from_loc.location_id').andOn('sm.tenant', '=', 'from_loc.tenant');
      })
      .leftJoin('stock_locations as to_loc', function () {
        this.on('sm.to_location_id', '=', 'to_loc.location_id').andOn('sm.tenant', '=', 'to_loc.tenant');
      })
      .leftJoin('users as u', function () {
        this.on('sm.performed_by', '=', 'u.user_id').andOn('sm.tenant', '=', 'u.tenant');
      })
      .where({ 'sm.tenant': tenant })
      .orderBy('sm.created_at', 'desc')
      .limit(6)
      .select<any[]>(
        'sm.movement_id as movement_id',
        'sm.movement_type as movement_type',
        'sm.quantity as quantity',
        'sm.source_doc_type as source_doc_type',
        'sm.created_at as created_at',
        'sc.service_name as service_name',
        'su.serial_number as serial_number',
        fromLoc.as('from_location_name'),
        'to_loc.name as to_location_name',
        trx.raw("NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), '') as performed_by_name"),
      );
    const recent_movements: DashboardMovement[] = movements.map((m) => ({
      movement_id: m.movement_id,
      movement_type: m.movement_type,
      service_name: m.service_name ?? null,
      serial_number: m.serial_number ?? null,
      quantity: Number(m.quantity),
      from_location_name: m.from_location_name ?? null,
      to_location_name: m.to_location_name ?? null,
      source_doc_type: m.source_doc_type ?? null,
      performed_by_name: m.performed_by_name ?? null,
      created_at: m.created_at,
    }));

    return {
      location_count: locations.length,
      van_count,
      inventory_value: { by_location, grand_total },
      on_hand: { total_units, serialized_units },
      on_order: { open_po_count: receiving_queue.length, on_order_value, arriving_today },
      margin_mtd: { revenue, cogs, margin, margin_pct },
      this_week,
      attention,
      receiving_queue,
      recent_movements,
    };
  });
});
