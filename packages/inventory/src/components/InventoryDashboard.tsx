'use client';

import React from 'react';
import type {
  InventoryValueReport,
  OpenPosWidget,
  OpenSosWidget,
  ExpiringWarrantyRow,
} from '../actions/inventoryReportingActions';
import type { LowStockRow } from '../actions/reorderActions';
import type { DeadUnitOwedRow } from '../actions/rmaActions';

interface InventoryDashboardProps {
  initialInventoryValue: InventoryValueReport;
  initialLowStock: LowStockRow[];
  initialOpenPos: OpenPosWidget;
  initialOpenSos: OpenSosWidget;
  initialDeadUnitsOwed: DeadUnitOwedRow[];
  initialExpiringWarranties: ExpiringWarrantyRow[];
}

/** Integer cents → "$1,234.56" */
function formatCents(cents: number): string {
  return `$${(Number(cents || 0) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function Widget({
  id,
  title,
  figure,
  href,
  children,
}: {
  id: string;
  title: string;
  figure: React.ReactNode;
  href?: string;
  children?: React.ReactNode;
}) {
  return (
    <div id={id} className="border rounded-lg p-4 bg-white shadow-sm space-y-3 flex flex-col">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-500">{title}</h2>
        {href ? (
          <a id={`${id}-link`} href={href} className="text-xs text-blue-600 hover:underline">
            View
          </a>
        ) : null}
      </div>
      <div className="text-3xl font-semibold" id={`${id}-figure`}>
        {figure}
      </div>
      {children ? <div className="text-sm text-gray-600 space-y-1">{children}</div> : null}
    </div>
  );
}

export function InventoryDashboard({
  initialInventoryValue,
  initialLowStock,
  initialOpenPos,
  initialOpenSos,
  initialDeadUnitsOwed,
  initialExpiringWarranties,
}: InventoryDashboardProps) {
  const inventoryValue = initialInventoryValue || { by_location: [], grand_total: 0 };
  const lowStock = initialLowStock || [];
  const openPos = initialOpenPos || { count: 0, purchase_orders: [] };
  const openSos = initialOpenSos || { count: 0, sales_orders: [] };
  const deadUnitsOwed = initialDeadUnitsOwed || [];
  const expiringWarranties = initialExpiringWarranties || [];

  return (
    <div className="p-6 space-y-4" id="inventory-dashboard-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Inventory</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="inventory-dashboard-grid">
        <Widget
          id="widget-inventory-value"
          title="Total Inventory Value"
          figure={formatCents(inventoryValue.grand_total)}
        >
          {inventoryValue.by_location.slice(0, 5).map((loc) => (
            <div key={loc.location_id} className="flex justify-between">
              <span className="truncate pr-2">{loc.location_name}</span>
              <span className="tabular-nums">{formatCents(loc.total_value)}</span>
            </div>
          ))}
          {inventoryValue.by_location.length === 0 ? (
            <div className="text-gray-400">No stock on hand</div>
          ) : null}
        </Widget>

        <Widget
          id="widget-low-stock"
          title="Low-Stock Items"
          figure={lowStock.length}
          href="/msp/inventory/reorder"
        >
          {lowStock.slice(0, 5).map((r) => (
            <div key={`${r.service_id}-${r.location_id}`} className="flex justify-between">
              <span className="truncate pr-2">{r.service_name ?? r.sku ?? r.service_id}</span>
              <span className="tabular-nums">
                {r.available} / {r.reorder_point}
              </span>
            </div>
          ))}
          {lowStock.length === 0 ? <div className="text-gray-400">Nothing below reorder point</div> : null}
        </Widget>

        <Widget id="widget-open-pos" title="Open Purchase Orders" figure={openPos.count} href="/msp/inventory/purchase-orders">
          {openPos.purchase_orders.slice(0, 5).map((po) => (
            <div key={po.po_id} className="flex justify-between">
              <span className="truncate pr-2">{po.po_number}</span>
              <span className="text-gray-500">{po.status}</span>
            </div>
          ))}
          {openPos.count === 0 ? <div className="text-gray-400">No open purchase orders</div> : null}
        </Widget>

        <Widget id="widget-open-sos" title="Open Sales Orders" figure={openSos.count} href="/msp/inventory/sales-orders">
          {openSos.sales_orders.slice(0, 5).map((so) => (
            <div key={so.so_id} className="flex justify-between">
              <span className="truncate pr-2">{so.so_number}</span>
              <span className="text-gray-500">{so.status}</span>
            </div>
          ))}
          {openSos.count === 0 ? <div className="text-gray-400">No open sales orders</div> : null}
        </Widget>

        <Widget id="widget-dead-units-owed" title="Dead Units Owed" figure={deadUnitsOwed.length} href="/msp/inventory/rma">
          {deadUnitsOwed.slice(0, 5).map((r) => (
            <div key={r.rma_id} className="flex justify-between">
              <span className="truncate pr-2">{r.rma_reference ?? r.rma_id}</span>
              <span className="tabular-nums text-gray-500">
                {r.days_remaining == null ? '—' : `${r.days_remaining}d`}
              </span>
            </div>
          ))}
          {deadUnitsOwed.length === 0 ? <div className="text-gray-400">No dead units owed</div> : null}
        </Widget>

        <Widget id="widget-expiring-warranties" title="Expiring Warranties (30d)" figure={expiringWarranties.length}>
          {expiringWarranties.slice(0, 5).map((u) => (
            <div key={u.unit_id} className="flex justify-between">
              <span className="truncate pr-2">{u.service_name ?? u.serial_number}</span>
              <span className="tabular-nums text-gray-500">
                {new Date(u.warranty_expires_at).toLocaleDateString()}
              </span>
            </div>
          ))}
          {expiringWarranties.length === 0 ? (
            <div className="text-gray-400">No warranties expiring soon</div>
          ) : null}
        </Widget>
      </div>
    </div>
  );
}
