'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import toast from 'react-hot-toast';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  createAccountingExportBatch,
  executeAccountingExportBatch,
  getAccountingExportBatch,
  listAccountingExportBatches
} from '@alga-psa/billing/actions';

type AccountingExportStatus =
  | 'pending'
  | 'validating'
  | 'ready'
  | 'delivered'
  | 'posted'
  | 'failed'
  | 'cancelled'
  | 'needs_attention';

type AccountingExportBatch = {
  batch_id: string;
  adapter_type: string;
  status: AccountingExportStatus;
  export_type: string;
  target_realm: string | null;
  queued_at: string;
  validated_at: string | null;
  delivered_at: string | null;
  posted_at: string | null;
  created_by: string | null;
  last_updated_by: string | null;
  created_at: string;
  updated_at: string;
  notes: string | null;
};

type AccountingExportLine = {
  line_id: string;
  batch_id: string;
  invoice_id: string;
  amount_cents: number;
  currency_code: string;
  status: 'pending' | 'ready' | 'delivered' | 'posted' | 'failed';
  created_at: string;
  updated_at: string;
};

type AccountingExportError = {
  error_id: string;
  batch_id: string;
  line_id: string | null;
  code: string;
  message: string;
  resolution_state: 'open' | 'pending_review' | 'resolved' | 'dismissed';
  created_at: string;
  resolved_at: string | null;
};

type BatchDetail = {
  batch: AccountingExportBatch | null;
  lines: AccountingExportLine[];
  errors: AccountingExportError[];
};

function formatIso(iso: string | null | undefined): string {
  if (!iso) return '-';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return String(iso);
  return dt.toLocaleString();
}

const DEFAULT_ADAPTERS = [
  { id: 'quickbooks_csv', label: 'QuickBooks CSV' },
  { id: 'xero_csv', label: 'Xero CSV' },
  { id: 'quickbooks_online', label: 'QuickBooks Online' },
  { id: 'quickbooks_desktop', label: 'QuickBooks Desktop' }
] as const;

function getAccountingExportStatusKey(status: AccountingExportStatus): string {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'validating':
      return 'validating';
    case 'ready':
      return 'ready';
    case 'delivered':
      return 'delivered';
    case 'posted':
      return 'posted';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'needs_attention':
      return 'needsAttention';
    default:
      return 'pending';
  }
}

export default function AccountingExportsTab(): React.JSX.Element {
  const { t } = useTranslation('msp/billing');
  const [loading, setLoading] = useState(true);
  const [batches, setBatches] = useState<AccountingExportBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<BatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [adapterType, setAdapterType] = useState<(typeof DEFAULT_ADAPTERS)[number]['id']>('quickbooks_csv');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [clientSearch, setClientSearch] = useState<string>('');
  const [invoiceStatuses, setInvoiceStatuses] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const loadBatches = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAccountingExportBatches();
      if (isActionPermissionError(data)) {
        handleError(data.permissionError);
        setBatches([]);
        return;
      }
      const typedData = data as unknown as AccountingExportBatch[];
      setBatches(Array.isArray(typedData) ? typedData : []);
    } catch (e) {
      setBatches([]);
      handleError(e, t('accountingExports.toast.loadBatchesError', {
        defaultValue: 'Failed to load accounting export batches',
      }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadBatchDetail = useCallback(async (batchId: string) => {
    setDetailLoading(true);
    try {
      const detail = await getAccountingExportBatch(batchId);
      if (isActionPermissionError(detail)) {
        handleError(detail.permissionError);
        setSelectedDetail(null);
        return;
      }
      setSelectedDetail(detail as unknown as BatchDetail);
    } catch (e) {
      setSelectedDetail(null);
      handleError(e, t('accountingExports.toast.loadDetailError', {
        defaultValue: 'Failed to load batch details',
      }));
    } finally {
      setDetailLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  useEffect(() => {
    if (!selectedBatchId) return;
    void loadBatchDetail(selectedBatchId);
  }, [selectedBatchId, loadBatchDetail]);

  const selectedBatch = useMemo(
    () => (selectedDetail?.batch?.batch_id ? selectedDetail.batch : batches.find((b) => b.batch_id === selectedBatchId) ?? null),
    [selectedBatchId, selectedDetail, batches]
  );
  const getStatusLabel = (status: AccountingExportStatus) =>
    t(`accountingExports.status.${getAccountingExportStatusKey(status)}`, { defaultValue: status });

  const onCreate = async () => {
    setCreating(true);
    try {
      const filters: Record<string, unknown> = {
        excludeSyncedInvoices: true
      };
      if (startDate.trim()) filters.startDate = startDate.trim();
      if (endDate.trim()) filters.endDate = endDate.trim();
      if (clientSearch.trim()) filters.clientSearch = clientSearch.trim();
      if (invoiceStatuses.trim()) {
        filters.invoiceStatuses = invoiceStatuses
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }

      const batchResult = await createAccountingExportBatch({
        adapter_type: adapterType,
        export_type: 'invoice',
        filters,
        notes: notes.trim() || null
      });
      if (isActionPermissionError(batchResult)) {
        handleError(batchResult.permissionError);
        return;
      }
      const batch = batchResult as unknown as AccountingExportBatch;
      toast.success(t('accountingExports.toast.created', {
        defaultValue: 'Accounting export batch created',
      }));
      setCreateOpen(false);
      setSelectedBatchId(batch.batch_id);
      await loadBatches();
    } catch (e) {
      handleError(e, t('accountingExports.toast.createError', {
        defaultValue: 'Failed to create export batch',
      }));
    } finally {
      setCreating(false);
    }
  };

  const onExecute = async (batchId: string) => {
    try {
      const result = await executeAccountingExportBatch(batchId);
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      toast.success(t('accountingExports.toast.executing', {
        defaultValue: 'Batch execution started',
      }));
      await loadBatches();
      await loadBatchDetail(batchId);
    } catch (e) {
      handleError(e, t('accountingExports.toast.executeError', {
        defaultValue: 'Failed to execute batch',
      }));
    }
  };

  return (
    <div className="space-y-6" id="billing-accounting-exports">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>{t('accountingExports.title', { defaultValue: 'Accounting Exports' })}</CardTitle>
            <CardDescription>
              {t('accountingExports.description', {
                defaultValue: 'Create export batches, validate mappings, and deliver files for manual import into your accounting system.',
              })}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              id="accounting-exports-refresh"
              variant="outline"
              onClick={() => void loadBatches()}
              disabled={loading}
            >
              {t('accountingExports.actions.refresh', { defaultValue: 'Refresh' })}
            </Button>
            <Button onClick={() => setCreateOpen(true)} id="accounting-exports-new-batch">
              {t('accountingExports.actions.newExport', { defaultValue: 'New Export' })}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">
              {t('accountingExports.states.loadingBatches', { defaultValue: 'Loading batches...' })}
            </div>
          ) : batches.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {t('accountingExports.states.empty', { defaultValue: 'No export batches yet.' })}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('accountingExports.table.batch', { defaultValue: 'Batch' })}</TableHead>
                  <TableHead>{t('accountingExports.table.adapter', { defaultValue: 'Adapter' })}</TableHead>
                  <TableHead>{t('accountingExports.table.status', { defaultValue: 'Status' })}</TableHead>
                  <TableHead>{t('accountingExports.table.created', { defaultValue: 'Created' })}</TableHead>
                  <TableHead>{t('accountingExports.table.updated', { defaultValue: 'Updated' })}</TableHead>
                  <TableHead className="text-right">
                    {t('accountingExports.table.actions', { defaultValue: 'Actions' })}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((batch) => (
                  <TableRow key={batch.batch_id}>
                    <TableCell className="font-mono text-xs">{batch.batch_id}</TableCell>
                    <TableCell>{batch.adapter_type}</TableCell>
                    <TableCell>{getStatusLabel(batch.status)}</TableCell>
                    <TableCell>{formatIso(batch.created_at)}</TableCell>
                    <TableCell>{formatIso(batch.updated_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedBatchId(batch.batch_id)}
                          id={`accounting-exports-open-${batch.batch_id}`}
                        >
                          {t('accountingExports.actions.open', { defaultValue: 'Open' })}
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => void onExecute(batch.batch_id)}
                          id={`accounting-exports-execute-${batch.batch_id}`}
                        >
                          {t('accountingExports.actions.execute', { defaultValue: 'Execute' })}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        isOpen={createOpen}
        onClose={() => {
          if (creating) return;
          setCreateOpen(false);
        }}
        title={t('accountingExports.createDialog.title', { defaultValue: 'New Accounting Export' })}
        id="accounting-exports-create"
        footer={(
          <div className="flex justify-end space-x-2">
            <Button
              id="accounting-export-create-cancel"
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button onClick={() => void onCreate()} disabled={creating} id="accounting-export-create-submit">
              {creating
                ? t('accountingExports.actions.creating', { defaultValue: 'Creating...' })
                : t('accountingExports.actions.createBatch', { defaultValue: 'Create Batch' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('accountingExports.createDialog.title', { defaultValue: 'New Accounting Export' })}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="accounting-export-adapter">
                {t('accountingExports.createDialog.fields.adapter', { defaultValue: 'Adapter' })}
              </Label>
              <CustomSelect
                id="accounting-export-adapter"
                value={adapterType}
                onValueChange={(value) => setAdapterType(value as (typeof DEFAULT_ADAPTERS)[number]['id'])}
                options={DEFAULT_ADAPTERS.map((opt) => ({
                  value: opt.id,
                  label: opt.label,
                }))}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="accounting-export-start-date">
                  {t('accountingExports.createDialog.fields.startDate', { defaultValue: 'Start Date' })}
                </Label>
                <Input
                  id="accounting-export-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="accounting-export-end-date">
                  {t('accountingExports.createDialog.fields.endDate', { defaultValue: 'End Date' })}
                </Label>
                <Input
                  id="accounting-export-end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="accounting-export-client-search">
                {t('accountingExports.createDialog.fields.clientSearch', { defaultValue: 'Client Search' })}
              </Label>
              <Input
                id="accounting-export-client-search"
                placeholder={t('accountingExports.createDialog.placeholders.clientSearch', {
                  defaultValue: 'Optional client name filter',
                })}
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="accounting-export-statuses">
                {t('accountingExports.createDialog.fields.invoiceStatuses', { defaultValue: 'Invoice Statuses' })}
              </Label>
              <Input
                id="accounting-export-statuses"
                placeholder={t('accountingExports.createDialog.placeholders.invoiceStatuses', {
                  defaultValue: 'Comma-separated (optional), e.g. finalized,posted',
                })}
                value={invoiceStatuses}
                onChange={(e) => setInvoiceStatuses(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="accounting-export-notes">
                {t('accountingExports.createDialog.fields.notes', { defaultValue: 'Notes' })}
              </Label>
              <Input
                id="accounting-export-notes"
                placeholder={t('accountingExports.createDialog.placeholders.notes', {
                  defaultValue: 'Optional notes',
                })}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

        </DialogContent>
      </Dialog>

      <Dialog
        isOpen={Boolean(selectedBatchId)}
        onClose={() => {
          setSelectedBatchId(null);
          setSelectedDetail(null);
        }}
        title={t('accountingExports.detailDialog.title', { defaultValue: 'Accounting Export Batch' })}
        id="accounting-exports-detail"
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('accountingExports.detailDialog.subtitle', { defaultValue: 'Batch Details' })}</DialogTitle>
          </DialogHeader>

          {detailLoading ? (
            <div className="text-sm text-muted-foreground">
              {t('accountingExports.states.loadingDetails', { defaultValue: 'Loading batch details...' })}
            </div>
          ) : !selectedBatch ? (
            <div className="text-sm text-muted-foreground">
              {t('accountingExports.states.batchNotFound', { defaultValue: 'Batch not found.' })}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-xs text-muted-foreground">
                    {t('accountingExports.detailDialog.fields.batchId', { defaultValue: 'Batch ID' })}
                  </div>
                  <div className="font-mono text-xs">{selectedBatch.batch_id}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    {t('accountingExports.detailDialog.fields.adapter', { defaultValue: 'Adapter' })}
                  </div>
                  <div className="text-sm">{selectedBatch.adapter_type}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    {t('accountingExports.detailDialog.fields.status', { defaultValue: 'Status' })}
                  </div>
                  <div className="text-sm">{getStatusLabel(selectedBatch.status)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    {t('accountingExports.detailDialog.fields.created', { defaultValue: 'Created' })}
                  </div>
                  <div className="text-sm">{formatIso(selectedBatch.created_at)}</div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <div className="text-xs text-muted-foreground">
                    {t('accountingExports.detailDialog.fields.lines', { defaultValue: 'Lines' })}
                  </div>
                  <div className="text-sm">{selectedDetail?.lines?.length ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    {t('accountingExports.detailDialog.fields.errors', { defaultValue: 'Errors' })}
                  </div>
                  <div className="text-sm">{selectedDetail?.errors?.length ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    {t('accountingExports.detailDialog.fields.delivered', { defaultValue: 'Delivered' })}
                  </div>
                  <div className="text-sm">{formatIso(selectedBatch.delivered_at)}</div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button
                  id="accounting-exports-detail-refresh"
                  variant="outline"
                  onClick={() => void loadBatchDetail(selectedBatch.batch_id)}
                  disabled={detailLoading}
                >
                  {t('accountingExports.actions.refresh', { defaultValue: 'Refresh' })}
                </Button>
                <Button
                  id="accounting-exports-detail-execute"
                  onClick={() => void onExecute(selectedBatch.batch_id)}
                >
                  {t('accountingExports.actions.execute', { defaultValue: 'Execute' })}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
