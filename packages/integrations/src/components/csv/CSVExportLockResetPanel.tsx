'use client';

import React, { useCallback, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import ViewSwitcher from '@alga-psa/ui/components/ViewSwitcher';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export function CSVExportLockResetPanel() {
  const { t } = useTranslation('msp/integrations');
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
          t('integrations.csv.export.lockReset.errors.unable', { defaultValue: 'Unable to reset export lock' });
        setResult({ kind: 'error', message });
        return;
      }

      const cleared = typeof data?.cleared === 'number' ? data.cleared : 0;
      if (cleared === 0) {
        setResult({
          kind: 'success',
          message: mode === 'batch'
            ? t('integrations.csv.export.lockReset.success.noBatchLocks', { defaultValue: 'No export locks were found for that batch.' })
            : t('integrations.csv.export.lockReset.success.noInvoiceLock', { defaultValue: 'No export lock found for that invoice.' })
        });
      } else {
        setResult({
          kind: 'success',
          message: mode === 'batch'
            ? t('integrations.csv.export.lockReset.success.batchCleared', { defaultValue: 'Export locks cleared for this batch. You can export those invoices again.' })
            : t('integrations.csv.export.lockReset.success.invoiceCleared', { defaultValue: 'Export lock cleared. You can export this invoice again.' })
        });
      }
    } catch (error: any) {
      setResult({ kind: 'error', message: error?.message ?? t('integrations.csv.export.lockReset.errors.unable', { defaultValue: 'Unable to reset export lock' }) });
    } finally {
      setIsLoading(false);
      setConfirmOpen(false);
    }
  }, [invoiceNumber, batchId, mode, t]);

  const canSubmit =
    !isLoading &&
    (mode === 'invoice' ? invoiceNumber.trim().length > 0 : batchId.trim().length > 0);

  return (
    <Card id="qbcsv-export-lock-reset-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RotateCcw className="h-5 w-5" />
          {t('integrations.csv.export.lockReset.title', { defaultValue: 'Re-export an invoice' })}
        </CardTitle>
        <CardDescription>
          {t('integrations.csv.export.lockReset.description', { defaultValue: 'Clear export locks to allow re-exporting invoices via CSV.' })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ViewSwitcher
          currentView={mode}
          onChange={(value) => {
            if (value === 'invoice' || value === 'batch') {
              setMode(value);
            }
          }}
          options={[
            { value: 'invoice' as const, label: t('integrations.csv.export.lockReset.modes.invoice', { defaultValue: 'Invoice' }), id: 'qbcsv-reset-export-lock-mode-invoice', disabled: isLoading },
            { value: 'batch' as const, label: t('integrations.csv.export.lockReset.modes.batch', { defaultValue: 'Batch' }), id: 'qbcsv-reset-export-lock-mode-batch', disabled: isLoading },
          ]}
          aria-label={t('integrations.csv.export.lockReset.modes.ariaLabel', { defaultValue: 'Reset export lock mode' })}
        />

        {mode === 'invoice' ? (
          <Input
            id="qbcsv-reset-export-lock-invoice-number"
            label={t('integrations.csv.export.lockReset.fields.invoiceNumber', { defaultValue: 'Invoice number' })}
            placeholder={t('integrations.csv.export.lockReset.fields.invoiceNumberPlaceholder', { defaultValue: 'e.g. INV-1001' })}
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
          />
        ) : (
          <Input
            id="qbcsv-reset-export-lock-batch-id"
            label={t('integrations.csv.export.lockReset.fields.batchId', { defaultValue: 'Export batch ID' })}
            placeholder={t('integrations.csv.export.lockReset.fields.batchIdPlaceholder', { defaultValue: 'e.g. e793a514-34bd-4d7b-b266-9bb15f7087c4' })}
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
          />
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {t('integrations.csv.export.lockReset.warnings.duplicates', { defaultValue: 'This may cause duplicates in QuickBooks if the invoice still exists there.' })}
          </div>
          <Button
            id="qbcsv-reset-export-lock-button"
            variant="outline"
            disabled={!canSubmit}
            onClick={() => setConfirmOpen(true)}
          >
            {t('integrations.csv.export.lockReset.actions.reset', { defaultValue: 'Reset export lock' })}
          </Button>
        </div>

        {result && (
          <Alert variant={result.kind === 'success' ? 'success' : 'destructive'}>
            <AlertDescription>{result.message}</AlertDescription>
          </Alert>
        )}

        <Dialog
          id="qbcsv-reset-export-lock-confirm-dialog"
          isOpen={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title={t('integrations.csv.export.lockReset.dialog.title', { defaultValue: 'Reset export lock?' })}
        >
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              {mode === 'batch'
                ? t('integrations.csv.export.lockReset.dialog.confirmBatch', { defaultValue: 'This will allow Alga PSA to export invoices from batch {{batchId}} again. If any of these invoices still exist in QuickBooks, importing the CSV may create duplicates.', batchId: batchId.trim() })
                : t('integrations.csv.export.lockReset.dialog.confirmInvoice', { defaultValue: 'This will allow Alga PSA to export invoice {{invoiceNumber}} again. If this invoice still exists in QuickBooks, importing the CSV may create duplicates.', invoiceNumber: invoiceNumber.trim() })}
            </p>
            <Alert variant="warning">
              <AlertDescription>
                {t('integrations.csv.export.lockReset.dialog.warning', { defaultValue: 'Only proceed if you are sure the invoice was not imported, or you deleted/voided it in QuickBooks.' })}
              </AlertDescription>
            </Alert>
            <div className="flex justify-end gap-2">
              <Button
                id="qbcsv-reset-export-lock-cancel"
                variant="outline"
                onClick={() => setConfirmOpen(false)}
                disabled={isLoading}
              >
                {t('integrations.csv.export.lockReset.dialog.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button
                id="qbcsv-reset-export-lock-confirm"
                onClick={resetLock}
                disabled={!canSubmit}
              >
                {isLoading
                  ? t('integrations.csv.export.lockReset.dialog.resetting', { defaultValue: 'Resetting…' })
                  : t('integrations.csv.export.lockReset.dialog.confirm', { defaultValue: 'Reset lock' })}
              </Button>
            </div>
          </div>
        </Dialog>
      </CardContent>
    </Card>
  );
}
