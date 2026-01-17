'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  ExternalLink,
  RefreshCw
} from 'lucide-react';
import { formatCurrency } from 'server/src/lib/utils/formatters';
import type { TaxImportPreviewResult, TaxImportResult } from 'server/src/lib/services/xeroCsvTaxImportService';

interface XeroCsvTaxImportPanelProps {
  /** Callback after successful import */
  onImportComplete?: () => void;
}

type ImportStep = 'upload' | 'preview' | 'importing' | 'complete';

/**
 * Panel component for importing tax amounts from Xero Invoice Details Report.
 * Provides file upload, preview of matches, and confirmation before import.
 */
const XeroCsvTaxImportPanel: React.FC<XeroCsvTaxImportPanelProps> = ({ onImportComplete }) => {
  const [step, setStep] = useState<ImportStep>('upload');
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<TaxImportPreviewResult | null>(null);
  const [importResult, setImportResult] = useState<TaxImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      setError('Please select a CSV file');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const content = await file.text();
      setCsvContent(content);
      setFileName(file.name);

      // Get preview
      const response = await fetch('/api/v1/accounting-exports/xero-csv/tax-import?preview=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent: content })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error ?? 'Failed to preview import');
      }

      const data = await response.json();
      setPreview(data.preview);
      setStep('preview');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to process file';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleImport = useCallback(async () => {
    if (!csvContent) return;

    setIsLoading(true);
    setError(null);
    setStep('importing');

    try {
      const response = await fetch('/api/v1/accounting-exports/xero-csv/tax-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error ?? 'Failed to import tax');
      }

      const data = await response.json();
      setImportResult(data.result);
      setStep('complete');
      onImportComplete?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import tax';
      setError(message);
      setStep('preview');
    } finally {
      setIsLoading(false);
    }
  }, [csvContent, onImportComplete]);

  const handleReset = useCallback(() => {
    setStep('upload');
    setCsvContent(null);
    setFileName(null);
    setPreview(null);
    setImportResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && fileInputRef.current) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInputRef.current.files = dataTransfer.files;
      handleFileSelect({ target: { files: dataTransfer.files } } as React.ChangeEvent<HTMLInputElement>);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
  }, []);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'matched':
        return <Badge variant="success">Matched</Badge>;
      case 'unmatched':
        return <Badge variant="error">Unmatched</Badge>;
      case 'already_imported':
        return <Badge variant="secondary">Already Imported</Badge>;
      case 'not_pending':
        return <Badge variant="warning">Not Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const previewColumns = [
    {
      title: 'Xero Invoice #',
      dataIndex: 'xeroInvoiceNumber' as const
    },
    {
      title: 'Alga Invoice',
      dataIndex: 'algaInvoiceNumber' as const,
      render: (value: string | null) => value ?? '-'
    },
    {
      title: 'Contact',
      dataIndex: 'contactName' as const
    },
    {
      title: 'Status',
      dataIndex: 'status' as const,
      render: (value: string) => getStatusBadge(value)
    },
    {
      title: 'Lines',
      dataIndex: 'lineCount' as const
    },
    {
      title: 'Tax Amount',
      dataIndex: 'taxAmount' as const,
      render: (value: number) => formatCurrency(value)
    }
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Upload className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Import Tax from Xero</CardTitle>
        </div>
        <CardDescription>
          Upload a Xero Invoice Details Report to import tax calculations back into Alga.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Upload Step */}
        {step === 'upload' && (
          <>
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileSelect}
                className="hidden"
              />
              <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-sm font-medium">
                {isLoading ? 'Processing...' : 'Drop CSV file here or click to browse'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Export the Invoice Details Report from Xero
              </p>
            </div>

            <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-blue-500" />
                <p className="font-medium text-sm">How to export from Xero</p>
              </div>
              <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
                <li>In Xero, go to <strong>Reports &rarr; All Reports</strong></li>
                <li>Find and run the <strong>Invoice Details</strong> report</li>
                <li>Set the date range to include your exported invoices</li>
                <li>Click <strong>Export</strong> and choose CSV format</li>
                <li>Upload the downloaded file here</li>
              </ol>
              <a
                href="https://central.xero.com/s/article/Invoice-details-report"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline inline-flex items-center gap-1"
              >
                Xero Report Guide
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </>
        )}

        {/* Preview Step */}
        {step === 'preview' && preview && (
          <>
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <span className="text-muted-foreground">File:</span>{' '}
                <span className="font-medium">{fileName}</span>
              </div>
              <Button id="xero-csv-tax-import-reset-button" variant="outline" size="sm" onClick={handleReset}>
                <RefreshCw className="mr-2 h-3 w-3" />
                Choose Different File
              </Button>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold">{preview.invoiceCount}</p>
                <p className="text-xs text-muted-foreground">Total Invoices</p>
              </div>
              <div className="rounded-lg border p-3 text-center bg-green-50">
                <p className="text-2xl font-bold text-green-600">{preview.matchedCount}</p>
                <p className="text-xs text-muted-foreground">Matched</p>
              </div>
              <div className="rounded-lg border p-3 text-center bg-red-50">
                <p className="text-2xl font-bold text-red-600">{preview.unmatchedCount}</p>
                <p className="text-xs text-muted-foreground">Unmatched</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold">{formatCurrency(preview.totalTaxToImport)}</p>
                <p className="text-xs text-muted-foreground">Tax to Import</p>
              </div>
            </div>

            {/* Additional Stats */}
            {(preview.alreadyImportedCount > 0 || preview.notPendingCount > 0) && (
              <div className="flex gap-4 text-sm">
                {preview.alreadyImportedCount > 0 && (
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <AlertTriangle className="h-4 w-4" />
                    {preview.alreadyImportedCount} already imported
                  </div>
                )}
                {preview.notPendingCount > 0 && (
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <AlertTriangle className="h-4 w-4" />
                    {preview.notPendingCount} not pending external tax
                  </div>
                )}
              </div>
            )}

            {/* Preview Table */}
            <DataTable
              columns={previewColumns}
              data={preview.preview}
              pagination={true}
              pageSize={10}
            />

            {preview.matchedCount === 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  No invoices were matched. Make sure the invoices were exported from Alga with the
                  correct tracking categories and that they have &apos;pending_external&apos; tax source.
                </AlertDescription>
              </Alert>
            )}
          </>
        )}

        {/* Importing Step */}
        {step === 'importing' && (
          <div className="text-center py-8">
            <RefreshCw className="h-8 w-8 mx-auto text-primary animate-spin mb-4" />
            <p className="font-medium">Importing tax amounts...</p>
            <p className="text-sm text-muted-foreground">This may take a moment</p>
          </div>
        )}

        {/* Complete Step */}
        {step === 'complete' && importResult && (
          <>
            <div className="text-center py-4">
              {importResult.success ? (
                <>
                  <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
                  <p className="font-medium text-lg">Import Complete</p>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-12 w-12 mx-auto text-yellow-500 mb-4" />
                  <p className="font-medium text-lg">Import Completed with Issues</p>
                </>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold">{importResult.totalProcessed}</p>
                <p className="text-xs text-muted-foreground">Processed</p>
              </div>
              <div className="rounded-lg border p-3 text-center bg-green-50">
                <p className="text-2xl font-bold text-green-600">{importResult.successCount}</p>
                <p className="text-xs text-muted-foreground">Successful</p>
              </div>
              <div className="rounded-lg border p-3 text-center bg-red-50">
                <p className="text-2xl font-bold text-red-600">{importResult.failureCount}</p>
                <p className="text-xs text-muted-foreground">Failed</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold">{formatCurrency(importResult.totalTaxImported / 100)}</p>
                <p className="text-xs text-muted-foreground">Tax Imported</p>
              </div>
            </div>

            {importResult.errors.length > 0 && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>
                  <p className="font-medium mb-2">Some invoices failed to import:</p>
                  <ul className="list-disc pl-5 text-sm space-y-1">
                    {importResult.errors.slice(0, 5).map((err, i) => (
                      <li key={i}>{err.xeroInvoiceNumber}: {err.error}</li>
                    ))}
                    {importResult.errors.length > 5 && (
                      <li>...and {importResult.errors.length - 5} more</li>
                    )}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <Button id="xero-csv-tax-import-reset-complete-button" onClick={handleReset} className="w-full">
              Import Another File
            </Button>
          </>
        )}
      </CardContent>

      {step === 'preview' && preview && preview.matchedCount > 0 && (
        <CardFooter className="flex justify-between">
          <Button id="xero-csv-tax-import-cancel-button" variant="outline" onClick={handleReset}>
            Cancel
          </Button>
          <Button id="xero-csv-tax-import-confirm-button" onClick={handleImport} disabled={isLoading}>
            <Upload className="mr-2 h-4 w-4" />
            Import {preview.matchedCount} Invoice{preview.matchedCount !== 1 ? 's' : ''}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
};

export default XeroCsvTaxImportPanel;
