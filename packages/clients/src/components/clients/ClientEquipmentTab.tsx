'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
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

const shortDate = (iso: string | null, emptyValue: string): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : emptyValue;

const money = (cents: number, currency: string): string =>
  `${(Number(cents || 0) / 100).toLocaleString(undefined, { style: 'currency', currency: currency || 'USD' })}`;

const capitalizeStatus = (status: string | null | undefined, emptyValue: string): string => {
  const value = String(status ?? '').replace(/_/g, ' ');
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : emptyValue;
};

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
  const emptyValue = t('clientEquipmentTab.emptyValue', { defaultValue: '—' });

  const salesOrderColumns: ColumnDefinition<ClientSalesOrderSummary>[] = [
    {
      title: t('clientEquipmentTab.orderNumber', { defaultValue: 'Order number' }),
      dataIndex: 'so_number',
      render: (v: string) => (
        <Link href={SALES_ORDERS_HREF} className="text-primary-600 hover:underline font-medium tabular-nums">
          {v}
        </Link>
      ),
    },
    {
      title: t('clientEquipmentTab.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      render: (v: string) => <Badge variant="secondary" size="sm">{capitalizeStatus(v, emptyValue)}</Badge>,
    },
    {
      title: t('clientEquipmentTab.ordered', { defaultValue: 'Ordered' }),
      dataIndex: 'order_date',
      render: (v: string | null) => shortDate(v, emptyValue),
    },
    {
      title: t('clientEquipmentTab.amount', { defaultValue: 'Amount' }),
      dataIndex: 'total_amount',
      render: (_v: number, rec) => <span className="tabular-nums">{money(rec.total_amount, rec.currency_code)}</span>,
    },
  ];

  // The Asset link is the point of this table (unit → managed record), so it
  // carries an explicit width — width-bearing columns survive narrow
  // containers first (computeColumnFit). MAC was dropped: dead for most
  // categories while it cost the truncated Product column its space.
  const equipmentColumns: ColumnDefinition<ClientEquipmentRow>[] = [
    {
      title: t('clientEquipmentTab.product', { defaultValue: 'Product' }),
      dataIndex: 'service_name',
      render: (v: string) => v || emptyValue,
    },
    {
      title: t('clientEquipmentTab.sku', { defaultValue: 'SKU' }),
      dataIndex: 'sku',
      render: (v: string | null) => v || emptyValue,
    },
    {
      title: t('clientEquipmentTab.serialNumber', { defaultValue: 'Serial number' }),
      dataIndex: 'serial_number',
      render: (v: string | null) => v || emptyValue,
    },
    {
      title: t('clientEquipmentTab.delivered', { defaultValue: 'Delivered' }),
      dataIndex: 'delivered_at',
      render: (v: string | null) => shortDate(v, emptyValue),
    },
    {
      title: t('clientEquipmentTab.asset', { defaultValue: 'Asset' }),
      dataIndex: 'asset_id',
      width: '110px',
      render: (v: string | null) =>
        v ? (
          <Link href={`/msp/assets/${v}`} className="text-primary-600 hover:underline">
            {t('clientEquipmentTab.viewAsset', { defaultValue: 'View asset' })}
          </Link>
        ) : (
          <span className="text-gray-400">{emptyValue}</span>
        ),
    },
  ];

  const rmaColumns: ColumnDefinition<ClientRmaRow>[] = [
    {
      title: t('clientEquipmentTab.rmaNumber', { defaultValue: 'RMA number' }),
      dataIndex: 'rma_number',
      render: (v: string | null) => v || emptyValue,
    },
    {
      title: t('clientEquipmentTab.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      render: (v: string) => <Badge variant="secondary" size="sm">{capitalizeStatus(v, emptyValue)}</Badge>,
    },
    {
      title: t('clientEquipmentTab.product', { defaultValue: 'Product' }),
      dataIndex: 'service_name',
      render: (v: string | null) => v || emptyValue,
    },
    {
      title: t('clientEquipmentTab.serialNumber', { defaultValue: 'Serial number' }),
      dataIndex: 'serial_number',
      render: (v: string | null) => v || emptyValue,
    },
    {
      title: t('clientEquipmentTab.opened', { defaultValue: 'Opened' }),
      dataIndex: 'created_at',
      render: (v: string) => shortDate(v, emptyValue),
    },
  ];

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm space-y-8" id="client-equipment-tab">
      <section className="space-y-2" id="client-equipment-sales-orders">
        <h3 className="text-lg font-medium">
          {t('clientEquipmentTab.salesOrders', { defaultValue: 'Sales Orders' })}
        </h3>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : soError ? (
          <SectionLoadError id="client-equipment-so-retry" message={loadErrorMessage} retryLabel={retryLabel} onRetry={retry} />
        ) : salesOrders.length === 0 ? (
          <p className="text-sm text-gray-500">
            {t('clientEquipmentTab.noSalesOrders', { defaultValue: 'No sales orders for this client.' })}
          </p>
        ) : (
          <DataTable id="client-sales-orders-table" data={salesOrders} columns={salesOrderColumns} />
        )}
      </section>

      <section className="space-y-2" id="client-equipment-equipment">
        <h3 className="text-lg font-medium">
          {t('clientEquipmentTab.deliveredUnits', { defaultValue: 'Delivered units' })}
        </h3>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : equipmentError ? (
          <SectionLoadError id="client-equipment-eq-retry" message={loadErrorMessage} retryLabel={retryLabel} onRetry={retry} />
        ) : equipment.length === 0 ? (
          <p className="text-sm text-gray-500">
            {t('clientEquipmentTab.noDeliveredEquipment', { defaultValue: 'No delivered equipment on record.' })}
          </p>
        ) : (
          <DataTable id="client-equipment-table" data={equipment} columns={equipmentColumns} />
        )}
      </section>

      <section className="space-y-2" id="client-equipment-rmas">
        <h3 className="text-lg font-medium">
          {t('clientEquipmentTab.rmas', { defaultValue: 'RMAs' })}
        </h3>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : rmaError ? (
          <SectionLoadError id="client-equipment-rma-retry" message={loadErrorMessage} retryLabel={retryLabel} onRetry={retry} />
        ) : rmas.length === 0 ? (
          <p className="text-sm text-gray-500">
            {t('clientEquipmentTab.noRmas', { defaultValue: 'No RMAs for this client.' })}
          </p>
        ) : (
          <DataTable id="client-rmas-table" data={rmas} columns={rmaColumns} />
        )}
      </section>
    </div>
  );
};

export default ClientEquipmentTab;
