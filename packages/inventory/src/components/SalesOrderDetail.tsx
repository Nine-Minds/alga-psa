'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { toast } from 'react-hot-toast';
import type { ISalesOrder, IStockLocation, IVendor } from '@alga-psa/types';
import {
  getSalesOrder,
  computeBackorder,
  suggestPoFromBackorder,
  reopenSalesOrder,
  confirmDropShipShipment,
  createDropShipForSoLine,
  listVendors,
  listFulfillmentCandidateUnits,
  type SalesOrderLineDetail,
  type SalesOrderWithDetail,
  type BackorderLine,
  type FulfillmentCandidateUnit,
} from '../actions';

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

const STATUS_BADGES: Record<string, { label: string; variant: BadgeVariant }> = {
  draft: { label: 'Draft', variant: 'secondary' },
  confirmed: { label: 'Confirmed', variant: 'warning' },
  partially_fulfilled: { label: 'Partially fulfilled', variant: 'warning' },
  fulfilled: { label: 'Fulfilled', variant: 'success' },
  invoiced: { label: 'Invoiced', variant: 'success' },
  closed: { label: 'Closed', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'error' },
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
}

export function SalesOrderDetail({
  soId,
  onClose,
  onChanged,
  locations,
  fulfillAndInvoice,
  generateInvoice,
}: SalesOrderDetailProps) {
  const [so, setSo] = useState<SalesOrderWithDetail | null>(null);
  const [backorder, setBackorder] = useState<Map<string, BackorderLine>>(new Map());
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
    } catch (e: any) {
      toast.error(e?.message || "Couldn't load the sales order.");
    } finally {
      setLoading(false);
    }
  }, [soId]);

  useEffect(() => {
    setSo(null);
    setBackorder(new Map());
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
        toast.error(e?.message || "Couldn't load available units.");
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
        toast.error('Select at least one unit.');
        return;
      }
      input = { unit_ids: [...selectedUnits] };
    } else {
      const qty = Number(fulfillQty);
      const remaining = remainingOf(line);
      if (!Number.isInteger(qty) || qty <= 0) {
        toast.error('Quantity must be a positive whole number.');
        return;
      }
      if (qty > remaining) {
        toast.error(`Only ${remaining} remaining on this line.`);
        return;
      }
      input = { quantity: qty, ...(fulfillLocation ? { location_id: fulfillLocation } : {}) };
    }

    setBusy(`fulfill:${line.so_line_id}`);
    try {
      const result = await fulfillAndInvoice(line.so_line_id, input);
      toast.success(`Fulfilled ${result.fulfillment.quantity_fulfilled} unit(s).`);
      for (const w of result.fulfillment.warnings ?? []) toast(w, { icon: '⚠️' });
      if (result.invoice) {
        if (result.invoice.success && result.invoice.invoiced > 0) {
          toast.success(`Invoiced ${result.invoice.invoiced} item(s).`);
        } else if (!result.invoice.success) {
          toast.error(`Invoicing failed: ${result.invoice.error}. Use "Generate invoice" to retry.`);
        }
      }
      setFulfillLine(null);
      await changed();
    } catch (e: any) {
      toast.error(e?.message || 'Fulfillment failed.');
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
      toast.error('Enter at least one serial number.');
      return;
    }
    setBusy(`dropship:${line.so_line_id}`);
    try {
      const result = await confirmDropShipShipment({ so_line_id: line.so_line_id }, { serials });
      toast.success(`Shipment confirmed — ${result.quantity_fulfilled} unit(s) delivered.`);
      for (const w of result.warnings ?? []) toast(w, { icon: '⚠️' });
      setDropShipLine(null);
      await changed();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't confirm the shipment.");
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
      toast.error(e?.message || "Couldn't load vendors.");
    }
  };

  const submitCreatePo = async () => {
    if (!createPoLine || busy) return;
    if (!createPoVendorId) {
      toast.error('Pick the vendor that will ship this line.');
      return;
    }
    setBusy(`create-po:${createPoLine.so_line_id}`);
    try {
      const po = await createDropShipForSoLine(createPoLine.so_line_id, { vendor_id: createPoVendorId });
      toast.success(`Drop-ship PO ${po.po_number} created — confirm the shipment once the vendor ships.`);
      setCreatePoLine(null);
      await changed();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't create the drop-ship PO.");
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
          result.invoiced > 0 ? `Invoiced ${result.invoiced} item(s).` : 'Nothing left to invoice.',
        );
      } else {
        toast.error(result.error || 'Invoice generation failed.');
      }
      await changed();
    } catch (e: any) {
      toast.error(e?.message || 'Invoice generation failed.');
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
        toast.success(`Draft PO${result.purchaseOrders.length === 1 ? '' : 's'} created: ${poNumbers}`);
      }
      if (result.unassigned.length > 0) {
        toast(
          `${result.unassigned.length} backordered line(s) have no preferred vendor — create those POs manually.`,
          { icon: '⚠️' },
        );
      }
      if (result.purchaseOrders.length === 0 && result.unassigned.length === 0) {
        toast.success('Nothing is backordered.');
      }
      await changed();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't create the draft PO.");
    } finally {
      setBusy(null);
    }
  };

  const runReopen = async () => {
    if (!so || busy) return;
    setBusy('reopen');
    try {
      await reopenSalesOrder(so.so_id);
      toast.success('Sales order reopened — it is a draft again.');
      await changed();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't reopen the sales order.");
    } finally {
      setBusy(null);
    }
  };

  // ---- Render --------------------------------------------------------------

  const statusMeta = so ? STATUS_BADGES[so.status] ?? { label: so.status, variant: 'secondary' as BadgeVariant } : null;
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
    { value: '', label: 'Product default location' },
    ...locations.map((l) => ({ value: l.location_id, label: l.name })),
  ];

  return (
    <Dialog
      isOpen={soId !== null}
      onClose={onClose}
      title={so ? `Sales Order ${so.so_number}` : 'Sales Order'}
      id="sales-order-detail-dialog"
      className="max-w-4xl"
    >
      <div className="space-y-4 p-1" id="sales-order-detail">
        {loading && !so && <p className="text-sm text-gray-500">Loading…</p>}
        {so && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {statusMeta && (
                  <Badge variant={statusMeta.variant} size="sm">
                    {statusMeta.label}
                  </Badge>
                )}
                <span className="text-sm text-gray-500">
                  {(so as any).client_name || so.client_id} · {so.currency_code} ·{' '}
                  {so.invoice_mode === 'on_fulfillment' ? 'Bills on fulfillment' : 'Manual invoicing'}
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
                    {busy === 'reopen' ? 'Reopening…' : 'Reopen to draft'}
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
                    {busy === 'backorder-po' ? 'Creating…' : 'Create draft PO for backorder'}
                  </Button>
                )}
                {so.invoice_mode === 'manual' && so.status !== 'cancelled' && so.status !== 'draft' && (
                  <Button
                    id="so-detail-generate-invoice"
                    size="sm"
                    disabled={busy !== null || !hasUninvoiced}
                    onClick={runInvoice}
                  >
                    {busy === 'invoice' ? 'Invoicing…' : 'Generate invoice'}
                  </Button>
                )}
              </div>
            </div>

            <table className="w-full text-sm" id="so-detail-lines">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-2 font-medium">Product</th>
                  <th className="py-2 px-2 font-medium text-right">Ordered</th>
                  <th className="py-2 px-2 font-medium text-right">Fulfilled</th>
                  <th className="py-2 px-2 font-medium text-right">Invoiced</th>
                  <th className="py-2 px-2 font-medium text-right">Unit price</th>
                  <th className="py-2 px-2 font-medium">Availability</th>
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
                              Drop-ship
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
                          <Badge variant="error" size="sm">{`Backorder ${bo.shortfall}`}</Badge>
                        ) : line.track_stock && line.fulfillment_type !== 'drop_ship' ? (
                          <span className="text-xs text-gray-500">OK</span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
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
                                Confirm shipment
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
                              Create drop-ship PO
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
                            Fulfill
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}

        <div className="flex justify-end">
          <Button id="so-detail-close" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {/* ---- Fulfill sub-dialog ---- */}
      <Dialog
        isOpen={fulfillLine !== null}
        onClose={() => setFulfillLine(null)}
        title={fulfillLine ? `Fulfill — ${fulfillLine.service_name || fulfillLine.service_id}` : 'Fulfill'}
        id="so-fulfill-dialog"
      >
        {fulfillLine && (
          <div className="space-y-4 p-1">
            <p className="text-sm text-gray-500">
              {remainingOf(fulfillLine)} of {Number(fulfillLine.quantity_ordered)} remaining.
            </p>

            {fulfillLine.is_serialized ? (
              <div className="space-y-2">
                <Input
                  id="so-fulfill-unit-search"
                  placeholder="Search serial or MAC"
                  value={unitSearch}
                  onChange={(e) => setUnitSearch(e.target.value)}
                />
                {candidatesLoading && <p className="text-sm text-gray-500">Loading units…</p>}
                {!candidatesLoading && filteredCandidates.length === 0 && (
                  <p className="text-sm text-gray-500">No available units.</p>
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
                          Allocated to this order
                        </Badge>
                      )}
                      {u.foreign_soft_allocated && (
                        <Badge variant="warning" size="sm">
                          Soft-allocated to another order
                        </Badge>
                      )}
                    </label>
                  ))}
                </div>
                {hardHeldCount > 0 && (
                  <p className="text-xs text-gray-500">
                    {hardHeldCount} unit{hardHeldCount === 1 ? ' is' : 's are'} hard-held by other orders and not
                    shown.
                  </p>
                )}
                <p className="text-sm">
                  {selectedUnits.size} unit{selectedUnits.size === 1 ? '' : 's'} selected
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <Input
                  id="so-fulfill-quantity"
                  label="Quantity"
                  type="number"
                  min={1}
                  max={remainingOf(fulfillLine)}
                  value={fulfillQty}
                  onChange={(e) => setFulfillQty(e.target.value)}
                />
                <CustomSelect
                  id="so-fulfill-location"
                  label="Source location"
                  options={locationOptions}
                  value={fulfillLocation}
                  onValueChange={setFulfillLocation}
                />
                <p className="text-xs text-gray-500">
                  Short stock warns but never blocks — consistent with materials auto-bill.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button id="so-fulfill-cancel" variant="outline" onClick={() => setFulfillLine(null)}>
                Cancel
              </Button>
              <Button id="so-fulfill-submit" onClick={submitFulfill} disabled={busy !== null}>
                {busy?.startsWith('fulfill:') ? 'Fulfilling…' : 'Fulfill'}
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
            ? `Confirm vendor shipment — ${dropShipLine.service_name || dropShipLine.service_id}`
            : 'Confirm shipment'
        }
        id="so-dropship-dialog"
      >
        {dropShipLine && (
          <div className="space-y-4 p-1">
            {dropShipLine.is_serialized ? (
              <div className="space-y-2">
                <p className="text-sm text-gray-500">
                  Enter the serials the vendor shipped (with MAC where applicable). Units are recorded as
                  delivered to the client — on-hand is never touched.
                </p>
                {serialRows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2">
                    <div className="col-span-6">
                      <Input
                        id={`so-dropship-serial-${idx}`}
                        placeholder="Serial number"
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
                        placeholder="MAC (optional)"
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
                  Add serial
                </Button>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                Confirm the vendor shipped the outstanding {remainingOf(dropShipLine)} unit(s) to the client. The
                line will be marked fulfilled; on-hand is never touched.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button id="so-dropship-cancel" variant="outline" onClick={() => setDropShipLine(null)}>
                Cancel
              </Button>
              <Button id="so-dropship-submit" onClick={submitDropShip} disabled={busy !== null}>
                {busy?.startsWith('dropship:') ? 'Confirming…' : 'Confirm shipment'}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* ---- Create drop-ship PO sub-dialog ---- */}
      <Dialog
        isOpen={createPoLine !== null}
        onClose={() => setCreatePoLine(null)}
        title={createPoLine ? `Create drop-ship PO — ${createPoLine.service_name || createPoLine.service_id}` : ''}
        id="so-create-dropship-po-dialog"
      >
        {createPoLine && (
          <div className="space-y-4 p-1">
            <p className="text-sm text-gray-500">
              Orders the line's full quantity ({Number(createPoLine.quantity_ordered)}) from the vendor, shipped
              straight to the client. Once the vendor ships, use "Confirm shipment" to mark the line fulfilled.
            </p>
            <CustomSelect
              id="so-create-dropship-po-vendor"
              label="Vendor"
              placeholder="Select a vendor…"
              value={createPoVendorId}
              onValueChange={setCreatePoVendorId}
              options={vendors.map((v) => ({ value: v.vendor_id, label: v.vendor_name }))}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button id="so-create-dropship-po-cancel" variant="outline" onClick={() => setCreatePoLine(null)}>
                Cancel
              </Button>
              <Button id="so-create-dropship-po-submit" onClick={submitCreatePo} disabled={busy !== null}>
                {busy?.startsWith('create-po:') ? 'Creating…' : 'Create PO'}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Dialog>
  );
}
