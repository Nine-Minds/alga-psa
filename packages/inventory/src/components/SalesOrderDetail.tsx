'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { toast } from 'react-hot-toast';
import type { ISalesOrder, IStockLocation, IVendor } from '@alga-psa/types';
import {
  getSalesOrder,
  computeBackorder,
  suggestPoFromBackorder,
  reopenSalesOrder,
  createDropShipForSoLine,
  listVendors,
  listFulfillmentCandidateUnits,
  type SalesOrderLineDetail,
  type SalesOrderWithDetail,
  type BackorderLine,
  type FulfillmentCandidateUnit,
} from '../actions';
import {
  listSalesOrderInvoices,
  type SalesOrderInvoiceLink,
} from '../actions/salesOrderLinkActions';

/**
 * Billing-owned actions arrive as props (F008): the dependency direction is
 * billing → inventory, so this package cannot import them. The page (in server/)
 * imports @alga-psa/billing/actions and passes the server-action references down.
 */
export type FulfillAndInvoiceFn = (
  soLineId: string,
  input?: { location_id?: string | null; unit_ids?: string[]; quantity?: number },
) => Promise<{
  fulfillment: {
    quantity_fulfilled: number;
    line_quantity_fulfilled: number;
    so_status: string;
    warnings: string[];
    asset_ids: string[];
  };
  invoice: { success: boolean; invoiced: number; invoiceId?: string; error?: string } | null;
}>;
export type GenerateInvoiceFn = (
  soId: string,
  opts?: { mode?: 'fulfilled' | 'ordered' },
) => Promise<{ success: boolean; invoiced: number; invoiceId?: string; error?: string }>;
export type ConfirmDropShipFn = (
  ref: { po_line_id?: string; so_line_id?: string },
  input?: { serials?: Array<{ serial_number: string; mac_address?: string | null }> },
) => Promise<{
  shipment: { quantity_fulfilled: number; sales_order_status: string; warnings: string[] };
  invoice: { success: boolean; invoiced: number; invoiceId?: string; error?: string } | null;
}>;

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  draft: 'secondary',
  confirmed: 'warning',
  partially_fulfilled: 'warning',
  fulfilled: 'success',
  invoiced: 'success',
  closed: 'success',
  cancelled: 'error',
};

const dollars = (cents?: number | null): string =>
  cents == null ? '—' : `$${(Number(cents) / 100).toFixed(2)}`;

const remainingOf = (l: SalesOrderLineDetail): number =>
  Math.max(0, Number(l.quantity_ordered) - Number(l.quantity_fulfilled ?? 0));

interface SerialRow {
  serial_number: string;
  mac_address: string;
}

export interface SalesOrderDetailProps {
  soId: string | null;
  onClose: () => void;
  /** Called after any mutation so the list view can refresh statuses. */
  onChanged: () => void | Promise<void>;
  locations: IStockLocation[];
  fulfillAndInvoice: FulfillAndInvoiceFn;
  generateInvoice: GenerateInvoiceFn;
  confirmDropShip: ConfirmDropShipFn;
}

export function SalesOrderDetail({
  soId,
  onClose,
  onChanged,
  locations,
  fulfillAndInvoice,
  generateInvoice,
  confirmDropShip,
}: SalesOrderDetailProps) {
  const { t } = useTranslation('features/inventory');
  const statusLabel = (status: string): string => {
    switch (status) {
      case 'draft':
        return t('salesOrders.status.draft', 'Draft');
      case 'confirmed':
        return t('salesOrders.status.confirmed', 'Confirmed');
      case 'partially_fulfilled':
        return t('salesOrders.status.partiallyFulfilled', 'Partially fulfilled');
      case 'fulfilled':
        return t('salesOrders.status.fulfilled', 'Fulfilled');
      case 'invoiced':
        return t('salesOrders.status.invoiced', 'Invoiced');
      case 'closed':
        return t('salesOrders.status.closed', 'Closed');
      case 'cancelled':
        return t('salesOrders.status.cancelled', 'Cancelled');
      default:
        return status;
    }
  };
  const [so, setSo] = useState<SalesOrderWithDetail | null>(null);
  const [backorder, setBackorder] = useState<Map<string, BackorderLine>>(new Map());
  const [invoices, setInvoices] = useState<SalesOrderInvoiceLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Fulfill sub-dialog state.
  const [fulfillLine, setFulfillLine] = useState<SalesOrderLineDetail | null>(null);
  const [fulfillQty, setFulfillQty] = useState('');
  const [fulfillLocation, setFulfillLocation] = useState('');
  const [candidates, setCandidates] = useState<FulfillmentCandidateUnit[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(new Set());
  const [unitSearch, setUnitSearch] = useState('');

  // Drop-ship sub-dialog state.
  const [dropShipLine, setDropShipLine] = useState<SalesOrderLineDetail | null>(null);
  const [serialRows, setSerialRows] = useState<SerialRow[]>([]);

  // Create-drop-ship-PO sub-dialog state (a drop-ship line is confirmable only once
  // a vendor PO backs it).
  const [createPoLine, setCreatePoLine] = useState<SalesOrderLineDetail | null>(null);
  const [vendors, setVendors] = useState<IVendor[]>([]);
  const [createPoVendorId, setCreatePoVendorId] = useState('');

  const load = useCallback(async () => {
    if (!soId) return;
    setLoading(true);
    try {
      const detail = await getSalesOrder(soId);
      setSo(detail);
      try {
        const rows = await computeBackorder(soId);
        setBackorder(new Map(rows.map((r) => [r.so_line_id, r])));
      } catch {
        setBackorder(new Map()); // backorder is decoration; the detail still renders
      }
      try {
        setInvoices(await listSalesOrderInvoices(soId));
      } catch {
        setInvoices([]); // invoice backlinks are decoration; the detail still renders
      }
    } catch (e: any) {
      toast.error(e?.message || t('salesOrders.loadDetailError', "Couldn't load the sales order."));
    } finally {
      setLoading(false);
    }
  }, [soId, t]);

  useEffect(() => {
    setSo(null);
    setBackorder(new Map());
    setInvoices([]);
    load();
  }, [load]);

  const changed = useCallback(async () => {
    await load();
    await onChanged();
  }, [load, onChanged]);

  // ---- Fulfill ---------------------------------------------------------------

  const openFulfill = async (line: SalesOrderLineDetail) => {
    setFulfillLine(line);
    setFulfillQty(String(remainingOf(line)));
    setFulfillLocation(line.reserved_location_id ?? '');
    setUnitSearch('');
    setCandidates([]);
    setSelectedUnits(new Set());
    if (line.is_serialized) {
      setCandidatesLoading(true);
      try {
        const units = await listFulfillmentCandidateUnits(line.so_line_id);
        setCandidates(units);
        // FIFO preselect (F003): this line's allocated units first, then unallocated,
        // skipping other orders' claims — mirroring the server's own default pick.
        const eligible = units.filter((u) => !u.foreign_hard_hold);
        eligible.sort((a, b) => Number(b.allocated_to_this_line) - Number(a.allocated_to_this_line));
        setSelectedUnits(new Set(eligible.slice(0, remainingOf(line)).map((u) => u.unit_id)));
      } catch (e: any) {
        toast.error(e?.message || t('salesOrders.loadUnitsError', "Couldn't load available units."));
      } finally {
        setCandidatesLoading(false);
      }
    }
  };

  const toggleUnit = (unitId: string) => {
    setSelectedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  const submitFulfill = async () => {
    if (!fulfillLine || busy) return;
    const line = fulfillLine;
    let input: Parameters<FulfillAndInvoiceFn>[1];
    if (line.is_serialized) {
      if (selectedUnits.size === 0) {
        toast.error(t('salesOrders.selectUnit', 'Select at least one unit.'));
        return;
      }
      input = { unit_ids: [...selectedUnits] };
    } else {
      const qty = Number(fulfillQty);
      const remaining = remainingOf(line);
      if (!Number.isInteger(qty) || qty <= 0) {
        toast.error(t('salesOrders.qtyPositiveInteger', 'Quantity must be a positive whole number.'));
        return;
      }
      if (qty > remaining) {
        toast.error(t('salesOrders.onlyRemaining', 'Only {{remaining}} remaining on this line.', { remaining }));
        return;
      }
      input = { quantity: qty, ...(fulfillLocation ? { location_id: fulfillLocation } : {}) };
    }

    setBusy(`fulfill:${line.so_line_id}`);
    try {
      const result = await fulfillAndInvoice(line.so_line_id, input);
      toast.success(
        t('salesOrders.fulfilledUnits', 'Fulfilled {{count}} unit(s).', {
          count: result.fulfillment.quantity_fulfilled,
        }),
      );
      for (const w of result.fulfillment.warnings ?? []) toast(w, { icon: '⚠️' });
      if (result.invoice) {
        if (result.invoice.success && result.invoice.invoiced > 0) {
          toast.success(
            t('salesOrders.invoicedItems', 'Invoiced {{count}} item(s).', { count: result.invoice.invoiced }),
          );
        } else if (!result.invoice.success) {
          toast.error(
            t('salesOrders.invoicingFailed', 'Invoicing failed: {{error}}. Use "Generate invoice" to retry.', {
              error: result.invoice.error,
            }),
          );
        }
      }
      setFulfillLine(null);
      await changed();
    } catch (e: any) {
      toast.error(e?.message || t('salesOrders.fulfillmentFailed', 'Fulfillment failed.'));
    } finally {
      setBusy(null);
    }
  };

  // ---- Drop-ship confirm -------------------------------------------------------

  const openDropShip = (line: SalesOrderLineDetail) => {
    setDropShipLine(line);
    setSerialRows(
      line.is_serialized
        ? Array.from({ length: Math.max(1, remainingOf(line)) }, () => ({ serial_number: '', mac_address: '' }))
        : [],
    );
  };

  const submitDropShip = async () => {
    if (!dropShipLine || busy) return;
    const line = dropShipLine;
    const serials = serialRows
      .filter((r) => r.serial_number.trim())
      .map((r) => ({
        serial_number: r.serial_number.trim(),
        ...(r.mac_address.trim() ? { mac_address: r.mac_address.trim() } : {}),
      }));
    if (line.is_serialized && serials.length === 0) {
      toast.error(t('salesOrders.enterSerial', 'Enter at least one serial number.'));
      return;
    }
    setBusy(`dropship:${line.so_line_id}`);
    try {
      const result = await confirmDropShip({ so_line_id: line.so_line_id }, { serials });
      toast.success(
        t('salesOrders.shipmentConfirmed', 'Shipment confirmed — {{count}} unit(s) delivered.', {
          count: result.shipment.quantity_fulfilled,
        }),
      );
      for (const w of result.shipment.warnings ?? []) toast(w, { icon: '⚠️' });
      if (result.invoice) {
        if (result.invoice.success && result.invoice.invoiced > 0) {
          toast.success(
            t('salesOrders.invoicedItems', 'Invoiced {{count}} item(s).', { count: result.invoice.invoiced }),
          );
        } else if (!result.invoice.success) {
          toast.error(
            t('salesOrders.invoicingFailed', 'Invoicing failed: {{error}}. Use "Generate invoice" to retry.', {
              error: result.invoice.error,
            }),
          );
        }
      }
      setDropShipLine(null);
      await changed();
    } catch (e: any) {
      toast.error(e?.message || t('salesOrders.confirmShipmentError', "Couldn't confirm the shipment."));
    } finally {
      setBusy(null);
    }
  };

  // ---- Create drop-ship PO -------------------------------------------------------

  const openCreatePo = async (line: SalesOrderLineDetail) => {
    setCreatePoLine(line);
    setCreatePoVendorId('');
    try {
      const v = await listVendors({});
      setVendors(v);
      if (v.length === 1) setCreatePoVendorId(v[0].vendor_id);
    } catch (e: any) {
      toast.error(e?.message || t('salesOrders.loadVendorsError', "Couldn't load vendors."));
    }
  };

  const submitCreatePo = async () => {
    if (!createPoLine || busy) return;
    if (!createPoVendorId) {
      toast.error(t('salesOrders.pickVendor', 'Pick the vendor that will ship this line.'));
      return;
    }
    setBusy(`create-po:${createPoLine.so_line_id}`);
    try {
      const po = await createDropShipForSoLine(createPoLine.so_line_id, { vendor_id: createPoVendorId });
      toast.success(
        t('salesOrders.dropShipPoCreated', 'Drop-ship PO {{number}} created — confirm the shipment once the vendor ships.', {
          number: po.po_number,
        }),
      );
      setCreatePoLine(null);
      await changed();
    } catch (e: any) {
      toast.error(e?.message || t('salesOrders.createDropShipPoError', "Couldn't create the drop-ship PO."));
    } finally {
      setBusy(null);
    }
  };

  // ---- Header actions ----------------------------------------------------------

  const runInvoice = async () => {
    if (!so || busy) return;
    setBusy('invoice');
    try {
      const result = await generateInvoice(so.so_id);
      if (result.success) {
        toast.success(
          result.invoiced > 0
            ? t('salesOrders.invoicedItems', 'Invoiced {{count}} item(s).', { count: result.invoiced })
            : t('salesOrders.nothingToInvoice', 'Nothing left to invoice.'),
        );
      } else {
        toast.error(result.error || t('salesOrders.invoiceGenFailed', 'Invoice generation failed.'));
      }
      await changed();
    } catch (e: any) {
      toast.error(e?.message || t('salesOrders.invoiceGenFailed', 'Invoice generation failed.'));
    } finally {
      setBusy(null);
    }
  };

  const runBackorderPo = async () => {
    if (!so || busy) return;
    setBusy('backorder-po');
    try {
      const result = await suggestPoFromBackorder(so.so_id);
      const poNumbers = result.purchaseOrders.map((po) => po.po_number).join(', ');
      if (result.purchaseOrders.length > 0) {
        toast.success(
          result.purchaseOrders.length === 1
            ? t('salesOrders.draftPoCreated', 'Draft PO created: {{numbers}}', { numbers: poNumbers })
            : t('salesOrders.draftPosCreated', 'Draft POs created: {{numbers}}', { numbers: poNumbers }),
        );
      }
      if (result.unassigned.length > 0) {
        toast(
          t(
            'salesOrders.unassignedBackorder',
            '{{count}} backordered line(s) have no preferred vendor — create those POs manually.',
            { count: result.unassigned.length },
          ),
          { icon: '⚠️' },
        );
      }
      if (result.purchaseOrders.length === 0 && result.unassigned.length === 0) {
        toast.success(t('salesOrders.nothingBackordered', 'Nothing is backordered.'));
      }
      await changed();
    } catch (e: any) {
      toast.error(e?.message || t('salesOrders.createDraftPoError', "Couldn't create the draft PO."));
    } finally {
      setBusy(null);
    }
  };

  const runReopen = async () => {
    if (!so || busy) return;
    setBusy('reopen');
    try {
      await reopenSalesOrder(so.so_id);
      toast.success(t('salesOrders.reopened', 'Sales order reopened — it is a draft again.'));
      await changed();
    } catch (e: any) {
      toast.error(e?.message || t('salesOrders.reopenError', "Couldn't reopen the sales order."));
    } finally {
      setBusy(null);
    }
  };

  // ---- Render --------------------------------------------------------------

  const statusVariant = so ? STATUS_VARIANTS[so.status] ?? ('secondary' as BadgeVariant) : null;
  const canFulfill = so && (so.status === 'confirmed' || so.status === 'partially_fulfilled');
  const hasBackorder = [...backorder.values()].some((b) => b.backordered);
  const hasUninvoiced = so?.lines.some((l) => Number(l.quantity_invoiced ?? 0) < Number(l.quantity_ordered)) ?? false;

  const filteredCandidates = useMemo(() => {
    const visible = candidates.filter((u) => !u.foreign_hard_hold);
    const s = unitSearch.trim().toLowerCase();
    if (!s) return visible;
    return visible.filter(
      (u) =>
        (u.serial_number ?? '').toLowerCase().includes(s) || (u.mac_address ?? '').toLowerCase().includes(s),
    );
  }, [candidates, unitSearch]);
  const hardHeldCount = candidates.filter((u) => u.foreign_hard_hold).length;

  const locationOptions = [
    { value: '', label: t('salesOrders.productDefaultLocation', 'Product default location') },
    ...locations.map((l) => ({ value: l.location_id, label: l.name })),
  ];

  return (
    <Dialog
      isOpen={soId !== null}
      onClose={onClose}
      title={so ? t('salesOrders.detailTitle', 'Sales Order {{number}}', { number: so.so_number }) : t('salesOrders.detailTitleFallback', 'Sales Order')}
      id="sales-order-detail-dialog"
      className="max-w-4xl"
    >
      <div className="space-y-4 p-1" id="sales-order-detail">
        {loading && !so && <p className="text-sm text-gray-500">{t('common.loading', 'Loading…')}</p>}
        {so && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {statusVariant && (
                  <Badge variant={statusVariant} size="sm">
                    {statusLabel(so.status)}
                  </Badge>
                )}
                <span className="text-sm text-gray-500 flex items-center gap-1">
                  <a
                    id={`so-detail-client-${so.so_id}`}
                    href={`/msp/clients/${so.client_id}`}
                    className="text-primary-600 hover:underline"
                  >
                    {so.client_name || so.client_id}
                  </a>
                  <span>· {so.currency_code} ·{' '}
                  {so.invoice_mode === 'on_fulfillment'
                    ? t('salesOrders.billsOnFulfillment', 'Bills on fulfillment')
                    : t('salesOrders.manualInvoicing', 'Manual invoicing')}</span>
                  {so.quote_id && (
                    <a
                      id={`so-detail-from-quote-${so.so_id}`}
                      href={`/msp/billing?tab=quotes&quoteId=${so.quote_id}&mode=detail`}
                      className="text-primary-600 hover:underline"
                    >
                      · {t('salesOrders.fromQuote', 'From quote')}
                    </a>
                  )}
                </span>
              </div>
              <div className="flex gap-2">
                {so.status === 'confirmed' && (
                  <Button
                    id="so-detail-reopen"
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={runReopen}
                  >
                    {busy === 'reopen'
                      ? t('salesOrders.actions.reopening', 'Reopening…')
                      : t('salesOrders.actions.reopenToDraft', 'Reopen to draft')}
                  </Button>
                )}
                {hasBackorder && (
                  <Button
                    id="so-detail-backorder-po"
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={runBackorderPo}
                  >
                    {busy === 'backorder-po'
                      ? t('salesOrders.actions.creating', 'Creating…')
                      : t('salesOrders.actions.createBackorderPo', 'Create draft PO for backorder')}
                  </Button>
                )}
                {so.invoice_mode === 'manual' && so.status !== 'cancelled' && so.status !== 'draft' && (
                  <Button
                    id="so-detail-generate-invoice"
                    size="sm"
                    disabled={busy !== null || !hasUninvoiced}
                    onClick={runInvoice}
                  >
                    {busy === 'invoice'
                      ? t('salesOrders.actions.invoicing', 'Invoicing…')
                      : t('salesOrders.actions.generateInvoice', 'Generate invoice')}
                  </Button>
                )}
              </div>
            </div>

            <table className="w-full text-sm" id="so-detail-lines">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-2 font-medium">{t('salesOrders.lineColumns.product', 'Product')}</th>
                  <th className="py-2 px-2 font-medium text-right">{t('salesOrders.lineColumns.ordered', 'Ordered')}</th>
                  <th className="py-2 px-2 font-medium text-right">{t('salesOrders.lineColumns.fulfilled', 'Fulfilled')}</th>
                  <th className="py-2 px-2 font-medium text-right">{t('salesOrders.lineColumns.invoiced', 'Invoiced')}</th>
                  <th className="py-2 px-2 font-medium text-right">{t('salesOrders.lineColumns.unitPrice', 'Unit price')}</th>
                  <th className="py-2 px-2 font-medium">{t('salesOrders.lineColumns.availability', 'Availability')}</th>
                  <th className="py-2 pl-2" />
                </tr>
              </thead>
              <tbody>
                {so.lines.map((line) => {
                  const bo = backorder.get(line.so_line_id);
                  const remaining = remainingOf(line);
                  return (
                    <tr key={line.so_line_id} className="border-b last:border-0 align-middle">
                      <td className="py-2 pr-2">
                        <div className="font-medium">{line.service_name || line.service_id}</div>
                        <div className="text-xs text-gray-500">
                          {line.sku || ''}
                          {line.fulfillment_type === 'drop_ship' && (
                            <Badge variant="secondary" size="sm" className="ml-1">
                              {t('salesOrders.dropShipBadge', 'Drop-ship')}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">{Number(line.quantity_ordered)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{Number(line.quantity_fulfilled ?? 0)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{Number(line.quantity_invoiced ?? 0)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{dollars(line.unit_price)}</td>
                      <td className="py-2 px-2">
                        {bo?.backordered ? (
                          <Badge variant="error" size="sm">
                            {t('salesOrders.backorderBadge', 'Backorder {{shortfall}}', { shortfall: bo.shortfall })}
                          </Badge>
                        ) : line.track_stock && line.fulfillment_type !== 'drop_ship' ? (
                          <span className="text-xs text-gray-500">{t('salesOrders.availabilityOk', 'OK')}</span>
                        ) : (
                          <span className="text-xs text-gray-400">{t('common.emptyValue', '—')}</span>
                        )}
                      </td>
                      <td className="py-2 pl-2 text-right">
                        {line.fulfillment_type === 'drop_ship' && remaining > 0 && so.status !== 'cancelled' && so.status !== 'draft' && (
                          line.drop_ship_po_number ? (
                            <div className="inline-flex flex-col items-end gap-0.5">
                              <Button
                                id={`so-line-dropship-${line.so_line_id}`}
                                variant="outline"
                                size="sm"
                                disabled={busy !== null}
                                onClick={() => openDropShip(line)}
                              >
                                {t('salesOrders.actions.confirmShipment', 'Confirm shipment')}
                              </Button>
                              <span className="text-xs text-gray-500">{line.drop_ship_po_number}</span>
                            </div>
                          ) : (
                            // No vendor PO yet — confirming would dead-end, so offer creation instead.
                            <Button
                              id={`so-line-create-dropship-po-${line.so_line_id}`}
                              variant="outline"
                              size="sm"
                              disabled={busy !== null}
                              onClick={() => openCreatePo(line)}
                            >
                              {t('salesOrders.actions.createDropShipPo', 'Create drop-ship PO')}
                            </Button>
                          )
                        )}
                        {line.fulfillment_type === 'from_stock' && canFulfill && remaining > 0 && line.track_stock && (
                          <Button
                            id={`so-line-fulfill-${line.so_line_id}`}
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => openFulfill(line)}
                          >
                            {t('salesOrders.actions.fulfill', 'Fulfill')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {invoices.length > 0 && (
              <div className="space-y-1" id="so-detail-invoices">
                <h3 className="text-sm font-semibold text-gray-700">{t('salesOrders.invoices', 'Invoices')}</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-2 font-medium">{t('salesOrders.invoiceColumns.invoice', 'Invoice')}</th>
                      <th className="py-2 px-2 font-medium">{t('common.status', 'Status')}</th>
                      <th className="py-2 px-2 font-medium text-right">{t('salesOrders.invoiceColumns.amount', 'Amount')}</th>
                      <th className="py-2 pl-2 font-medium">{t('salesOrders.invoiceColumns.created', 'Created')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.invoice_id} className="border-b last:border-0">
                        <td className="py-2 pr-2">
                          <a
                            id={`so-detail-invoice-${inv.invoice_id}`}
                            href={`/msp/invoices/${inv.invoice_id}`}
                            className="text-primary-600 hover:underline"
                          >
                            {inv.invoice_number || inv.invoice_id}
                          </a>
                        </td>
                        <td className="py-2 px-2">{inv.status || t('common.emptyValue', '—')}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{dollars(inv.total_amount)}</td>
                        <td className="py-2 pl-2 text-gray-500">
                          {inv.created_at ? new Date(inv.created_at).toLocaleDateString() : t('common.emptyValue', '—')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <div className="flex justify-end">
          <Button id="so-detail-close" variant="outline" onClick={onClose}>
            {t('common.close', 'Close')}
          </Button>
        </div>
      </div>

      {/* ---- Fulfill sub-dialog ---- */}
      <Dialog
        isOpen={fulfillLine !== null}
        onClose={() => setFulfillLine(null)}
        title={
          fulfillLine
            ? t('salesOrders.fulfillDialog.title', 'Fulfill — {{name}}', {
                name: fulfillLine.service_name || fulfillLine.service_id,
              })
            : t('salesOrders.actions.fulfill', 'Fulfill')
        }
        id="so-fulfill-dialog"
      >
        {fulfillLine && (
          <div className="space-y-4 p-1">
            <p className="text-sm text-gray-500">
              {t('salesOrders.fulfillDialog.remaining', '{{remaining}} of {{ordered}} remaining.', {
                remaining: remainingOf(fulfillLine),
                ordered: Number(fulfillLine.quantity_ordered),
              })}
            </p>

            {fulfillLine.is_serialized ? (
              <div className="space-y-2">
                <Input
                  id="so-fulfill-unit-search"
                  placeholder={t('salesOrders.fulfillDialog.searchPlaceholder', 'Search serial or MAC')}
                  value={unitSearch}
                  onChange={(e) => setUnitSearch(e.target.value)}
                />
                {candidatesLoading && (
                  <p className="text-sm text-gray-500">{t('salesOrders.fulfillDialog.loadingUnits', 'Loading units…')}</p>
                )}
                {!candidatesLoading && filteredCandidates.length === 0 && (
                  <p className="text-sm text-gray-500">{t('salesOrders.fulfillDialog.noUnits', 'No available units.')}</p>
                )}
                <div className="max-h-64 overflow-y-auto space-y-1" id="so-fulfill-unit-list">
                  {filteredCandidates.map((u) => (
                    <label
                      key={u.unit_id}
                      className="flex items-center gap-2 rounded border px-2 py-1.5 text-sm cursor-pointer"
                    >
                      <Checkbox
                        id={`so-fulfill-unit-${u.unit_id}`}
                        checked={selectedUnits.has(u.unit_id)}
                        onChange={() => toggleUnit(u.unit_id)}
                      />
                      <span className="font-mono">{u.serial_number || u.unit_id}</span>
                      {u.mac_address && <span className="text-xs text-gray-500 font-mono">{u.mac_address}</span>}
                      <span className="text-xs text-gray-500 ml-auto">{u.location_name || ''}</span>
                      {u.allocated_to_this_line && (
                        <Badge variant="success" size="sm">
                          {t('salesOrders.fulfillDialog.allocatedToThis', 'Allocated to this order')}
                        </Badge>
                      )}
                      {u.foreign_soft_allocated && (
                        <Badge variant="warning" size="sm">
                          {t('salesOrders.fulfillDialog.softAllocatedOther', 'Soft-allocated to another order')}
                        </Badge>
                      )}
                    </label>
                  ))}
                </div>
                {hardHeldCount > 0 && (
                  <p className="text-xs text-gray-500">
                    {hardHeldCount === 1
                      ? t('salesOrders.fulfillDialog.hardHeldOne', '{{count}} unit is hard-held by other orders and not shown.', {
                          count: hardHeldCount,
                        })
                      : t('salesOrders.fulfillDialog.hardHeldMany', '{{count}} units are hard-held by other orders and not shown.', {
                          count: hardHeldCount,
                        })}
                  </p>
                )}
                <p className="text-sm">
                  {selectedUnits.size === 1
                    ? t('salesOrders.fulfillDialog.selectedOne', '{{count}} unit selected', { count: selectedUnits.size })
                    : t('salesOrders.fulfillDialog.selectedMany', '{{count}} units selected', { count: selectedUnits.size })}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <Input
                  id="so-fulfill-quantity"
                  label={t('common.quantity', 'Quantity')}
                  type="number"
                  min={1}
                  max={remainingOf(fulfillLine)}
                  value={fulfillQty}
                  onChange={(e) => setFulfillQty(e.target.value)}
                />
                <CustomSelect
                  id="so-fulfill-location"
                  label={t('salesOrders.fulfillDialog.sourceLocation', 'Source location')}
                  options={locationOptions}
                  value={fulfillLocation}
                  onValueChange={setFulfillLocation}
                />
                <p className="text-xs text-gray-500">
                  {t('salesOrders.fulfillDialog.shortStockNote', 'Short stock warns but never blocks — consistent with materials auto-bill.')}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button id="so-fulfill-cancel" variant="outline" onClick={() => setFulfillLine(null)}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button id="so-fulfill-submit" onClick={submitFulfill} disabled={busy !== null}>
                {busy?.startsWith('fulfill:')
                  ? t('salesOrders.actions.fulfilling', 'Fulfilling…')
                  : t('salesOrders.actions.fulfill', 'Fulfill')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* ---- Drop-ship confirm sub-dialog ---- */}
      <Dialog
        isOpen={dropShipLine !== null}
        onClose={() => setDropShipLine(null)}
        title={
          dropShipLine
            ? t('salesOrders.dropShipDialog.title', 'Confirm vendor shipment — {{name}}', {
                name: dropShipLine.service_name || dropShipLine.service_id,
              })
            : t('salesOrders.actions.confirmShipment', 'Confirm shipment')
        }
        id="so-dropship-dialog"
      >
        {dropShipLine && (
          <div className="space-y-4 p-1">
            {dropShipLine.is_serialized ? (
              <div className="space-y-2">
                <p className="text-sm text-gray-500">
                  {t('salesOrders.dropShipDialog.serialsNote', 'Enter the serials the vendor shipped (with MAC where applicable). Units are recorded as delivered to the client — on-hand is never touched.')}
                </p>
                {serialRows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2">
                    <div className="col-span-6">
                      <Input
                        id={`so-dropship-serial-${idx}`}
                        placeholder={t('salesOrders.dropShipDialog.serialPlaceholder', 'Serial number')}
                        value={row.serial_number}
                        onChange={(e) =>
                          setSerialRows((rows) =>
                            rows.map((r, i) => (i === idx ? { ...r, serial_number: e.target.value } : r)),
                          )
                        }
                      />
                    </div>
                    <div className="col-span-5">
                      <Input
                        id={`so-dropship-mac-${idx}`}
                        placeholder={t('salesOrders.dropShipDialog.macPlaceholder', 'MAC (optional)')}
                        value={row.mac_address}
                        onChange={(e) =>
                          setSerialRows((rows) =>
                            rows.map((r, i) => (i === idx ? { ...r, mac_address: e.target.value } : r)),
                          )
                        }
                      />
                    </div>
                    <div className="col-span-1">
                      <Button
                        id={`so-dropship-remove-${idx}`}
                        variant="ghost"
                        size="sm"
                        onClick={() => setSerialRows((rows) => rows.filter((_, i) => i !== idx))}
                        disabled={serialRows.length <= 1}
                      >
                        ✕
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  id="so-dropship-add-serial"
                  variant="outline"
                  size="sm"
                  onClick={() => setSerialRows((rows) => [...rows, { serial_number: '', mac_address: '' }])}
                >
                  {t('salesOrders.dropShipDialog.addSerial', 'Add serial')}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                {t('salesOrders.dropShipDialog.confirmNote', 'Confirm the vendor shipped the outstanding {{count}} unit(s) to the client. The line will be marked fulfilled; on-hand is never touched.', {
                  count: remainingOf(dropShipLine),
                })}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button id="so-dropship-cancel" variant="outline" onClick={() => setDropShipLine(null)}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button id="so-dropship-submit" onClick={submitDropShip} disabled={busy !== null}>
                {busy?.startsWith('dropship:')
                  ? t('salesOrders.actions.confirming', 'Confirming…')
                  : t('salesOrders.actions.confirmShipment', 'Confirm shipment')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* ---- Create drop-ship PO sub-dialog ---- */}
      <Dialog
        isOpen={createPoLine !== null}
        onClose={() => setCreatePoLine(null)}
        title={
          createPoLine
            ? t('salesOrders.createPoDialog.title', 'Create drop-ship PO — {{name}}', {
                name: createPoLine.service_name || createPoLine.service_id,
              })
            : ''
        }
        id="so-create-dropship-po-dialog"
      >
        {createPoLine && (
          <div className="space-y-4 p-1">
            <p className="text-sm text-gray-500">
              {t('salesOrders.createPoDialog.note', 'Orders the line\'s full quantity ({{quantity}}) from the vendor, shipped straight to the client. Once the vendor ships, use "Confirm shipment" to mark the line fulfilled.', {
                quantity: Number(createPoLine.quantity_ordered),
              })}
            </p>
            <CustomSelect
              id="so-create-dropship-po-vendor"
              label={t('salesOrders.createPoDialog.vendor', 'Vendor')}
              placeholder={t('salesOrders.createPoDialog.vendorPlaceholder', 'Select a vendor…')}
              value={createPoVendorId}
              onValueChange={setCreatePoVendorId}
              options={vendors.map((v) => ({ value: v.vendor_id, label: v.vendor_name }))}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button id="so-create-dropship-po-cancel" variant="outline" onClick={() => setCreatePoLine(null)}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button id="so-create-dropship-po-submit" onClick={submitCreatePo} disabled={busy !== null}>
                {busy?.startsWith('create-po:')
                  ? t('salesOrders.actions.creating', 'Creating…')
                  : t('salesOrders.actions.createPo', 'Create PO')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Dialog>
  );
}
