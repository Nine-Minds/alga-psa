'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Upload, FileText, AlertCircle, CheckCircle2, HelpCircle, ChevronDown, ChevronUp, XCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import {
  previewXeroCsvTaxImport,
  executeXeroCsvTaxImport
} from '@alga-psa/integrations/actions';
import type { TaxImportPreviewResult, TaxImportResult } from '@alga-psa/types';

interface XeroCsvTaxImportPanelProps {
  onImportComplete?: (result: { successCount: number; totalTaxImported: number }) => void;
}

export function XeroCsvTaxImportPanel({ onImportComplete }: XeroCsvTaxImportPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [previewResult, setPreviewResult] = useState<TaxImportPreviewResult | null>(null);
  const [importResult, setImportResult] = useState<TaxImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setPreviewResult(null);
      setImportResult(null);
      setError(null);
      try {
        const content = await selectedFile.text();
        setCsvContent(content);
      } catch (err) {
        setError('Failed to read file');
        setCsvContent(null);
      }
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && (droppedFile.type === 'text/csv' || droppedFile.name.endsWith('.csv'))) {
      setFile(droppedFile);
      setPreviewResult(null);
      setImportResult(null);
      setError(null);
      try {
        const content = await droppedFile.text();
        setCsvContent(content);
      } catch (err) {
        setError('Failed to read file');
        setCsvContent(null);
      }
    }
  }, []);

  const handleValidate = useCallback(async () => {
    if (!csvContent) {
      setError('Please select a CSV file');
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      const result = await previewXeroCsvTaxImport(csvContent);
      setPreviewResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setIsValidating(false);
    }
  }, [csvContent]);

  const handleImport = useCallback(async () => {
    if (!csvContent) {
      setError('Please select a CSV file');
      return;
    }

    setIsImporting(true);
    setError(null);

    try {
      const result = await executeXeroCsvTaxImport(csvContent);
      setImportResult(result);

      if (result.success || result.successCount > 0) {
        onImportComplete?.({
          successCount: result.successCount,
          totalTaxImported: result.totalTaxImported
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  }, [csvContent, onImportComplete]);

  const canValidate = !!csvContent;
  const canImport = previewResult && previewResult.matchedCount > 0 && !isValidating;

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(cents / 100);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Import Tax from Xero CSV
        </CardTitle>
        <CardDescription>
          Import tax amounts from a Xero Invoice Details Report CSV file.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Help Section */}
        <div className="border rounded-lg">
          <button
            type="button"
            onClick={() => setShowHelp(!showHelp)}
            className="flex items-center justify-between w-full p-4 text-left hover:bg-muted/50"
          >
            <div className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-blue-500" />
              <span className="font-medium">How to export tax data from Xero</span>
            </div>
            {showHelp ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </button>
          {showHelp && (
            <div className="px-4 pb-4 space-y-3 text-sm text-muted-foreground">
              <ol className="list-decimal list-inside space-y-2">
                <li>In Xero, go to <strong>Reports &gt; All Reports</strong></li>
                <li>Select <strong>Sales (Invoices and Revenue)</strong></li>
                <li>Run the <strong>Invoice Details</strong> report</li>
                <li>Set the date range to match your exported invoices</li>
                <li>Click <strong>Export</strong> and choose <strong>CSV</strong></li>
                <li>Upload the exported file here</li>
              </ol>
              <p className="text-muted-foreground">
                The report should include columns for Invoice Number, Contact Name, Line Amount, and Tax Amount.
                Invoices are matched using the Reference field or tracking categories set during export.
              </p>
            </div>
          )}
        </div>

        {/* File Upload */}
        <div className="space-y-2">
          <Label>CSV File</Label>
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              file ? 'border-green-400 bg-green-50 dark:bg-green-950/30 dark:border-green-600' : 'border-border hover:border-muted-foreground hover:bg-muted/50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
            />
            {file ? (
              <div className="flex items-center justify-center gap-2 text-green-700">
                <FileText className="h-6 w-6" />
                <span className="font-medium">{file.name}</span>
                <span className="text-sm text-muted-foreground">
                  ({(file.size / 1024).toFixed(1)} KB)
                </span>
              </div>
            ) : (
              <div className="text-muted-foreground">
                <Upload className="h-8 w-8 mx-auto mb-2" />
                <p>Drag and drop a Xero Invoice Details Report CSV here, or click to browse</p>
              </div>
            )}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Preview Results */}
        {previewResult && (
          <div className="border rounded-lg p-4 space-y-4">
            <h4 className="font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Validation Results
            </h4>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-muted/50 rounded">
                <div className="text-2xl font-bold">{previewResult.invoiceCount}</div>
                <div className="text-sm text-muted-foreground">Total Rows</div>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded">
                <div className="text-2xl font-bold text-green-600">{previewResult.matchedCount}</div>
                <div className="text-sm text-muted-foreground">Matched Invoices</div>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded">
                <div className="text-2xl font-bold text-red-600">{previewResult.unmatchedCount}</div>
                <div className="text-sm text-muted-foreground">Unmatched</div>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded">
                <div className="text-2xl font-bold text-blue-600">
                  {formatCurrency(previewResult.totalTaxToImport * 100)}
                </div>
                <div className="text-sm text-muted-foreground">Tax to Import</div>
              </div>
            </div>

            {previewResult.alreadyImportedCount > 0 && (
              <Alert variant="warning">
                <AlertDescription>{previewResult.alreadyImportedCount} invoice(s) already have imported tax and will be skipped.</AlertDescription>
              </Alert>
            )}

            {previewResult.notPendingCount > 0 && (
              <Alert variant="warning">
                <AlertDescription>{previewResult.notPendingCount} invoice(s) don't have pending external tax and will be skipped.</AlertDescription>
              </Alert>
            )}

            {/* Preview Table */}
            {previewResult.preview.length > 0 && (
              <div className="border rounded-md overflow-hidden max-h-64 overflow-y-auto">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Status</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Xero Invoice</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Alga Invoice</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Contact</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Tax Amount</th>
                    </tr>
                  </thead>
                  <tbody className="bg-card divide-y divide-border">
                    {previewResult.preview.slice(0, 20).map((item, index) => (
                      <tr key={index} className={item.status === 'matched' ? '' : 'bg-muted/50'}>
                        <td className="px-3 py-2">
                          {item.status === 'matched' ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : item.status === 'already_imported' ? (
                            <AlertCircle className="h-4 w-4 text-yellow-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                        </td>
                        <td className="px-3 py-2 text-sm">{item.xeroInvoiceNumber}</td>
                        <td className="px-3 py-2 text-sm">{item.algaInvoiceNumber || '—'}</td>
                        <td className="px-3 py-2 text-sm">{item.contactName}</td>
                        <td className="px-3 py-2 text-sm">{formatCurrency(item.taxAmount * 100)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {previewResult.preview.length > 20 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground bg-muted/50">
                    Showing first 20 of {previewResult.preview.length} rows
                  </div>
                )}
              </div>
            )}

            {/* Unmatched reasons */}
            {previewResult.preview.filter(p => p.status === 'unmatched' && p.reason).length > 0 && (
              <div className="text-sm">
                <h5 className="font-medium text-red-600 mb-2">Errors ({previewResult.unmatchedCount})</h5>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {previewResult.preview
                    .filter(p => p.status === 'unmatched' && p.reason)
                    .slice(0, 10)
                    .map((item, index) => (
                      <div key={index} className="text-destructive bg-destructive/10 px-3 py-1 rounded text-sm">
                        {item.reason}: {item.algaInvoiceId || item.xeroInvoiceNumber}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Import Result */}
        {importResult && (
          <Alert variant={importResult.success ? 'success' : 'warning'}>
            <AlertDescription>
              Imported tax for {importResult.successCount} invoice{importResult.successCount !== 1 ? 's' : ''}.
              Total tax imported: {formatCurrency(importResult.totalTaxImported)}.
              {importResult.failureCount > 0 && ` ${importResult.failureCount} failed.`}
              {importResult.skippedCount > 0 && ` ${importResult.skippedCount} skipped.`}
            </AlertDescription>
          </Alert>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-3">
          <Button
            id="xero-csv-validate-button"
            variant="outline"
            onClick={handleValidate}
            disabled={!canValidate || isValidating || isImporting}
          >
            {isValidating ? (
              <>
                <span className="animate-spin mr-2">⏳</span>
                Validating...
              </>
            ) : (
              'Validate'
            )}
          </Button>
          <Button
            id="xero-csv-import-button"
            onClick={handleImport}
            disabled={!canImport || isImporting}
          >
            {isImporting ? (
              <>
                <span className="animate-spin mr-2">⏳</span>
                Importing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Import Tax Data
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
