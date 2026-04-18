'use client';

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Cloud, Download, Clock, CheckCircle, XCircle, AlertTriangle, RefreshCw, FileText, Info } from 'lucide-react';
import { ColumnDefinition } from '@alga-psa/types';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '@alga-psa/ui/lib/i18n/client';

import {
  getPendingExternalTaxCount,
  getInvoicesPendingExternalTax,
  batchImportExternalTaxes,
  importExternalTaxForInvoice
} from '@alga-psa/billing/actions';

interface PendingInvoice {
  invoice_id: string;
  invoice_number: string;
  client_name: string;
  total_amount: number;
  created_at: string;
  adapter_type?: string;
}

interface BatchImportProgress {
  total: number;
  processed: number;
  success: number;
  failed: number;
  isRunning: boolean;
}

const ADAPTER_NAME_KEYS: Record<string, 'quickbooks' | 'xero' | 'sage'> = {
  quickbooks_online: 'quickbooks',
  xero: 'xero',
  sage: 'sage',
};

export function ExternalTaxBatchImportDashboard() {
  const { t } = useTranslation('msp/invoicing');
  const { formatCurrency, formatDate } = useFormatters();
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingInvoices, setPendingInvoices] = useState<PendingInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [progress, setProgress] = useState<BatchImportProgress>({
    total: 0,
    processed: 0,
    success: 0,
    failed: 0,
    isRunning: false
  });

  const getAdapterName = useCallback((adapterType?: string) => {
    if (!adapterType) {
      return t('externalTax.values.unknownSystem', { defaultValue: 'Unknown' });
    }

    const adapterKey = ADAPTER_NAME_KEYS[adapterType];
    if (adapterKey) {
      return t(`externalTax.adapterNames.${adapterKey}`, {
        defaultValue:
          adapterKey === 'quickbooks'
            ? 'QuickBooks Online'
            : adapterKey === 'xero'
              ? 'Xero'
              : 'Sage',
      });
    }

    return adapterType;
  }, [t]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [count, invoices] = await Promise.all([
        getPendingExternalTaxCount(),
        getInvoicesPendingExternalTax()
      ]);
      setPendingCount(count);
      setPendingInvoices(invoices);
    } catch (error) {
      handleError(error, t('externalTax.errors.loadPendingInvoices', { defaultValue: 'Failed to load pending invoices' }));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleBatchImport = async () => {
    if (pendingCount === 0) {
      toast.success(t('externalTax.toasts.noPendingInvoices', { defaultValue: 'No invoices pending tax import' }));
      return;
    }

    setProgress({
      total: pendingCount,
      processed: 0,
      success: 0,
      failed: 0,
      isRunning: true
    });

    try {
      const result = await batchImportExternalTaxes();

      setProgress({
        total: result.totalProcessed,
        processed: result.totalProcessed,
        success: result.successCount,
        failed: result.failureCount,
        isRunning: false
      });

      if (result.failureCount === 0) {
        toast.success(t('externalTax.toasts.batchImportedSuccess', {
          count: result.successCount,
          defaultValue:
            result.successCount === 1
              ? `Successfully imported tax for ${result.successCount} invoice`
              : `Successfully imported tax for ${result.successCount} invoices`,
        }));
      } else if (result.successCount > 0) {
        toast.success(t('externalTax.toasts.batchImportedPartial', {
          successCount: result.successCount,
          failureCount: result.failureCount,
          defaultValue: `Imported ${result.successCount} invoices, ${result.failureCount} failed`,
        }));
      } else {
        toast.error(t('externalTax.toasts.batchImportedFailed', {
          count: result.failureCount,
          defaultValue:
            result.failureCount === 1
              ? `Failed to import tax for ${result.failureCount} invoice`
              : `Failed to import tax for ${result.failureCount} invoices`,
        }));
      }

      // Reload data
      await loadData();
    } catch (error: any) {
      handleError(error, t('externalTax.errors.batchImportFailed', { defaultValue: 'Batch import failed' }));
      setProgress(prev => ({ ...prev, isRunning: false }));
    }
  };

  const handleSingleImport = async (invoiceId: string) => {
    try {
      const result = await importExternalTaxForInvoice(invoiceId);

      if (result.success) {
        toast.success(t('externalTax.toasts.taxImportedSuccessfully', { defaultValue: 'Tax imported successfully' }));
        await loadData();
      } else {
        toast.error(result.error ?? t('externalTax.toasts.taxImportFailed', { defaultValue: 'Failed to import tax' }));
      }
    } catch (error: any) {
      handleError(error, t('externalTax.errors.importFailed', { defaultValue: 'Import failed' }));
    }
  };

  const columns: ColumnDefinition<PendingInvoice>[] = [
    {
      title: t('externalTax.columns.invoice', { defaultValue: 'Invoice' }),
      dataIndex: 'invoice_number',
      render: (value, record) => (
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{value}</span>
        </div>
      )
    },
    {
      title: t('externalTax.columns.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name'
    },
    {
      title: t('externalTax.columns.amount', { defaultValue: 'Amount' }),
      dataIndex: 'total_amount',
      render: (value) => formatCurrency(Number(value) / 100, 'USD')
    },
    {
      title: t('externalTax.columns.system', { defaultValue: 'System' }),
      dataIndex: 'adapter_type',
      render: (value) => (
        <div className="flex items-center gap-1">
          <Cloud className="h-3 w-3 text-blue-600" />
          <span className="text-sm">{getAdapterName(value)}</span>
        </div>
      )
    },
    {
      title: t('externalTax.columns.created', { defaultValue: 'Created' }),
      dataIndex: 'created_at',
      render: (value) => formatDate(value, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    },
    {
      title: t('externalTax.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'invoice_id',
      render: (value, record) => (
        <Button
          id={`import-tax-${record.invoice_id}`}
          variant="outline"
          size="sm"
          onClick={() => handleSingleImport(record.invoice_id)}
        >
          <Download className="h-3 w-3 mr-1" />
          {t('externalTax.actions.import', { defaultValue: 'Import' })}
        </Button>
      )
    }
  ];

  return (
    <Card id="external-tax-batch-import-dashboard">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="h-5 w-5 text-blue-600" />
          {t('externalTax.title', { defaultValue: 'External Tax Import' })}
        </CardTitle>
        <CardDescription>
          {t('externalTax.description', {
            defaultValue: 'Review invoices waiting for external tax calculation and import the resulting amounts.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Card */}
        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-full">
              <Clock className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{pendingCount}</p>
              <p className="text-sm text-muted-foreground">
                {t('externalTax.summary.pending', {
                  count: pendingCount,
                  defaultValue:
                    pendingCount === 1
                      ? `${pendingCount} invoice pending tax import`
                      : `${pendingCount} invoices pending tax import`,
                })}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              id="refresh-pending-invoices-button"
              variant="outline"
              onClick={loadData}
              disabled={isLoading || progress.isRunning}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
              {t('externalTax.actions.refresh', { defaultValue: 'Refresh' })}
            </Button>
            <Button
              id="batch-import-all-button"
              onClick={handleBatchImport}
              disabled={pendingCount === 0 || progress.isRunning}
            >
              {progress.isRunning ? (
                <>
                  <Download className="h-4 w-4 mr-2 animate-spin" />
                  {t('externalTax.progress.importingCount', {
                    current: progress.processed,
                    total: progress.total,
                    defaultValue: `Importing ${progress.processed}/${progress.total}...`,
                  })}
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  {t('externalTax.actions.importAll', { defaultValue: 'Import All' })}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Progress Indicator */}
        {progress.isRunning && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{t('externalTax.progress.importing', { defaultValue: 'Importing taxes...' })}</span>
              <span>{progress.processed}/{progress.total}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(progress.processed / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Results Summary */}
        {!progress.isRunning && progress.total > 0 && (
          <Alert variant={progress.failed === 0 ? 'default' : 'destructive'} showIcon={false}>
            {progress.failed === 0 ? (
              <CheckCircle className="h-4 w-4 text-green-600" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
            <AlertDescription>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  {t('externalTax.summary.successful', {
                    count: progress.success,
                    defaultValue: `${progress.success} successful`,
                  })}
                </span>
                {progress.failed > 0 && (
                  <span className="flex items-center gap-1">
                    <XCircle className="h-4 w-4 text-red-600" />
                    {t('externalTax.summary.failed', {
                      count: progress.failed,
                      defaultValue: `${progress.failed} failed`,
                    })}
                  </span>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Pending Invoices Table */}
        {pendingInvoices.length > 0 ? (
          <DataTable
            columns={columns}
            data={pendingInvoices}
            pagination={true}
          />
        ) : !isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            <CheckCircle className="h-12 w-12 mx-auto mb-2 text-green-600" />
            <p>{t('externalTax.empty.allUpToDate', { defaultValue: 'All invoices are up to date' })}</p>
            <p className="text-sm">{t('externalTax.empty.nonePending', { defaultValue: 'No invoices pending external tax import.' })}</p>
          </div>
        ) : null}

        {/* Help Text */}
        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-4 border-t pt-4">
          <Info className="h-3 w-3" />
          <span>
            {t('externalTax.helpText', {
              defaultValue: 'Invoices appear here when they are exported with external tax delegation enabled. Import the tax once your accounting system has calculated the tax amounts.',
            })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default ExternalTaxBatchImportDashboard;
