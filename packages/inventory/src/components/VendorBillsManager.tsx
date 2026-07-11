'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { usePageCreateShortcut, useDialogSubmitShortcut } from '@alga-psa/ui/keyboard-shortcuts';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, IVendorBill, IVendor, VendorBillStatus } from '@alga-psa/types';
import {
  listVendorBills,
  getVendorBill,
  createVendorBill,
  createBillFromPo,
  setVendorBillStatus,
  listVendors,
  listPurchaseOrders,
  type VendorBillView,
} from '../actions';
import type { VendorBillExportStatus, VendorBillExportState } from '../lib/integrationTypes';

type BillRow = IVendorBill & { vendor_name: string | null; po_number: string | null };

interface VendorBillExportContext {
  integration: {
    adapterType: 'quickbooks_online' | 'xero';
    label: string;
  } | null;
  vendorBillsSupported: boolean;
}

// Billing actions cannot be imported here (inventory must not depend on billing); the
// vendor-bills server page injects them (F047, ghost-usage props idiom).
interface VendorBillExportProps {
  retryExportBill?: (billId: string) => Promise<VendorBillExportStatus | ActionMessageError | ActionPermissionError>;
  getExportStatuses?: (billIds: string[]) => Promise<VendorBillExportStatus[] | ActionMessageError | ActionPermissionError>;
  exportContext?: VendorBillExportContext;
}

interface CreateForm {
  vendor_id: string;
  bill_number: string;
  po_id: string;
}

const emptyCreate = (): CreateForm => ({ vendor_id: '', bill_number: '', po_id: '' });

type ReturnedActionError = ActionMessageError | ActionPermissionError;

const isReturnedActionError = (value: unknown): value is ReturnedActionError =>
  isActionMessageError(value) || isActionPermissionError(value);

export function VendorBillsManager({
  initialBills,
  loadErrorMessage,
  retryExportBill,
  getExportStatuses,
  exportContext,
}: { initialBills: BillRow[]; loadErrorMessage?: string } & VendorBillExportProps) {
  const { t } = useTranslation('features/inventory');
  const { money } = useCurrencyFormat();
  const [bills, setBills] = useState<BillRow[]>(initialBills || []);
  const [statusFilter, setStatusFilter] = useState('');
  const [vendors, setVendors] = useState<IVendor[]>([]);
  const [pos, setPos] = useState<Array<{ po_id: string; po_number: string; vendor_id: string }>>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyCreate());
  const [detail, setDetail] = useState<VendorBillView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [exportStatuses, setExportStatuses] = useState<Map<string, VendorBillExportStatus>>(new Map());
  const [exporting, setExporting] = useState<string | null>(null);
  const showExportState = Boolean(exportContext?.integration && exportContext.vendorBillsSupported && getExportStatuses);

  const EXPORT_BADGES: Record<VendorBillExportState, { label: string; variant: BadgeVariant }> = {
    not_exported: { label: t('vendorBills.export.notExported', 'Not exported'), variant: 'secondary' },
    pending: { label: t('vendorBills.export.pending', 'Export pending'), variant: 'warning' },
    exported: { label: t('vendorBills.export.exported', 'Exported'), variant: 'success' },
    error: { label: t('vendorBills.export.error', 'Export failed'), variant: 'error' },
  };

  const STATUS_BADGES: Record<string, { label: string; variant: BadgeVariant }> = {
    draft: { label: t('vendorBills.status.draft', 'Draft'), variant: 'secondary' },
    open: { label: t('vendorBills.status.open', 'Open'), variant: 'warning' },
    paid: { label: t('vendorBills.status.paid', 'Paid'), variant: 'success' },
    void: { label: t('vendorBills.status.void', 'Void'), variant: 'error' },
  };

  const reload = useCallback(async () => {
    try {
      const result = await listVendorBills();
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      setBills(result);
    } catch (e: any) {
      toast.error(e?.message || t('vendorBills.loadError', "Couldn't load vendor bills."));
    }
  }, [t]);

  useEffect(() => {
    if (loadErrorMessage) {
      toast.error(loadErrorMessage);
    }
  }, [loadErrorMessage]);

  useEffect(() => {
    listVendors({ includeInactive: false })
      .then((rows) => {
        if (isReturnedActionError(rows)) {
          setVendors([]);
          return;
        }
        setVendors(rows);
      })
      .catch(() => setVendors([]));
    listPurchaseOrders()
      .then((rows) => {
        if (isActionMessageError(rows) || isActionPermissionError(rows)) {
          setPos([]);
          return;
        }
        setPos(rows.map((r) => ({ po_id: r.po_id, po_number: r.po_number, vendor_id: r.vendor_id })));
      })
      .catch(() => setPos([]));
  }, []);

  // Batch-load export statuses for the current bills (F047). Best-effort: a failure
  // (or no injected action) simply leaves the badges off.
  useEffect(() => {
    if (!showExportState || !getExportStatuses || bills.length === 0) return;
    let cancelled = false;
    getExportStatuses(bills.map((b) => b.bill_id))
      .then((rows) => {
        if (isActionMessageError(rows) || isActionPermissionError(rows)) {
          return;
        }
        if (!cancelled) setExportStatuses(new Map(rows.map((r) => [r.bill_id, r])));
      })
      .catch(() => {
        /* no badges */
      });
    return () => {
      cancelled = true;
    };
  }, [showExportState, getExportStatuses, bills]);

  const openCreate = () => setCreateOpen(true);
  usePageCreateShortcut(openCreate);

  const doRetryExport = async (bill: BillRow) => {
    if (!retryExportBill) return;
    setExporting(bill.bill_id);
    try {
      const status = await retryExportBill(bill.bill_id);
      if (isReturnedActionError(status)) {
        toast.error(getErrorMessage(status));
        return;
      }
      setExportStatuses((prev) => new Map(prev).set(bill.bill_id, status));
      if (status.state === 'exported') {
        toast.success(t('vendorBills.exportedToAccounting', 'Exported to accounting.'));
      } else if (status.state === 'error') {
        toast.error(status.error_message || t('vendorBills.exportFailed', 'Export failed.'));
      } else {
        toast.success(t('vendorBills.exportQueued', 'Export queued.'));
      }
    } catch (e: any) {
      toast.error(e?.message || t('vendorBills.exportError', "Couldn't retry the export."));
    } finally {
      setExporting(null);
    }
  };

  const create = async () => {
    if (!form.bill_number.trim()) {
      toast.error(t('vendorBills.billNumberRequired', 'Enter the vendor’s bill number.'));
      return;
    }
    setBusy('create');
    try {
      if (!form.po_id && !form.vendor_id) {
        toast.error(t('vendorBills.pickVendor', 'Pick a vendor (or a PO to prefill from).'));
        return;
      }
      // Prefill from the PO's received quantities/costs (F078).
      const result = form.po_id
        ? await createBillFromPo(form.po_id, form.bill_number.trim())
        : await createVendorBill({ vendor_id: form.vendor_id, bill_number: form.bill_number.trim() });
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('vendorBills.billCreated', 'Bill created (draft).'));
      setCreateOpen(false);
      setForm(emptyCreate());
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('vendorBills.createError', "Couldn't create the bill."));
    } finally {
      setBusy(null);
    }
  };
  useDialogSubmitShortcut(
    () => { void create(); },
    { active: createOpen, enabled: createOpen && busy === null },
  );

  const transition = async (bill: BillRow, status: VendorBillStatus) => {
    setBusy(`${status}:${bill.bill_id}`);
    try {
      const result = await setVendorBillStatus(bill.bill_id, status);
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        await reload();
        return;
      }
      toast.success(
        status === 'paid'
          ? t('vendorBills.billPaid', 'Bill marked paid.')
          : status === 'void'
            ? t('vendorBills.billVoided', 'Bill voided.')
            : t('vendorBills.billOpened', 'Bill opened.'),
      );
      await reload();
    } catch (e: any) {
      toast.error(e?.message || t('vendorBills.updateError', "Couldn't update the bill."));
    } finally {
      setBusy(null);
    }
  };

  const openDetail = async (bill: BillRow) => {
    try {
      const result = await getVendorBill(bill.bill_id);
      if (isReturnedActionError(result)) {
        toast.error(getErrorMessage(result));
        await reload();
        return;
      }
      setDetail(result);
    } catch (e: any) {
      toast.error(e?.message || t('vendorBills.billLoadError', "Couldn't load the bill."));
    }
  };

  const columns: ColumnDefinition<BillRow>[] = [
    {
      title: t('vendorBills.columns.billNumber', 'Bill #'),
      dataIndex: 'bill_number',
      render: (v: any, rec) => (
        <button
          id={`view-bill-${rec.bill_id}`}
          type="button"
          className="text-primary-600 hover:underline font-medium"
          onClick={() => openDetail(rec)}
        >
          {v}
        </button>
      ),
    },
    { title: t('vendorBills.columns.vendor', 'Vendor'), dataIndex: 'vendor_name', render: (v: any, rec) => v || rec.vendor_id },
    { title: t('vendorBills.columns.po', 'PO'), dataIndex: 'po_number', render: (v: any) => v || t('common.emptyValue', '—') },
    {
      title: t('vendorBills.columns.due', 'Due'),
      dataIndex: 'due_date',
      render: (v: any, rec) => {
        if (!v) return '—';
        const overdue = rec.status !== 'paid' && rec.status !== 'void' && new Date(v).getTime() < Date.now();
        return (
          <span className={overdue ? 'text-red-600 font-medium' : undefined}>
            {new Date(v).toLocaleDateString()}
          </span>
        );
      },
    },
    {
      title: t('common.total', 'Total'),
      dataIndex: 'total_amount',
      render: (v: any, rec) => <span className="tabular-nums">{money(Number(v), rec.currency_code)}</span>,
    },
    {
      title: t('common.status', 'Status'),
      dataIndex: 'status',
      render: (v: any) => {
        const meta = STATUS_BADGES[v] ?? { label: String(v), variant: 'secondary' as BadgeVariant };
        return (
          <Badge variant={meta.variant} size="sm">
            {meta.label}
          </Badge>
        );
      },
    },
    {
      title: t('common.actions', 'Actions'),
      dataIndex: 'bill_id',
      width: '320px',
      render: (_: any, rec) => {
        const exp = exportStatuses.get(rec.bill_id);
        const expMeta = exp ? EXPORT_BADGES[exp.state] : null;
        return (
          <div className="flex flex-wrap items-center gap-2">
            {rec.status === 'draft' && (
              <Button
                id={`open-bill-${rec.bill_id}`}
                variant="soft"
                size="sm"
                disabled={busy !== null}
                onClick={() => transition(rec, 'open')}
              >
                {t('vendorBills.actions.open', 'Open')}
              </Button>
            )}
            {rec.status === 'open' && (
              <Button
                id={`pay-bill-${rec.bill_id}`}
                variant="soft"
                size="sm"
                disabled={busy !== null}
                onClick={() => transition(rec, 'paid')}
              >
                {t('vendorBills.actions.markPaid', 'Mark paid')}
              </Button>
            )}
            {(rec.status === 'draft' || rec.status === 'open') && (
              <Button
                id={`void-bill-${rec.bill_id}`}
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() => transition(rec, 'void')}
              >
                {t('vendorBills.actions.void', 'Void')}
              </Button>
            )}
            {showExportState && (
              <>
                {expMeta && (
                  <Badge
                    id={`vendor-bill-export-badge-${rec.bill_id}`}
                    variant={expMeta.variant}
                    size="sm"
                    title={exp?.error_message ?? undefined}
                  >
                    {expMeta.label}
                  </Badge>
                )}
                {exp?.state === 'error' && retryExportBill && (
                  <Button
                    id={`vendor-bill-export-retry-${rec.bill_id}`}
                    variant="outline"
                    size="sm"
                    disabled={exporting === rec.bill_id}
                    onClick={() => doRetryExport(rec)}
                  >
                    {exporting === rec.bill_id
                      ? t('vendorBills.export.retrying', 'Retrying…')
                      : t('vendorBills.export.retry', 'Retry')}
                  </Button>
                )}
              </>
            )}
          </div>
        );
      },
    },
  ];

  const filtered = statusFilter ? bills.filter((b) => b.status === statusFilter) : bills;

  return (
    <div className="p-6 space-y-4" id="vendor-bills-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('vendorBills.title', 'Vendor Bills')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {t('vendorBills.subtitle', 'Light AP: track what vendors invoiced against what you received. No GL — mark paid manually.')}
          </p>
        </div>
        <Button id="vendor-bills-add-button" onClick={openCreate}>
          {t('vendorBills.addBill', 'Add bill')}
        </Button>
      </div>

      <div className="w-52">
        <CustomSelect
          id="vendor-bills-status-filter"
          value={statusFilter}
          onValueChange={setStatusFilter}
          options={[
            { value: '', label: t('vendorBills.allStatuses', 'All statuses') },
            { value: 'draft', label: t('vendorBills.status.draft', 'Draft') },
            { value: 'open', label: t('vendorBills.status.open', 'Open') },
            { value: 'paid', label: t('vendorBills.status.paid', 'Paid') },
            { value: 'void', label: t('vendorBills.status.void', 'Void') },
          ]}
        />
      </div>

      <DataTable id="vendor-bills-table" data={filtered} columns={columns} />

      {/* ---- Create dialog ---- */}
      <Dialog isOpen={createOpen} onClose={() => setCreateOpen(false)} title={t('vendorBills.dialog.createTitle', 'Add vendor bill')} id="vendor-bill-create-dialog">
        <div className="space-y-4 p-1">
          <Input
            id="vendor-bill-number"
            label={t('vendorBills.fields.billNumber', "Vendor's bill number")}
            required
            value={form.bill_number}
            onChange={(e) => setForm({ ...form, bill_number: e.target.value })}
          />
          <CustomSelect
            id="vendor-bill-po"
            label={t('vendorBills.fields.prefillPo', 'Prefill from purchase order (optional)')}
            placeholder={t('vendorBills.fields.noPoPlaceholder', 'No PO — blank bill')}
            value={form.po_id}
            onValueChange={(value) => setForm({ ...form, po_id: value })}
            options={[{ value: '', label: t('vendorBills.fields.noPoPlaceholder', 'No PO — blank bill') }, ...pos.map((p) => ({ value: p.po_id, label: p.po_number }))]}
          />
          {!form.po_id && (
            <CustomSelect
              id="vendor-bill-vendor"
              label={t('vendorBills.fields.vendor', 'Vendor')}
              placeholder={t('vendorBills.fields.vendorPlaceholder', 'Select a vendor…')}
              value={form.vendor_id}
              onValueChange={(value) => setForm({ ...form, vendor_id: value })}
              options={vendors.map((v) => ({ value: v.vendor_id, label: v.vendor_name }))}
            />
          )}
          <p className="text-xs text-gray-500">
            {t('vendorBills.createHint', "The due date defaults from the vendor's payment terms. Bills prefilled from a PO copy the received quantities and costs.")}
          </p>
          <div className="flex justify-end gap-2">
            <Button id="vendor-bill-create-cancel" variant="outline" onClick={() => setCreateOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="vendor-bill-create-save" onClick={create} disabled={busy !== null}>
              {busy === 'create' ? t('vendorBills.creating', 'Creating…') : t('vendorBills.createBill', 'Create bill')}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ---- Detail dialog ---- */}
      <Dialog
        isOpen={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? t('vendorBills.dialog.detailTitle', 'Bill {{number}} — {{vendor}}', { number: detail.bill_number, vendor: detail.vendor_name || '' }) : t('vendorBills.dialog.billTitle', 'Bill')}
        id="vendor-bill-detail-dialog"
        className="max-w-2xl"
      >
        {detail && (
          <div className="space-y-3 p-1">
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <Badge variant={(STATUS_BADGES[detail.status] ?? { variant: 'secondary' }).variant as BadgeVariant} size="sm">
                {(STATUS_BADGES[detail.status] ?? { label: detail.status }).label}
              </Badge>
              {detail.po_number && <span>{t('vendorBills.detailPo', 'PO {{number}}', { number: detail.po_number })}</span>}
              {detail.due_date && <span>{t('vendorBills.detailDue', 'Due {{date}}', { date: new Date(detail.due_date).toLocaleDateString() })}</span>}
              <span className="ml-auto tabular-nums font-medium">{money(detail.total_amount, detail.currency_code)}</span>
            </div>

            {/* 2-way match indicator (F080) — advisory, never blocking. */}
            {detail.variance_vs_received_cents != null && (
              <p
                className={
                  detail.variance_vs_received_cents === 0
                    ? 'text-sm text-green-700'
                    : 'text-sm text-amber-700 font-medium'
                }
                id="vendor-bill-variance"
              >
                {detail.variance_vs_received_cents === 0
                  ? t('vendorBills.matchesPoValue', 'Matches the PO’s received value.')
                  : detail.variance_vs_received_cents > 0
                    ? t('vendorBills.billedAbove', 'Billed above received value by {{amount}}.', {
                        amount: money(Math.abs(detail.variance_vs_received_cents), detail.currency_code),
                      })
                    : t('vendorBills.billedBelow', 'Billed below received value by {{amount}}.', {
                        amount: money(Math.abs(detail.variance_vs_received_cents), detail.currency_code),
                      })}
              </p>
            )}

            {detail.lines.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-1 pr-2 font-medium">{t('vendorBills.columns.line', 'Line')}</th>
                    <th className="py-1 px-2 font-medium text-right">{t('vendorBills.columns.qty', 'Qty')}</th>
                    <th className="py-1 px-2 font-medium text-right">{t('vendorBills.columns.unitCost', 'Unit cost')}</th>
                    <th className="py-1 px-2 font-medium text-right">{t('vendorBills.columns.amount', 'Amount')}</th>
                    <th className="py-1 pl-2 font-medium text-right">{t('vendorBills.columns.vsPo', 'vs PO')}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((l) => (
                    <tr key={l.bill_line_id} className="border-b last:border-0">
                      <td className="py-1 pr-2">{l.service_name || l.description || t('common.emptyValue', '—')}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{l.quantity}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{money(l.unit_cost, detail.currency_code)}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{money(l.amount, detail.currency_code)}</td>
                      <td className="py-1 pl-2 text-right">
                        {l.line_variance_cents == null ? (
                          <span className="text-gray-400">{t('common.emptyValue', '—')}</span>
                        ) : l.line_variance_cents === 0 ? (
                          <span className="text-xs text-gray-500">{t('vendorBills.matchesPo', 'matches PO')}</span>
                        ) : (
                          <span
                            id={`bill-line-variance-${l.bill_line_id}`}
                            className={`text-xs tabular-nums ${
                              l.line_variance_cents > 0 ? 'text-red-600' : 'text-green-600'
                            }`}
                          >
                            {l.line_variance_cents > 0 ? '+' : ''}
                            {money(l.line_variance_cents, detail.currency_code)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="flex justify-end">
              <Button id="vendor-bill-detail-close" variant="outline" onClick={() => setDetail(null)}>
                {t('common.close', 'Close')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
