'use server';

import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type {
  ClientEquipmentRow,
  ClientRmaRow,
  ClientSalesOrderSummary,
} from '../lib/integrationTypes';

export type {
  ClientEquipmentRow,
  ClientRmaRow,
  ClientSalesOrderSummary,
} from '../lib/integrationTypes';

// NOTE: asset provenance (F024) lives in packages/assets (assets cannot import inventory —
// inventory already imports @alga-psa/assets/actions in lib/assetLink.ts).

const toIso = (value: unknown): string | null =>
  value ? new Date(value as string | number | Date).toISOString() : null;

/**
 * Whether the current user may read inventory data — used to gate the client
 * Equipment tab (F023) so it stays hidden entirely, not just empty, without the
 * permission. The three list actions below independently return [] when denied.
 */
export const hasInventoryReadAccess = withAuth(async (
  user,
  _ctx
): Promise<boolean> => {
  return hasPermission(user, 'inventory', 'read');
});

/** Sales orders for a client, newest first (F019). Requires inventory:read. */
export const listClientSalesOrders = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<ClientSalesOrderSummary[]> => {
  if (!(await hasPermission(user, 'inventory', 'read'))) return [];
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const rows = await trx('sales_orders as so')
      .leftJoin('sales_order_lines as sol', function () {
        this.on('sol.so_id', '=', 'so.so_id').andOn('sol.tenant', '=', 'so.tenant');
      })
      .where({ 'so.tenant': tenant, 'so.client_id': clientId })
      .groupBy('so.so_id', 'so.so_number', 'so.status', 'so.order_date', 'so.currency_code', 'so.created_at')
      .select(
        'so.so_id as so_id',
        'so.so_number as so_number',
        'so.status as status',
        'so.order_date as order_date',
        'so.currency_code as currency_code',
        trx.raw('COALESCE(SUM(sol.quantity_ordered * sol.unit_price), 0) as total_amount'),
        trx.raw('COUNT(sol.so_line_id) as line_count'),
      )
      .orderByRaw('so.order_date DESC NULLS LAST')
      .orderBy('so.created_at', 'desc');

    return rows.map((r: any): ClientSalesOrderSummary => ({
      so_id: r.so_id,
      so_number: r.so_number,
      status: r.status,
      order_date: toIso(r.order_date),
      currency_code: r.currency_code,
      total_amount: Number(r.total_amount ?? 0),
      line_count: Number(r.line_count ?? 0),
    }));
  });
});

/** Delivered/owned serialized equipment for a client (F020). Requires inventory:read. */
export const listClientEquipment = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<ClientEquipmentRow[]> => {
  if (!(await hasPermission(user, 'inventory', 'read'))) return [];
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const rows = await trx('stock_units as u')
      .join('service_catalog as sc', function () {
        this.on('sc.service_id', '=', 'u.service_id').andOn('sc.tenant', '=', 'u.tenant');
      })
      .where({ 'u.tenant': tenant, 'u.client_id': clientId, 'u.status': 'delivered' })
      .select(
        'u.unit_id as unit_id',
        'u.service_id as service_id',
        'sc.service_name as service_name',
        'sc.sku as sku',
        'u.serial_number as serial_number',
        'u.mac_address as mac_address',
        'u.status as status',
        'u.delivered_at as delivered_at',
        'u.asset_id as asset_id',
      )
      .orderByRaw('u.delivered_at DESC NULLS LAST');

    return rows.map((r: any): ClientEquipmentRow => ({
      unit_id: r.unit_id,
      service_id: r.service_id,
      service_name: r.service_name,
      sku: r.sku ?? null,
      serial_number: r.serial_number ?? null,
      mac_address: r.mac_address ?? null,
      status: r.status,
      delivered_at: toIso(r.delivered_at),
      asset_id: r.asset_id ?? null,
    }));
  });
});

/** RMAs for a client with unit/product context (F021). Requires inventory:read. */
export const listClientRmas = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<ClientRmaRow[]> => {
  if (!(await hasPermission(user, 'inventory', 'read'))) return [];
  const { knex: db } = await createTenantKnex();
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const rows = await trx('rma_cases as r')
      .leftJoin('service_catalog as sc', function () {
        this.on('sc.service_id', '=', 'r.service_id').andOn('sc.tenant', '=', 'r.tenant');
      })
      .leftJoin('stock_units as u', function () {
        this.on('u.unit_id', '=', 'r.returned_unit_id').andOn('u.tenant', '=', 'r.tenant');
      })
      .where({ 'r.tenant': tenant, 'r.client_id': clientId })
      .select(
        'r.rma_id as rma_id',
        'r.rma_reference as rma_number',
        'r.status as status',
        'r.created_at as created_at',
        'sc.service_name as service_name',
        'u.serial_number as serial_number',
      )
      .orderBy('r.created_at', 'desc');

    return rows.map((r: any): ClientRmaRow => ({
      rma_id: r.rma_id,
      rma_number: r.rma_number ?? null,
      status: r.status,
      created_at: toIso(r.created_at) ?? new Date(0).toISOString(),
      service_name: r.service_name ?? null,
      serial_number: r.serial_number ?? null,
    }));
  });
});
