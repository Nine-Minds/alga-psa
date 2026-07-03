'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Badge } from '@alga-psa/ui/components/Badge';
import type { ColumnDefinition } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  listClientSalesOrders,
  listClientEquipment,
  listClientRmas,
} from '@alga-psa/inventory/actions';
import type {
  ClientSalesOrderSummary,
  ClientEquipmentRow,
  ClientRmaRow,
} from '@alga-psa/inventory/lib/integrationTypes';
import { SectionLoadError } from './SectionLoadError';

interface ClientEquipmentTabProps {
  clientId: string;
}

const shortDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';

const money = (cents: number, currency: string): string =>
  `${(Number(cents || 0) / 100).toLocaleString(undefined, { style: 'currency', currency: currency || 'USD' })}`;

// SO detail is a dialog inside SalesOrdersManager (no per-id route), so rows deep-link
// to the sales-orders list screen.
const SALES_ORDERS_HREF = '/msp/inventory/sales-orders';

/**
 * Client "Equipment" tab (F022): three sections — sales orders, delivered
 * equipment (linked to assets), and RMAs — sourced from the inventory module's
 * client-360 read actions. Each section loads independently so one empty/failed
 * query never blanks the others.
 */
export const ClientEquipmentTab: React.FC<ClientEquipmentTabProps> = ({ clientId }) => {
  const { t } = useTranslation('msp/clients');
  const [salesOrders, setSalesOrders] = useState<ClientSalesOrderSummary[]>([]);
  const [equipment, setEquipment] = useState<ClientEquipmentRow[]>([]);
  const [rmas, setRmas] = useState<ClientRmaRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Sections load independently; a failed query renders as a failure with a
  // retry, never as an empty state.
  const [soError, setSoError] = useState(false);
  const [equipmentError, setEquipmentError] = useState(false);
  const [rmaError, setRmaError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const retry = useCallback(() => setReloadNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [so, eq, rma] = await Promise.all([
        listClientSalesOrders(clientId).then(
          (rows) => ({ rows, failed: false }),
          () => ({ rows: [] as ClientSalesOrderSummary[], failed: true }),
        ),
        listClientEquipment(clientId).then(
          (rows) => ({ rows, failed: false }),
          () => ({ rows: [] as ClientEquipmentRow[], failed: true }),
        ),
        listClientRmas(clientId).then(
          (rows) => ({ rows, failed: false }),
          () => ({ rows: [] as ClientRmaRow[], failed: true }),
        ),
      ]);
      if (cancelled) return;
      setSalesOrders(so.rows);
      setSoError(so.failed);
      setEquipment(eq.rows);
      setEquipmentError(eq.failed);
      setRmas(rma.rows);
      setRmaError(rma.failed);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, reloadNonce]);

  const retryLabel = t('clientEquipmentTab.retry', { defaultValue: 'Retry' });
  const loadErrorMessage = t('clientEquipmentTab.loadError', { defaultValue: 'This section failed to load.' });

  const salesOrderColumns: ColumnDefinition<ClientSalesOrderSummary>[] = [
    {
      title: 'Number',
      dataIndex: 'so_number',
      render: (v: any) => (
        <Link href={SALES_ORDERS_HREF} className="text-primary-600 hover:underline font-medium tabular-nums">
          {v}
        </Link>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (v: any) => <Badge variant="secondary" size="sm">{String(v).replace(/_/g, ' ')}</Badge>,
    },
    { title: 'Date', dataIndex: 'order_date', render: (v: any) => shortDate(v) },
    {
      title: 'Total',
      dataIndex: 'total_amount',
      render: (_v: any, rec) => <span className="tabular-nums">{money(rec.total_amount, rec.currency_code)}</span>,
    },
  ];

  // The Asset link is the point of this table (unit → managed record), so it
  // carries an explicit width — width-bearing columns survive narrow
  // containers first (computeColumnFit). MAC was dropped: dead for most
  // categories while it cost the truncated Product column its space.
  const equipmentColumns: ColumnDefinition<ClientEquipmentRow>[] = [
    { title: 'Product', dataIndex: 'service_name', render: (v: any) => v || '—' },
    { title: 'SKU', dataIndex: 'sku', render: (v: any) => v || '—' },
    { title: 'Serial', dataIndex: 'serial_number', render: (v: any) => v || '—' },
    { title: 'Delivered', dataIndex: 'delivered_at', render: (v: any) => shortDate(v) },
    {
      title: 'Asset',
      dataIndex: 'asset_id',
      width: '110px',
      render: (v: any) =>
        v ? (
          <Link href={`/msp/assets/${v}`} className="text-primary-600 hover:underline">
            View asset
          </Link>
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
  ];

  const rmaColumns: ColumnDefinition<ClientRmaRow>[] = [
    { title: 'RMA', dataIndex: 'rma_number', render: (v: any) => v || '—' },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (v: any) => <Badge variant="secondary" size="sm">{String(v).replace(/_/g, ' ')}</Badge>,
    },
    { title: 'Product', dataIndex: 'service_name', render: (v: any) => v || '—' },
    { title: 'Serial', dataIndex: 'serial_number', render: (v: any) => v || '—' },
    { title: 'Opened', dataIndex: 'created_at', render: (v: any) => shortDate(v) },
  ];

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm space-y-8" id="client-equipment-tab">
      <section className="space-y-2" id="client-equipment-sales-orders">
        <h3 className="text-lg font-medium">Sales Orders</h3>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : soError ? (
          <SectionLoadError id="client-equipment-so-retry" message={loadErrorMessage} retryLabel={retryLabel} onRetry={retry} />
        ) : salesOrders.length === 0 ? (
          <p className="text-sm text-gray-500">No sales orders for this client.</p>
        ) : (
          <DataTable id="client-sales-orders-table" data={salesOrders} columns={salesOrderColumns} />
        )}
      </section>

      <section className="space-y-2" id="client-equipment-equipment">
        <h3 className="text-lg font-medium">Equipment</h3>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : equipmentError ? (
          <SectionLoadError id="client-equipment-eq-retry" message={loadErrorMessage} retryLabel={retryLabel} onRetry={retry} />
        ) : equipment.length === 0 ? (
          <p className="text-sm text-gray-500">No delivered equipment on record.</p>
        ) : (
          <DataTable id="client-equipment-table" data={equipment} columns={equipmentColumns} />
        )}
      </section>

      <section className="space-y-2" id="client-equipment-rmas">
        <h3 className="text-lg font-medium">RMAs</h3>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : rmaError ? (
          <SectionLoadError id="client-equipment-rma-retry" message={loadErrorMessage} retryLabel={retryLabel} onRetry={retry} />
        ) : rmas.length === 0 ? (
          <p className="text-sm text-gray-500">No RMAs for this client.</p>
        ) : (
          <DataTable id="client-rmas-table" data={rmas} columns={rmaColumns} />
        )}
      </section>
    </div>
  );
};

export default ClientEquipmentTab;
