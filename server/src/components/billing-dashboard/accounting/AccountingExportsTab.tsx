'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AccountingExportBatch,
  AccountingExportLine,
  AccountingExportError,
  AccountingExportStatus
} from 'server/src/interfaces/accountingExport.interfaces';
import {
  InvoiceStatus,
  INVOICE_STATUS_METADATA,
  INVOICE_STATUS_DISPLAY_ORDER,
  DEFAULT_ACCOUNTING_EXPORT_STATUSES
} from 'server/src/interfaces/invoice.interfaces';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { DataTable } from 'server/src/components/ui/DataTable';
import Drawer from 'server/src/components/ui/Drawer';
import { Dialog } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Badge, BadgeVariant } from 'server/src/components/ui/Badge';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { formatCurrency, formatDate } from 'server/src/lib/utils/formatters';
import {
  listAccountingExportBatches,
  getAccountingExportBatch,
  createAccountingExportBatch,
  updateAccountingExportBatchStatus,
  executeAccountingExportBatch,
  previewAccountingExport
} from 'server/src/lib/actions/accountingExportActions';
import type { AccountingExportPreviewResult } from 'server/src/lib/actions/accountingExportActions';
import {
  getXeroConnectionStatus,
  type XeroConnectionStatus
} from 'server/src/lib/actions/integrations/xeroActions';

type BatchDetail = {
  batch: AccountingExportBatch | null;
  lines: AccountingExportLine[];
  errors: AccountingExportError[];
};

interface AccountingExportRow {
  batch_id: string;
  display_id: string;
  adapter_type: string;
  status: AccountingExportStatus;
  created_at: string;
  updated_at: string;
  target_realm?: string | null;
  created_by?: string | null;
  raw: AccountingExportBatch;
}

type AdapterType = 'quickbooks_online' | 'quickbooks_desktop' | 'xero';

interface CreateFormState {
  adapterType: AdapterType;
  targetRealm: string;
  startDate: string;
  endDate: string;
  invoiceStatuses: InvoiceStatus[];
  notes: string;
}

const STATUS_OPTIONS: Array<{ label: string; value: AccountingExportStatus | 'all' }> = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Validating', value: 'validating' },
  { label: 'Ready', value: 'ready' },
  { label: 'Delivered', value: 'delivered' },
  { label: 'Posted', value: 'posted' },
  { label: 'Failed', value: 'failed' },
  { label: 'Cancelled', value: 'cancelled' },
  { label: 'Needs Attention', value: 'needs_attention' }
];

const ADAPTER_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'QuickBooks Online', value: 'quickbooks_online' },
  { label: 'QuickBooks Desktop', value: 'quickbooks_desktop' },
  { label: 'Xero', value: 'xero' }
];

const STATUS_VARIANT: Record<AccountingExportStatus, BadgeVariant> = {
  pending: 'outline',
  validating: 'secondary',
  ready: 'primary',
  delivered: 'success',
  posted: 'primary',
  failed: 'error',
  cancelled: 'outline',
  needs_attention: 'warning'
};

const INVOICE_STATUS_OPTIONS = INVOICE_STATUS_DISPLAY_ORDER.map((status) => {
  const metadata = INVOICE_STATUS_METADATA[status];
  return {
    label: metadata.label,
    value: status,
    description: metadata.description,
    recommended: Boolean(metadata.isDefaultForAccountingExport)
  };
});

const createDefaultCreateForm = (): CreateFormState => ({
  adapterType: 'quickbooks_online',
  targetRealm: '',
  startDate: '',
  endDate: '',
  invoiceStatuses: [...DEFAULT_ACCOUNTING_EXPORT_STATUSES],
  notes: ''
});

function truncateId(batchId: string): string {
  if (batchId.length <= 8) return batchId;
  return `${batchId.slice(0, 6)}…${batchId.slice(-4)}`;
}

function statusLabel(status: AccountingExportStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'validating':
      return 'Validating';
    case 'ready':
      return 'Ready';
    case 'delivered':
      return 'Delivered';
    case 'posted':
      return 'Posted';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    case 'needs_attention':
      return 'Needs Attention';
    default:
      return status;
  }
}

const localDateString = (value: string | null | undefined) => {
  if (!value) {
    return '';
  }
  return formatDate(value);
};

const amountFromCents = (amountCents: number, currency?: string | null) => {
  const safeCurrency = currency ?? 'USD';
  return formatCurrency(amountCents / 100, undefined, safeCurrency);
};

const formatServicePeriod = (start: string | null, end: string | null) => {
  if (!start && !end) {
    return '—';
  }
  const formattedStart = start ? formatDate(start) : '—';
  const formattedEnd = end ? formatDate(end) : '—';
  return `${formattedStart} → ${formattedEnd}`;
};

const formatTotalsSummary = (totals: Record<string, number>) => {
  const entries = Object.entries(totals);
  if (entries.length === 0) {
    return '—';
  }
  return entries
    .map(([currency, cents]) => `${formatCurrency(cents / 100, undefined, currency)} (${currency})`)
    .join(', ');
};

const normalizeInvoiceStatuses = (statuses: InvoiceStatus[]): InvoiceStatus[] =>
  Array.from(new Set(statuses));

const AccountingExportsTab: React.FC = () => {
  const [filters, setFilters] = useState({
    status: 'all' as AccountingExportStatus | 'all',
    adapter: 'all',
    startDate: '',
    endDate: '',
    client: ''
  });
  const [batches, setBatches] = useState<AccountingExportBatch[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<AccountingExportRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [batchDetail, setBatchDetail] = useState<BatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState<boolean>(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(() => createDefaultCreateForm());
  const [creating, setCreating] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [detailActionError, setDetailActionError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<AccountingExportPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [xeroStatus, setXeroStatus] = useState<XeroConnectionStatus | null>(null);
  const [xeroStatusError, setXeroStatusError] = useState<string | null>(null);
  const [xeroStatusLoading, setXeroStatusLoading] = useState<boolean>(false);

  const resetPreviewState = () => {
    setPreviewData(null);
    setPreviewError(null);
  };

  const updateCreateFormField = (field: Exclude<keyof CreateFormState, 'invoiceStatuses'>, value: string) => {
    setCreateForm((prev) => ({ ...prev, [field]: value }));
    resetPreviewState();
  };

  const applyInvoiceStatuses = (statuses: InvoiceStatus[]) => {
    setCreateForm((prev) => ({
      ...prev,
      invoiceStatuses: normalizeInvoiceStatuses(statuses)
    }));
    resetPreviewState();
  };

  const handleInvoiceStatusChange = (status: InvoiceStatus, checked: boolean) => {
    setCreateForm((prev) => {
      const nextStatuses = checked
        ? normalizeInvoiceStatuses([...prev.invoiceStatuses, status])
        : prev.invoiceStatuses.filter((current) => current !== status);
      return { ...prev, invoiceStatuses: nextStatuses };
    });
    resetPreviewState();
  };

  const resetCreateDialog = (force = false) => {
    if (!force && creating) return;
    setCreateDialogOpen(false);
    setCreateForm(createDefaultCreateForm());
    setCreateError(null);
    resetPreviewState();
  };

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: { status?: AccountingExportStatus; adapter_type?: string } = {};
      if (filters.status !== 'all') {
        params.status = filters.status;
      }
      if (filters.adapter !== 'all') {
        params.adapter_type = filters.adapter;
      }
      const data: AccountingExportBatch[] = await listAccountingExportBatches(params);
      setBatches(data);
      setSelectedRow((prev) => {
        if (!prev) return prev;
        const updated = data.find((batch) => batch.batch_id === prev.batch_id);
        if (!updated) return prev;
        return {
          ...prev,
          status: updated.status,
          created_at: updated.created_at,
          updated_at: updated.updated_at,
          target_realm: updated.target_realm ?? null,
          created_by: updated.created_by ?? null,
          display_id: truncateId(updated.batch_id),
          raw: updated
        };
      });
    } catch (err: any) {
      console.error('Error fetching accounting export batches:', err);
      setError(err?.message ?? 'Failed to load export batches.');
    } finally {
      setLoading(false);
    }
  }, [filters.adapter, filters.status]);

  const fetchBatchDetail = useCallback(async (batchId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const data = await getAccountingExportBatch(batchId);
      setBatchDetail(data);
    } catch (err: any) {
      console.error('Error fetching batch detail:', err);
      setDetailError(err?.message ?? 'Unable to load batch detail.');
      setBatchDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const refreshDetail = useCallback(async () => {
    if (selectedRow) {
      await fetchBatchDetail(selectedRow.batch_id);
    }
  }, [fetchBatchDetail, selectedRow]);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  const filteredBatches = useMemo(() => {
    const { startDate, endDate, client } = filters;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    return batches.filter((batch) => {
      const createdAt = new Date(batch.created_at);
      if (start && createdAt < start) return false;
      if (end) {
        const endOfDay = new Date(end);
        endOfDay.setHours(23, 59, 59, 999);
        if (createdAt > endOfDay) return false;
      }
      if (client) {
        const candidate = typeof batch.filters?.client === 'string'
          ? batch.filters.client
          : typeof (batch.filters as Record<string, unknown> | null)?.client_name === 'string'
            ? (batch.filters as Record<string, unknown>).client_name as string
            : '';
        if (!candidate.toLowerCase().includes(client.toLowerCase())) {
          return false;
        }
      }
      return true;
    });
  }, [batches, filters.client, filters.endDate, filters.startDate]);

  const tableData: AccountingExportRow[] = useMemo(() => {
    return filteredBatches.map((batch) => ({
      batch_id: batch.batch_id,
      display_id: truncateId(batch.batch_id),
      adapter_type: batch.adapter_type,
      status: batch.status,
      created_at: batch.created_at,
      updated_at: batch.updated_at,
      target_realm: batch.target_realm ?? null,
      created_by: batch.created_by ?? null,
      raw: batch
    }));
  }, [filteredBatches]);

  const columns: ColumnDefinition<AccountingExportRow>[] = useMemo(
    () => [
      {
        title: 'Batch ID',
        dataIndex: 'display_id'
      },
      {
        title: 'Adapter',
        dataIndex: 'adapter_type',
        render: (value: string) => {
          switch (value) {
            case 'quickbooks_online':
              return 'QuickBooks Online';
            case 'quickbooks_desktop':
              return 'QuickBooks Desktop';
            case 'xero':
              return 'Xero';
            default:
              return value;
          }
        }
      },
      {
        title: 'Status',
        dataIndex: 'status',
        render: (value: AccountingExportStatus) => (
          <Badge variant={STATUS_VARIANT[value]}>{statusLabel(value)}</Badge>
        )
      },
      {
        title: 'Created',
        dataIndex: 'created_at',
        render: (value: string) => localDateString(value)
      },
      {
        title: 'Updated',
        dataIndex: 'updated_at',
        render: (value: string) => localDateString(value)
      },
      {
        title: 'Target Realm',
        dataIndex: 'target_realm',
        render: (value: string | null) => value || '—'
      }
    ],
    []
  );

  const handleRowClick = useCallback(
    async (row: AccountingExportRow) => {
      setSelectedRow(row);
      setDrawerOpen(true);
      await fetchBatchDetail(row.batch_id);
    },
    [fetchBatchDetail]
  );

  const resetFilters = () => {
    setFilters({
      status: 'all',
      adapter: 'all',
      startDate: '',
      endDate: '',
      client: ''
    });
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const invoiceStatuses = normalizeInvoiceStatuses(createForm.invoiceStatuses);
      const data = await previewAccountingExport({
        startDate: createForm.startDate || undefined,
        endDate: createForm.endDate || undefined,
        invoiceStatuses: invoiceStatuses.length > 0 ? invoiceStatuses : undefined
      });
      setPreviewData(data);
    } catch (err: any) {
      console.error('Error generating export preview:', err);
      setPreviewError(err?.message ?? 'Unable to generate preview.');
      setPreviewData(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const invoiceStatuses = normalizeInvoiceStatuses(createForm.invoiceStatuses);
      if (createForm.adapterType === 'xero' && !createForm.targetRealm.trim()) {
        throw new Error('Select a Xero connection before creating an export batch.');
      }
      const body = {
        adapter_type: createForm.adapterType,
        export_type: 'invoice',
        target_realm: createForm.targetRealm || null,
        filters: {
          start_date: createForm.startDate || undefined,
          end_date: createForm.endDate || undefined,
          invoice_statuses: invoiceStatuses.length > 0 ? invoiceStatuses : undefined
        },
        notes: createForm.notes || undefined
      };

      const createdBatch = await createAccountingExportBatch(body);
      resetCreateDialog(true);
      await fetchBatches();
      await handleRowClick({
        batch_id: createdBatch.batch_id,
        display_id: truncateId(createdBatch.batch_id),
        adapter_type: createdBatch.adapter_type,
        status: createdBatch.status,
        created_at: createdBatch.created_at,
        updated_at: createdBatch.updated_at,
        target_realm: createdBatch.target_realm ?? null,
        created_by: createdBatch.created_by ?? null,
        raw: createdBatch
      });
    } catch (err: any) {
      console.error('Error creating export batch:', err);
      setCreateError(err?.message ?? 'Unable to create export batch.');
    } finally {
      setCreating(false);
    }
  };

  const updateBatchStatus = async (status: AccountingExportStatus) => {
    if (!selectedRow) return;
    setActionLoading(true);
    setDetailActionError(null);
    try {
      await updateAccountingExportBatchStatus(selectedRow.batch_id, { status });
      await refreshDetail();
      await fetchBatches();
    } catch (err: any) {
      console.error('Error updating batch status:', err);
      setDetailActionError(err?.message ?? 'Failed to update status.');
    } finally {
      setActionLoading(false);
    }
  };

  const executeBatch = async () => {
    if (!selectedRow) return;
    setActionLoading(true);
    setDetailActionError(null);
    try {
      await executeAccountingExportBatch(selectedRow.batch_id);
      await refreshDetail();
      await fetchBatches();
    } catch (err: any) {
      console.error('Error executing batch:', err);
      setDetailActionError(err?.message ?? 'Execution failed.');
    } finally {
      setActionLoading(false);
    }
  };

  const filteredLines = useMemo(() => batchDetail?.lines ?? [], [batchDetail]);
  const totalAmount = useMemo(() => {
    if (!batchDetail?.lines) return 0;
    return batchDetail.lines.reduce((sum, line) => sum + line.amount_cents, 0);
  }, [batchDetail]);

  const currencyFromLines = batchDetail?.lines?.[0]?.currency_code ?? 'USD';

  useEffect(() => {
    if (!createDialogOpen || createForm.adapterType !== 'xero') {
      return;
    }

    if (!xeroStatus && !xeroStatusLoading) {
      setXeroStatusLoading(true);
      void getXeroConnectionStatus()
        .then((status) => {
          setXeroStatus(status);
          setXeroStatusError(status.error ?? null);
        })
        .catch((err: any) => {
          console.error('Error loading Xero connection status:', err);
          setXeroStatusError(err?.message ?? 'Unable to load Xero connections.');
        })
        .finally(() => {
          setXeroStatusLoading(false);
        });
      return;
    }

    if (!createForm.targetRealm && xeroStatus && xeroStatus.connections?.length) {
      const defaultRealm =
        xeroStatus.defaultConnectionId ?? xeroStatus.connections[0]?.connectionId ?? '';
      if (defaultRealm) {
        setCreateForm((prev) => (prev.targetRealm ? prev : { ...prev, targetRealm: defaultRealm }));
      }
    }
  }, [
    createDialogOpen,
    createForm.adapterType,
    createForm.targetRealm,
    xeroStatus,
    xeroStatusLoading
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
          <select
            value={filters.status}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value as AccountingExportStatus | 'all' }))}
            className="border rounded-md px-3 py-2 text-sm"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Adapter</label>
          <select
            value={filters.adapter}
            onChange={(e) => setFilters((prev) => ({ ...prev, adapter: e.target.value }))}
            className="border rounded-md px-3 py-2 text-sm"
          >
            {ADAPTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => setFilters((prev) => ({ ...prev, startDate: e.target.value }))}
            className="border rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => setFilters((prev) => ({ ...prev, endDate: e.target.value }))}
            className="border rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
          <input
            type="text"
            placeholder="Filter by client"
            value={filters.client}
            onChange={(e) => setFilters((prev) => ({ ...prev, client: e.target.value }))}
            className="border rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-2 ml-auto">
          <Button id="accounting-export-refresh" variant="outline" onClick={fetchBatches} disabled={loading}>
            Refresh
          </Button>
          <Button id="accounting-export-reset" variant="ghost" onClick={resetFilters}>
            Reset Filters
          </Button>
          <Button
            id="accounting-export-new"
            onClick={() => {
              setCreateError(null);
              setCreateForm(createDefaultCreateForm());
              resetPreviewState();
              setCreateDialogOpen(true);
            }}
          >
            New Export
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-sm text-gray-500">Loading export batches…</div>
      )}

      <DataTable<AccountingExportRow>
        id="accounting-export-table"
        data={tableData}
        columns={columns}
        pagination
        onRowClick={handleRowClick}
      />

      <Drawer
        isOpen={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedRow(null);
          setBatchDetail(null);
          setDetailActionError(null);
        }}
      >
        {selectedRow && (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold">Batch {selectedRow.batch_id}</h2>
                <p className="text-sm text-gray-500">
                  Created {localDateString(selectedRow.created_at)} · Adapter:{' '}
                  {selectedRow.adapter_type === 'quickbooks_online'
                    ? 'QuickBooks Online'
                    : selectedRow.adapter_type === 'quickbooks_desktop'
                      ? 'QuickBooks Desktop'
                      : 'Xero'}
                </p>
              </div>
              <Badge variant={STATUS_VARIANT[selectedRow.status]}>{statusLabel(selectedRow.status)}</Badge>
            </div>

            {detailActionError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded">
                {detailActionError}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                id="accounting-export-execute"
                variant="default"
                onClick={executeBatch}
                disabled={actionLoading || selectedRow.status === 'delivered' || selectedRow.status === 'posted'}
              >
                Execute Export
              </Button>
              <Button
                id="accounting-export-mark-posted"
                variant="secondary"
                onClick={() => updateBatchStatus('posted')}
                disabled={actionLoading || selectedRow.status !== 'delivered'}
              >
                Mark as Posted
              </Button>
              <Button
                id="accounting-export-cancel"
                variant="outline"
                onClick={() => updateBatchStatus('cancelled')}
                disabled={actionLoading || selectedRow.status === 'cancelled'}
              >
                Cancel Batch
              </Button>
              <Button
                id="accounting-export-refresh-detail"
                variant="ghost"
                onClick={refreshDetail}
                disabled={detailLoading}
              >
                Refresh Detail
              </Button>
            </div>

            {detailLoading ? (
              <div className="text-sm text-gray-500">Loading batch detail…</div>
            ) : detailError ? (
              <div className="text-sm text-red-600">{detailError}</div>
            ) : batchDetail?.batch ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border rounded-md p-4 bg-gray-50">
                  <div>
                    <div className="text-xs uppercase text-gray-500 mb-1">Target Realm</div>
                    <div className="text-sm text-gray-900">{batchDetail.batch.target_realm || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-gray-500 mb-1">Created By</div>
                    <div className="text-sm text-gray-900">{batchDetail.batch.created_by || 'System'}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-gray-500 mb-1">Notes</div>
                    <div className="text-sm text-gray-900">{batchDetail.batch.notes || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-gray-500 mb-1">Total Amount</div>
                    <div className="text-sm text-gray-900">
                      {batchDetail.lines.length > 0 ? amountFromCents(totalAmount, currencyFromLines) : '—'}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-gray-900 mb-2">Lines</h3>
                  <div className="border rounded-md overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">External Ref</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Service Period</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filteredLines.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-4 text-sm text-gray-500 text-center">
                              No lines captured for this batch yet.
                            </td>
                          </tr>
                        ) : (
                          filteredLines.map((line) => (
                            <tr key={line.line_id}>
                              <td className="px-3 py-2 text-sm text-gray-900 whitespace-nowrap">{line.invoice_id}</td>
                              <td className="px-3 py-2 text-sm text-gray-900">
                                {amountFromCents(line.amount_cents, line.currency_code)}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-900">{line.status}</td>
                              <td className="px-3 py-2 text-sm text-gray-900">{line.external_document_ref || '—'}</td>
                              <td className="px-3 py-2 text-sm text-gray-900">
                                {line.service_period_start || line.service_period_end
                                  ? `${line.service_period_start ?? '—'} → ${line.service_period_end ?? '—'}`
                                  : '—'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-gray-900 mb-2">Errors</h3>
                  <div className="border rounded-md overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Line</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Message</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">State</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {batchDetail.errors.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-3 py-4 text-sm text-gray-500 text-center">
                              No errors recorded.
                            </td>
                          </tr>
                        ) : (
                          batchDetail.errors.map((error) => (
                            <tr key={error.error_id}>
                              <td className="px-3 py-2 text-sm text-gray-900">{error.line_id || '—'}</td>
                              <td className="px-3 py-2 text-sm text-gray-900">{error.code}</td>
                              <td className="px-3 py-2 text-sm text-gray-900">
                                <span className="block max-w-lg whitespace-normal">{error.message}</span>
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-900">{error.resolution_state}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-gray-500">No detail available for this batch.</div>
            )}
          </div>
        )}
      </Drawer>

      <Dialog
        id="accounting-export-create-dialog"
        isOpen={createDialogOpen}
        onClose={() => resetCreateDialog()}
        title="Create Accounting Export"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Adapter</label>
              <select
                value={createForm.adapterType}
                onChange={(e) => updateCreateFormField('adapterType', e.target.value)}
                className="border rounded-md w-full px-3 py-2 text-sm"
              >
                <option value="quickbooks_online">QuickBooks Online</option>
                <option value="quickbooks_desktop">QuickBooks Desktop</option>
                <option value="xero">Xero</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target Realm / Connection</label>
              <input
                type="text"
                value={createForm.targetRealm}
                onChange={(e) => updateCreateFormField('targetRealm', e.target.value)}
                className="border rounded-md w-full px-3 py-2 text-sm"
                placeholder="Optional target identifier"
              />
              {createForm.adapterType === 'xero' ? (
                <p className="mt-1 text-xs text-gray-500">
                  {xeroStatusLoading
                    ? 'Loading Xero connections…'
                    : xeroStatusError
                      ? xeroStatusError
                      : xeroStatus?.connections?.length
                        ? `Using Xero connection ${createForm.targetRealm || xeroStatus.defaultConnectionId || xeroStatus.connections[0]?.connectionId}.`
                        : 'No Xero connections detected. Connect in Xero integration settings first.'}
                </p>
              ) : null}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                value={createForm.startDate}
                onChange={(e) => updateCreateFormField('startDate', e.target.value)}
                className="border rounded-md w-full px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input
                type="date"
                value={createForm.endDate}
                onChange={(e) => updateCreateFormField('endDate', e.target.value)}
                className="border rounded-md w-full px-3 py-2 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Statuses</label>
              <div className="border rounded-md divide-y divide-gray-200">
                {INVOICE_STATUS_OPTIONS.map((option) => {
                  const checked = createForm.invoiceStatuses.includes(option.value);
                  const description = option.recommended
                    ? `${option.description} (recommended)`
                    : option.description;
                  return (
                    <Checkbox
                      key={option.value}
                      id={`invoice-status-${option.value}`}
                      checked={checked}
                      onChange={(e) => handleInvoiceStatusChange(option.value, e.target.checked)}
                      containerClassName="flex items-start gap-3 px-3 py-3 mb-0"
                      className="mt-1"
                      label={
                        <div>
                          <span className="text-sm font-medium text-gray-900">{option.label}</span>
                          <p className="text-xs text-gray-500">{description}</p>
                        </div>
                      }
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button
                  id="invoice-statuses-recommended"
                  variant="soft"
                  size="xs"
                  onClick={() => applyInvoiceStatuses([...DEFAULT_ACCOUNTING_EXPORT_STATUSES])}
                >
                  Use recommended set
                </Button>
                <Button
                  id="invoice-statuses-select-all"
                  variant="ghost"
                  size="xs"
                  onClick={() => applyInvoiceStatuses(INVOICE_STATUS_OPTIONS.map((option) => option.value))}
                >
                  Select all
                </Button>
                <Button
                  id="invoice-statuses-clear"
                  variant="ghost"
                  size="xs"
                  onClick={() => applyInvoiceStatuses([])}
                >
                  Clear
                </Button>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Choose which invoice statuses to include in this export. Recommended statuses cover finalized invoices
                (sent, paid, partially applied, overdue, prepayment). Only include drafts, pending, or cancelled invoices if
                you intentionally need them.
              </p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={createForm.notes}
                onChange={(e) => updateCreateFormField('notes', e.target.value)}
                className="border rounded-md w-full px-3 py-2 text-sm"
                rows={3}
                placeholder="Optional notes for finance team"
              />
            </div>
          </div>
          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-900">Preview</h3>
              <Button
                id="accounting-export-preview"
                variant="outline"
                onClick={handlePreview}
                disabled={previewLoading}
              >
                {previewLoading ? 'Loading preview…' : previewData ? 'Refresh Preview' : 'Preview Selection'}
              </Button>
            </div>
            {previewError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded mb-2">
                {previewError}
              </div>
            )}
            {previewLoading && (
              <div className="text-sm text-gray-500">Generating preview…</div>
            )}
            {!previewLoading && previewData === null && !previewError && (
              <div className="text-xs text-gray-500">
                Set your filter criteria and click “Preview Selection” to see which invoices will be included in the export.
              </div>
            )}
            {!previewLoading && previewData && (
              <>
                {previewData.lineCount === 0 ? (
                  <div className="text-sm text-gray-600">
                    No invoices match the current filters. Adjust the filters above and preview again.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-4 text-sm text-gray-700">
                      <div>
                        <span className="font-medium text-gray-900">Invoices:</span> {previewData.invoiceCount}
                      </div>
                      <div>
                        <span className="font-medium text-gray-900">Charges:</span> {previewData.lineCount}
                      </div>
                      <div>
                        <span className="font-medium text-gray-900">Total Amount:</span> {formatTotalsSummary(previewData.totalsByCurrency)}
                      </div>
                    </div>
                    <div className="border rounded-md overflow-hidden">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Service Period</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {previewData.lines.map((line) => (
                            <tr key={`${line.invoiceId}-${line.chargeId}`}>
                              <td className="px-3 py-2 text-sm text-gray-900">
                                {line.invoiceNumber || line.invoiceId}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-900">{localDateString(line.invoiceDate)}</td>
                              <td className="px-3 py-2 text-sm text-gray-900">{line.clientName || '—'}</td>
                              <td className="px-3 py-2 text-sm text-gray-900">{line.invoiceStatus}</td>
                              <td className="px-3 py-2 text-sm text-gray-900">
                                {amountFromCents(line.amountCents, line.currencyCode)}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-900">
                                {formatServicePeriod(line.servicePeriodStart, line.servicePeriodEnd)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {previewData.truncated && (
                      <div className="text-xs text-gray-500">
                        Showing the first {previewData.lines.length} of {previewData.lineCount} charges. Narrow the filters to preview a smaller selection.
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          {createError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded">
              {createError}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              id="accounting-export-create-cancel"
              variant="ghost"
              onClick={() => resetCreateDialog()}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button id="accounting-export-create-submit" onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating…' : 'Create Export'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

export default AccountingExportsTab;
