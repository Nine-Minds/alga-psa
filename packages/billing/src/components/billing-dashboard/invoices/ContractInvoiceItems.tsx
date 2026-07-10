'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { IInvoiceCharge } from '@alga-psa/types';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

import {
  getActiveClientLocationsForBilling,
  type BillingLocationSummary,
} from '../../../actions/billingClientLocationActions';
import {
  getInvoiceLineCogs,
  type InvoiceLineCogsRow,
} from '../../../actions/invoiceCogsActions';
import LocationAddress from '../locations/LocationAddress';
import {
  buildLocationGroups,
  shouldShowLocationGroups,
  type LocationGroupEntry,
} from '../locations/locationGrouping';

interface ContractInvoiceItemsProps {
  items: IInvoiceCharge[];
  /**
   * Client context for looking up locations. Required to render a grouped
   * layout when invoice items span ≥2 distinct locations; when omitted the
   * component falls back to the contract-grouped layout (existing behavior).
   */
  clientId?: string;
  /**
   * When provided, the internal view surfaces per-line COGS/margin and a sales-order
   * backlink for inventory lines (F040/F041). Internal-only — never passed to the
   * customer-facing PDF/portal templates.
   */
  invoiceId?: string;
}

interface ContractGroupedItems {
  [key: string]: {
    contractName: string;
    items: IInvoiceCharge[];
    subtotal: number;
  };
}

const ContractInvoiceItems: React.FC<ContractInvoiceItemsProps> = ({ items, clientId, invoiceId }) => {
  const { t } = useTranslation('msp/invoicing');
  const { t: tLocation } = useTranslation('features/billing');
  const { formatCurrency } = useFormatters();
  const [clientLocations, setClientLocations] = useState<BillingLocationSummary[]>([]);
  const [cogsByItem, setCogsByItem] = useState<Map<string, InvoiceLineCogsRow>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!clientId) {
        setClientLocations([]);
        return;
      }
      try {
        const locations = await getActiveClientLocationsForBilling(clientId);
        if (isActionPermissionError(locations)) {
          if (!cancelled) setClientLocations([]);
          return;
        }
        if (!cancelled) setClientLocations(locations);
      } catch (error) {
        console.error('Failed to load client locations for invoice items:', error);
        if (!cancelled) setClientLocations([]);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // Per-line COGS/margin + SO backlinks for the internal view (F040/F041). Absent
  // (empty map) when no invoiceId is supplied or the read fails — the line table
  // renders exactly as before in that case.
  useEffect(() => {
    let cancelled = false;
    if (!invoiceId) {
      setCogsByItem(new Map());
      return;
    }
    getInvoiceLineCogs(invoiceId)
      .then((rows) => {
        if (isActionPermissionError(rows)) {
          if (!cancelled) setCogsByItem(new Map());
          return;
        }
        if (!cancelled) setCogsByItem(new Map(rows.map((r) => [r.item_id, r])));
      })
      .catch(() => {
        if (!cancelled) setCogsByItem(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  // Only surface the COGS/SO columns when at least one line actually carries data,
  // so service-only invoices are not padded with empty columns.
  const showCogs = useMemo(
    () => Array.from(cogsByItem.values()).some((r) => r.cogs_total != null || r.so_id != null),
    [cogsByItem],
  );

  const renderCogsHeaderCells = () =>
    showCogs ? (
      <>
        <th className="text-right py-2">
          {t('contractItems.columns.salesOrder', { defaultValue: 'Sales Order' })}
        </th>
        <th className="text-right py-2">
          {t('contractItems.columns.cogsMargin', { defaultValue: 'COGS / Margin' })}
        </th>
      </>
    ) : null;

  const renderCogsBodyCells = (item: IInvoiceCharge) => {
    if (!showCogs) return null;
    const cogs = cogsByItem.get(item.item_id);
    const marginPct =
      cogs && cogs.margin_ratio != null ? `${(cogs.margin_ratio * 100).toFixed(1)}%` : null;
    return (
      <>
        <td className="text-right">
          {cogs?.so_number ? (
            <Link
              href="/msp/inventory/sales-orders"
              className="text-[rgb(var(--color-primary-600))] hover:underline tabular-nums"
            >
              {cogs.so_number}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="text-right tabular-nums">
          {cogs && cogs.cogs_total != null ? (
            <span>
              {formatCurrency(cogs.cogs_total / 100, 'USD')}
              {marginPct ? <span className="ml-1 text-muted-foreground">· {marginPct}</span> : null}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      </>
    );
  };

  const useLocationGrouping = useMemo(
    () => shouldShowLocationGroups(items),
    [items],
  );

  const locationGroups: LocationGroupEntry<IInvoiceCharge>[] = useMemo(
    () => (useLocationGrouping ? buildLocationGroups(items, clientLocations) : []),
    [useLocationGrouping, items, clientLocations],
  );

  const renderItemRow = (item: IInvoiceCharge, index: number) => (
    <tr key={index} className="border-t">
      <td className="py-2">
        <div className="flex items-center gap-2">
          <span>{item.description}</span>
          {item.service_item_kind === 'product' ? (
            <Badge variant="secondary">
              {t('contractItems.labels.product', { defaultValue: 'Product' })}
            </Badge>
          ) : null}
          {item.service_item_kind === 'product' && item.service_sku ? (
            <span className="text-xs text-muted-foreground">{item.service_sku}</span>
          ) : null}
        </div>
      </td>
      <td className="text-right">{item.quantity}</td>
      <td className="text-right">{formatCurrency(item.unit_price / 100, 'USD')}</td>
      <td className="text-right">{formatCurrency(item.total_price / 100, 'USD')}</td>
      {renderCogsBodyCells(item)}
    </tr>
  );

  const renderItemsTable = (tableItems: IInvoiceCharge[]) => (
    <table className="w-full">
      <thead className="text-sm text-muted-foreground">
        <tr>
          <th className="text-left py-2">
            {t('contractItems.columns.description', { defaultValue: 'Description' })}
          </th>
          <th className="text-right py-2">
            {t('contractItems.columns.quantity', { defaultValue: 'Quantity' })}
          </th>
          <th className="text-right py-2">
            {t('contractItems.columns.rate', { defaultValue: 'Rate' })}
          </th>
          <th className="text-right py-2">
            {t('contractItems.columns.amount', { defaultValue: 'Amount' })}
          </th>
          {renderCogsHeaderCells()}
        </tr>
      </thead>
      <tbody className="text-sm">
        {tableItems.map((item, i) => renderItemRow(item, i))}
      </tbody>
    </table>
  );

  // Location-grouped layout takes precedence when items span ≥2 distinct
  // locations — ensures the MSP detail view matches the quote/contract UX.
  if (useLocationGrouping) {
    return (
      <div className="space-y-6" id="invoice-items-by-location">
        {locationGroups.map((group) => {
          const subtotal = group.items.reduce(
            (sum, item) => sum + (Number(item.total_price) || 0),
            0,
          );
          return (
            <div
              key={group.key}
              id={`invoice-items-location-group-${group.key}`}
              className="overflow-hidden rounded-md border border-border"
            >
              <div className="flex flex-col gap-2 border-b border-border bg-muted/40 px-4 py-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {tLocation('invoices.locations.groupHeading', { defaultValue: 'Location' })}
                  </div>
                  <div className="mt-1">
                    <LocationAddress
                      location={group.location}
                      showName
                      emptyText={tLocation('invoices.locations.unassigned', {
                        defaultValue: 'Items without a location',
                      })}
                    />
                  </div>
                </div>
                <div className="text-sm">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {tLocation('invoices.locations.subtotal', { defaultValue: 'Location subtotal' })}
                  </div>
                  <div className="mt-1 font-semibold">{formatCurrency(subtotal / 100, 'USD')}</div>
                </div>
              </div>
              <div className="overflow-x-auto p-4">
                {renderItemsTable(group.items)}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Fallback: contract grouping (original behavior) when items fit a single
  // (or no) location. Group by contract, else "Other Items".
  const groupedItems: ContractGroupedItems = {};
  const nonContractItems: IInvoiceCharge[] = [];

  items.forEach((item) => {
    if (item.client_contract_id && item.contract_name) {
      if (!groupedItems[item.client_contract_id]) {
        groupedItems[item.client_contract_id] = {
          contractName: item.contract_name,
          items: [],
          subtotal: 0,
        };
      }
      groupedItems[item.client_contract_id].items.push(item);
      groupedItems[item.client_contract_id].subtotal += item.total_price;
    } else {
      nonContractItems.push(item);
    }
  });

  return (
    <div className="space-y-6" id="invoice-items-by-contract">
      {Object.keys(groupedItems).map((contractId) => {
        const contract = groupedItems[contractId];
        return (
          <div
            key={contractId}
            id={`invoice-items-contract-${contractId}`}
            className="border rounded-md p-4"
          >
            <h3 className="text-lg font-medium mb-2">{contract.contractName}</h3>
            <table className="w-full">
              <thead className="text-sm text-muted-foreground">
                <tr>
                  <th className="text-left py-2">
                    {t('contractItems.columns.description', { defaultValue: 'Description' })}
                  </th>
                  <th className="text-right py-2">
                    {t('contractItems.columns.quantity', { defaultValue: 'Quantity' })}
                  </th>
                  <th className="text-right py-2">
                    {t('contractItems.columns.rate', { defaultValue: 'Rate' })}
                  </th>
                  <th className="text-right py-2">
                    {t('contractItems.columns.amount', { defaultValue: 'Amount' })}
                  </th>
                  {renderCogsHeaderCells()}
                </tr>
              </thead>
              <tbody className="text-sm">
                {contract.items.map((item, i) => renderItemRow(item, i))}
                <tr className="border-t font-medium">
                  <td colSpan={3} className="py-2 text-right">
                    {t('contractItems.labels.contractSubtotal', { defaultValue: 'Contract Subtotal:' })}
                  </td>
                  <td className="text-right">{formatCurrency(contract.subtotal / 100, 'USD')}</td>
                  {showCogs ? <><td /><td /></> : null}
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}

      {nonContractItems.length > 0 && (
        <div className="border rounded-md p-4" id="invoice-items-non-contract">
          <h3 className="text-lg font-medium mb-2">
            {t('contractItems.labels.otherItems', { defaultValue: 'Other Items' })}
          </h3>
          <table className="w-full">
            <thead className="text-sm text-muted-foreground">
              <tr>
                <th className="text-left py-2">
                  {t('contractItems.columns.description', { defaultValue: 'Description' })}
                </th>
                <th className="text-right py-2">
                  {t('contractItems.columns.quantity', { defaultValue: 'Quantity' })}
                </th>
                <th className="text-right py-2">
                  {t('contractItems.columns.rate', { defaultValue: 'Rate' })}
                </th>
                <th className="text-right py-2">
                  {t('contractItems.columns.amount', { defaultValue: 'Amount' })}
                </th>
                {renderCogsHeaderCells()}
              </tr>
            </thead>
            <tbody className="text-sm">
              {nonContractItems.map((item, i) => renderItemRow(item, i))}
              <tr className="border-t font-medium">
                <td colSpan={3} className="py-2 text-right">
                  {t('contractItems.labels.otherItemsSubtotal', { defaultValue: 'Other Items Subtotal:' })}
                </td>
                <td className="text-right">
                  {formatCurrency(nonContractItems.reduce((sum, item) => sum + item.total_price, 0) / 100, 'USD')}
                </td>
                {showCogs ? <><td /><td /></> : null}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ContractInvoiceItems;
