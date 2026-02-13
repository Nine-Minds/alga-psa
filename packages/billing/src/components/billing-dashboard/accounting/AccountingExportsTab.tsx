'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import toast from 'react-hot-toast';
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

export default function AccountingExportsTab(): React.JSX.Element {
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
      const data = (await listAccountingExportBatches()) as unknown as AccountingExportBatch[];
      setBatches(Array.isArray(data) ? data : []);
    } catch (e) {
      setBatches([]);
      toast.error(e instanceof Error ? e.message : 'Failed to load accounting export batches');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBatchDetail = useCallback(async (batchId: string) => {
    setDetailLoading(true);
    try {
      const detail = (await getAccountingExportBatch(batchId)) as unknown as BatchDetail;
      setSelectedDetail(detail);
    } catch (e) {
      setSelectedDetail(null);
      toast.error(e instanceof Error ? e.message : 'Failed to load batch details');
    } finally {
      setDetailLoading(false);
    }
  }, []);

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

      const batch = (await createAccountingExportBatch({
        adapter_type: adapterType,
        export_type: 'invoice',
        filters,
        notes: notes.trim() || null
      })) as unknown as AccountingExportBatch;
      toast.success('Accounting export batch created');
      setCreateOpen(false);
      setSelectedBatchId(batch.batch_id);
      await loadBatches();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create export batch');
    } finally {
      setCreating(false);
    }
  };

  const onExecute = async (batchId: string) => {
    try {
      await executeAccountingExportBatch(batchId);
      toast.success('Batch execution started');
      await loadBatches();
      await loadBatchDetail(batchId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to execute batch');
    }
  };

  return (
    <div className="space-y-6" id="billing-accounting-exports">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Accounting Exports</CardTitle>
            <CardDescription>
              Create export batches, validate mappings, and deliver files for manual import into your accounting system.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              id="accounting-exports-refresh"
              variant="outline"
              onClick={() => void loadBatches()}
              disabled={loading}
            >
              Refresh
            </Button>
            <Button onClick={() => setCreateOpen(true)} id="accounting-exports-new-batch">
              New Export
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading batches...</div>
          ) : batches.length === 0 ? (
            <div className="text-sm text-muted-foreground">No export batches yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Adapter</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((batch) => (
                  <TableRow key={batch.batch_id}>
                    <TableCell className="font-mono text-xs">{batch.batch_id}</TableCell>
                    <TableCell>{batch.adapter_type}</TableCell>
                    <TableCell>{batch.status}</TableCell>
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
                          Open
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => void onExecute(batch.batch_id)}
                          id={`accounting-exports-execute-${batch.batch_id}`}
                        >
                          Execute
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
        title="New Accounting Export"
        id="accounting-exports-create"
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Accounting Export</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="accounting-export-adapter">Adapter</Label>
              <select
                id="accounting-export-adapter"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={adapterType}
                onChange={(e) => setAdapterType(e.target.value as any)}
              >
                {DEFAULT_ADAPTERS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="accounting-export-start-date">Start Date</Label>
                <Input
                  id="accounting-export-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="accounting-export-end-date">End Date</Label>
                <Input
                  id="accounting-export-end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="accounting-export-client-search">Client Search</Label>
              <Input
                id="accounting-export-client-search"
                placeholder="Optional client name filter"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="accounting-export-statuses">Invoice Statuses</Label>
              <Input
                id="accounting-export-statuses"
                placeholder="Comma-separated (optional), e.g. finalized,posted"
                value={invoiceStatuses}
                onChange={(e) => setInvoiceStatuses(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="accounting-export-notes">Notes</Label>
              <Input
                id="accounting-export-notes"
                placeholder="Optional notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button
              id="accounting-export-create-cancel"
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button onClick={() => void onCreate()} disabled={creating} id="accounting-export-create-submit">
              {creating ? 'Creating...' : 'Create Batch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        isOpen={Boolean(selectedBatchId)}
        onClose={() => {
          setSelectedBatchId(null);
          setSelectedDetail(null);
        }}
        title="Accounting Export Batch"
        id="accounting-exports-detail"
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Batch Details</DialogTitle>
          </DialogHeader>

          {detailLoading ? (
            <div className="text-sm text-muted-foreground">Loading batch details...</div>
          ) : !selectedBatch ? (
            <div className="text-sm text-muted-foreground">Batch not found.</div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-xs text-muted-foreground">Batch ID</div>
                  <div className="font-mono text-xs">{selectedBatch.batch_id}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Adapter</div>
                  <div className="text-sm">{selectedBatch.adapter_type}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Status</div>
                  <div className="text-sm">{selectedBatch.status}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Created</div>
                  <div className="text-sm">{formatIso(selectedBatch.created_at)}</div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <div className="text-xs text-muted-foreground">Lines</div>
                  <div className="text-sm">{selectedDetail?.lines?.length ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Errors</div>
                  <div className="text-sm">{selectedDetail?.errors?.length ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Delivered</div>
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
                  Refresh
                </Button>
                <Button
                  id="accounting-exports-detail-execute"
                  onClick={() => void onExecute(selectedBatch.batch_id)}
                >
                  Execute
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
