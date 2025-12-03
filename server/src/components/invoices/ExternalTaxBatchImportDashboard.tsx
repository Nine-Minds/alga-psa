'use client';

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Cloud, Download, Clock, CheckCircle, XCircle, AlertTriangle, RefreshCw, FileText, Info } from 'lucide-react';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';

import {
  getPendingExternalTaxCount,
  getInvoicesPendingExternalTax,
  batchImportExternalTaxes,
  importExternalTaxForInvoice
} from 'server/src/lib/actions/externalTaxImportActions';

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

const ADAPTER_NAMES: Record<string, string> = {
  quickbooks_online: 'QuickBooks Online',
  xero: 'Xero',
  sage: 'Sage',
};

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function ExternalTaxBatchImportDashboard() {
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
      console.error('Failed to load pending invoices:', error);
      toast.error('Failed to load pending invoices');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleBatchImport = async () => {
    if (pendingCount === 0) {
      toast.success('No invoices pending tax import');
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
        toast.success(`Successfully imported tax for ${result.successCount} invoices`);
      } else if (result.successCount > 0) {
        toast.success(`Imported ${result.successCount} invoices, ${result.failureCount} failed`);
      } else {
        toast.error(`Failed to import tax for ${result.failureCount} invoices`);
      }

      // Reload data
      await loadData();
    } catch (error: any) {
      console.error('Batch import failed:', error);
      toast.error(error.message ?? 'Batch import failed');
      setProgress(prev => ({ ...prev, isRunning: false }));
    }
  };

  const handleSingleImport = async (invoiceId: string) => {
    try {
      const result = await importExternalTaxForInvoice(invoiceId);

      if (result.success) {
        toast.success('Tax imported successfully');
        await loadData();
      } else {
        toast.error(result.error ?? 'Failed to import tax');
      }
    } catch (error: any) {
      console.error('Import failed:', error);
      toast.error(error.message ?? 'Import failed');
    }
  };

  const columns: ColumnDefinition<PendingInvoice>[] = [
    {
      title: 'Invoice',
      dataIndex: 'invoice_number',
      render: (value, record) => (
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{value}</span>
        </div>
      )
    },
    {
      title: 'Client',
      dataIndex: 'client_name'
    },
    {
      title: 'Amount',
      dataIndex: 'total_amount',
      render: (value) => formatCurrency(value)
    },
    {
      title: 'System',
      dataIndex: 'adapter_type',
      render: (value) => (
        <div className="flex items-center gap-1">
          <Cloud className="h-3 w-3 text-blue-600" />
          <span className="text-sm">{value ? ADAPTER_NAMES[value] ?? value : 'Unknown'}</span>
        </div>
      )
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      render: (value) => formatDate(value)
    },
    {
      title: 'Actions',
      dataIndex: 'invoice_id',
      render: (value, record) => (
        <Button
          id={`import-tax-${record.invoice_id}`}
          variant="outline"
          size="sm"
          onClick={() => handleSingleImport(record.invoice_id)}
        >
          <Download className="h-3 w-3 mr-1" />
          Import
        </Button>
      )
    }
  ];

  return (
    <Card id="external-tax-batch-import-dashboard">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="h-5 w-5 text-blue-600" />
          External Tax Import
        </CardTitle>
        <CardDescription>
          Import tax amounts from your accounting system for exported invoices.
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
                {pendingCount === 1 ? 'invoice' : 'invoices'} pending tax import
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
              Refresh
            </Button>
            <Button
              id="batch-import-all-button"
              onClick={handleBatchImport}
              disabled={pendingCount === 0 || progress.isRunning}
            >
              {progress.isRunning ? (
                <>
                  <Download className="h-4 w-4 mr-2 animate-spin" />
                  Importing {progress.processed}/{progress.total}...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Import All
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Progress Indicator */}
        {progress.isRunning && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Importing taxes...</span>
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
                  {progress.success} successful
                </span>
                {progress.failed > 0 && (
                  <span className="flex items-center gap-1">
                    <XCircle className="h-4 w-4 text-red-600" />
                    {progress.failed} failed
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
            <p>All invoices are up to date!</p>
            <p className="text-sm">No invoices pending external tax import.</p>
          </div>
        ) : null}

        {/* Help Text */}
        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-4 border-t pt-4">
          <Info className="h-3 w-3" />
          <span>
            Invoices appear here when they are exported with external tax delegation enabled.
            Import the tax once your accounting system has calculated the tax amounts.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default ExternalTaxBatchImportDashboard;
