'use client';

import React, { useCallback, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { ToggleGroup, ToggleGroupItem } from '@alga-psa/ui/components/ToggleGroup';
import { AlertCircle, RotateCcw } from 'lucide-react';

export function CSVExportLockResetPanel() {
  const [mode, setMode] = useState<'invoice' | 'batch'>('invoice');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [batchId, setBatchId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const resetLock = useCallback(async () => {
    setIsLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/accounting/exports/locks/invoice/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adapterType: 'quickbooks_csv',
          invoiceNumber: mode === 'invoice' ? invoiceNumber.trim() : undefined,
          batchId: mode === 'batch' ? batchId.trim() : undefined
        })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          (data && typeof data.message === 'string' && data.message) ||
          'Unable to reset export lock';
        setResult({ kind: 'error', message });
        return;
      }

      const cleared = typeof data?.cleared === 'number' ? data.cleared : 0;
      if (cleared === 0) {
        setResult({
          kind: 'success',
          message: mode === 'batch'
            ? 'No export locks were found for that batch.'
            : 'No export lock found for that invoice.'
        });
      } else {
        setResult({
          kind: 'success',
          message: mode === 'batch'
            ? 'Export locks cleared for this batch. You can export those invoices again.'
            : 'Export lock cleared. You can export this invoice again.'
        });
      }
    } catch (error: any) {
      setResult({ kind: 'error', message: error?.message ?? 'Unable to reset export lock' });
    } finally {
      setIsLoading(false);
      setConfirmOpen(false);
    }
  }, [invoiceNumber, batchId, mode]);

  const canSubmit =
    !isLoading &&
    (mode === 'invoice' ? invoiceNumber.trim().length > 0 : batchId.trim().length > 0);

  return (
    <Card id="qbcsv-export-lock-reset-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RotateCcw className="h-5 w-5" />
          Re-export an invoice
        </CardTitle>
        <CardDescription>
          Clear export locks to allow re-exporting invoices via CSV.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => {
            if (value === 'invoice' || value === 'batch') {
              setMode(value);
            }
          }}
          aria-label="Reset export lock mode"
        >
          <ToggleGroupItem
            id="qbcsv-reset-export-lock-mode-invoice"
            value="invoice"
            disabled={isLoading}
          >
            Invoice
          </ToggleGroupItem>
          <ToggleGroupItem
            id="qbcsv-reset-export-lock-mode-batch"
            value="batch"
            disabled={isLoading}
          >
            Batch
          </ToggleGroupItem>
        </ToggleGroup>

        {mode === 'invoice' ? (
          <Input
            id="qbcsv-reset-export-lock-invoice-number"
            label="Invoice number"
            placeholder="e.g. INV-1001"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
          />
        ) : (
          <Input
            id="qbcsv-reset-export-lock-batch-id"
            label="Export batch ID"
            placeholder="e.g. e793a514-34bd-4d7b-b266-9bb15f7087c4"
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
          />
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            This may cause duplicates in QuickBooks if the invoice still exists there.
          </div>
          <Button
            id="qbcsv-reset-export-lock-button"
            variant="outline"
            disabled={!canSubmit}
            onClick={() => setConfirmOpen(true)}
          >
            Reset export lock
          </Button>
        </div>

        {result && (
          <div
            className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
              result.kind === 'success'
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-700'
            }`}
          >
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span>{result.message}</span>
          </div>
        )}

        <Dialog
          id="qbcsv-reset-export-lock-confirm-dialog"
          isOpen={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title="Reset export lock?"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              {mode === 'batch' ? (
                <>
                  This will allow Alga PSA to export invoices from batch <strong>{batchId.trim()}</strong> again.
                  If any of these invoices still exist in QuickBooks, importing the CSV may create duplicates.
                </>
              ) : (
                <>
                  This will allow Alga PSA to export invoice <strong>{invoiceNumber.trim()}</strong> again.
                  If this invoice still exists in QuickBooks, importing the CSV may create duplicates.
                </>
              )}
            </p>
            <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
              Only proceed if you are sure the invoice was not imported, or you deleted/voided it in QuickBooks.
            </div>
            <div className="flex justify-end gap-2">
              <Button
                id="qbcsv-reset-export-lock-cancel"
                variant="outline"
                onClick={() => setConfirmOpen(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                id="qbcsv-reset-export-lock-confirm"
                onClick={resetLock}
                disabled={!canSubmit}
              >
                {isLoading ? 'Resetting…' : 'Reset lock'}
              </Button>
            </div>
          </div>
        </Dialog>
      </CardContent>
    </Card>
  );
}
