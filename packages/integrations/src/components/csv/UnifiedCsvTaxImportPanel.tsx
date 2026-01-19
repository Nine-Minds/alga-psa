'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { StringDateRangePicker } from '@alga-psa/ui/components/DateRangePicker';
import { Label } from '@alga-psa/ui/components/Label';
import { ToggleGroup, ToggleGroupItem } from '@alga-psa/ui/components/ToggleGroup';
import { Upload, FileText, AlertCircle, CheckCircle2, HelpCircle, ChevronDown, ChevronUp, XCircle } from 'lucide-react';
import {
  previewXeroCsvTaxImport,
  executeXeroCsvTaxImport
} from '@alga-psa/integrations/actions';
import type { TaxImportPreviewResult, TaxImportResult } from '@alga-psa/types';

type ImportSource = 'xero' | 'quickbooks';

interface UnifiedCsvTaxImportPanelProps {
  onImportComplete?: (result: { successCount: number; totalTaxImported: number }) => void;
}

interface QuickBooksValidationResult {
  valid: boolean;
  structureValid: boolean;
  rowsValid: boolean;
  databaseValid: boolean;
  errors: Array<{ rowNumber?: number; field: string; message: string }>;
  warnings: Array<{ rowNumber?: number; field: string; message: string }>;
  stats: {
    totalRows: number;
    validRows: number;
    matchedInvoices: number;
    uniqueInvoices: number;
    duplicateInvoices: string[];
  };
}

interface QuickBooksImportResult {
  success: boolean;
  importId?: string;
  validation: QuickBooksValidationResult;
  summary: {
    totalInvoices: number;
    successfulUpdates: number;
    failedUpdates: number;
    totalOriginalTax: number;
    totalImportedTax: number;
    totalDifference: number;
  };
  error?: string;
}

export function UnifiedCsvTaxImportPanel({ onImportComplete }: UnifiedCsvTaxImportPanelProps) {
  const [source, setSource] = useState<ImportSource>('xero');
  const [file, setFile] = useState<File | null>(null);
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Xero state
  const [xeroPreviewResult, setXeroPreviewResult] = useState<TaxImportPreviewResult | null>(null);
  const [xeroImportResult, setXeroImportResult] = useState<TaxImportResult | null>(null);

  // QuickBooks state
  const [qbValidationResult, setQbValidationResult] = useState<QuickBooksValidationResult | null>(null);
  const [qbImportResult, setQbImportResult] = useState<QuickBooksImportResult | null>(null);

  const resetState = useCallback(() => {
    setFile(null);
    setCsvContent(null);
    setXeroPreviewResult(null);
    setXeroImportResult(null);
    setQbValidationResult(null);
    setQbImportResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleSourceChange = useCallback((newSource: ImportSource) => {
    setSource(newSource);
    resetState();
  }, [resetState]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setXeroPreviewResult(null);
      setXeroImportResult(null);
      setQbValidationResult(null);
      setQbImportResult(null);
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
      setXeroPreviewResult(null);
      setXeroImportResult(null);
      setQbValidationResult(null);
      setQbImportResult(null);
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

  // Xero validation
  const handleXeroValidate = useCallback(async () => {
    if (!csvContent) {
      setError('Please select a CSV file');
      return;
    }
    setIsValidating(true);
    setError(null);
    try {
      const result = await previewXeroCsvTaxImport(csvContent);
      setXeroPreviewResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setIsValidating(false);
    }
  }, [csvContent]);

  // Xero import
  const handleXeroImport = useCallback(async () => {
    if (!csvContent) {
      setError('Please select a CSV file');
      return;
    }
    setIsImporting(true);
    setError(null);
    try {
      const result = await executeXeroCsvTaxImport(csvContent);
      setXeroImportResult(result);
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

  // QuickBooks validation
  const handleQbValidate = useCallback(async () => {
    if (!csvContent || !dateRange.from || !dateRange.to) {
      setError('Please select a file and date range');
      return;
    }
    setIsValidating(true);
    setError(null);
    try {
      const response = await fetch('/api/accounting/csv/import/tax', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csvContent,
          startDate: dateRange.from,
          endDate: dateRange.to,
          dryRun: true
        })
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || 'Validation failed');
      }
      setQbValidationResult(result.validation);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setIsValidating(false);
    }
  }, [csvContent, dateRange]);

  // QuickBooks import
  const handleQbImport = useCallback(async () => {
    if (!csvContent || !dateRange.from || !dateRange.to) {
      setError('Please select a file and date range');
      return;
    }
    setIsImporting(true);
    setError(null);
    try {
      const response = await fetch('/api/accounting/csv/import/tax', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csvContent,
          startDate: dateRange.from,
          endDate: dateRange.to,
          dryRun: false
        })
      });
      const result: QuickBooksImportResult = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Import failed');
      }
      setQbImportResult(result);
      if (result.success && result.importId) {
        onImportComplete?.({
          successCount: result.summary.successfulUpdates,
          totalTaxImported: result.summary.totalImportedTax
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  }, [csvContent, dateRange, onImportComplete]);

  const canValidate = source === 'xero'
    ? !!csvContent
    : !!csvContent && !!dateRange.from && !!dateRange.to;

  const canImport = source === 'xero'
    ? xeroPreviewResult && xeroPreviewResult.matchedCount > 0 && !isValidating
    : qbValidationResult?.valid && !isValidating;

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
          Import Tax from CSV
        </CardTitle>
        <CardDescription>
          Import tax amounts from your accounting system's CSV export.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Source Toggle */}
        <ToggleGroup
          type="single"
          value={source}
          onValueChange={(value) => {
            if (value === 'xero' || value === 'quickbooks') {
              handleSourceChange(value);
            }
          }}
          aria-label="CSV import source"
        >
          <ToggleGroupItem
            id="csv-tax-import-source-xero"
            value="xero"
            disabled={isValidating || isImporting}
          >
            Xero
          </ToggleGroupItem>
          <ToggleGroupItem
            id="csv-tax-import-source-quickbooks"
            value="quickbooks"
            disabled={isValidating || isImporting}
          >
            QuickBooks
          </ToggleGroupItem>
        </ToggleGroup>

        {/* Help Section */}
        <div className="border rounded-lg">
          <button
            type="button"
            onClick={() => setShowHelp(!showHelp)}
            className="flex items-center justify-between w-full p-4 text-left hover:bg-gray-50"
          >
            <div className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-blue-500" />
              <span className="font-medium">
                How to export tax data from {source === 'xero' ? 'Xero' : 'QuickBooks'}
              </span>
            </div>
            {showHelp ? (
              <ChevronUp className="h-5 w-5 text-gray-500" />
            ) : (
              <ChevronDown className="h-5 w-5 text-gray-500" />
            )}
          </button>
          {showHelp && (
            <div className="px-4 pb-4 space-y-3 text-sm text-gray-600">
              {source === 'xero' ? (
                <>
                  <ol className="list-decimal list-inside space-y-2">
                    <li>In Xero, go to <strong>Sales &gt; Invoices</strong></li>
                    <li>Select the invoice tab you want to export from (e.g., Paid, Awaiting Payment)</li>
                    <li>(Optional) Click <strong>Search</strong> to filter by Start date, End date, or Date type</li>
                    <li>Click <strong>Export</strong></li>
                    <li>Xero downloads a CSV file to your computer</li>
                    <li>Upload that CSV file here</li>
                  </ol>
                  <p className="text-xs text-gray-400 mt-2">
                    Note: Only invoices originally exported from Alga PSA (with Source System = AlgaPSA tracking) will be matched.
                  </p>
                </>
              ) : (
                <ol className="list-decimal list-inside space-y-2">
                  <li>In QuickBooks, go to <strong>Reports &gt; All Reports</strong></li>
                  <li>Select <strong>Sales Tax Liability</strong> or <strong>Transaction Detail by Account</strong></li>
                  <li>Set the date range to match your exported invoices</li>
                  <li>Click <strong>Export</strong> and choose <strong>Export to Excel</strong> or <strong>Export to CSV</strong></li>
                  <li>Save the file and upload it here</li>
                </ol>
              )}
              <p className="text-gray-500">
                {source === 'xero'
                  ? 'The exported CSV includes Invoice Number, Contact Name, Line Amount, Tax Amount, and tracking categories.'
                  : 'The CSV must include Invoice Number, Invoice Date, and Tax Amount columns.'}
              </p>
            </div>
          )}
        </div>

        {/* Date Range (QuickBooks only) */}
        {source === 'quickbooks' && (
          <div>
            <StringDateRangePicker
              id="unified-tax-import-date-range"
              label="Date Range (required)"
              value={dateRange}
              onChange={setDateRange}
            />
            <p className="text-sm text-gray-500 mt-1">
              Only invoices within this date range will be processed.
            </p>
          </div>
        )}

        {/* File Upload */}
        <div className="space-y-2">
          <Label>CSV File</Label>
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              file ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
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
                <span className="text-sm text-gray-500">
                  ({(file.size / 1024).toFixed(1)} KB)
                </span>
              </div>
            ) : (
              <div className="text-gray-500">
                <Upload className="h-8 w-8 mx-auto mb-2" />
                <p>Drag and drop a CSV file here, or click to browse</p>
              </div>
            )}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Xero Preview Results */}
        {source === 'xero' && xeroPreviewResult && (
          <div className="border rounded-lg p-4 space-y-4">
            <h4 className="font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Validation Results
            </h4>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-gray-50 rounded">
                <div className="text-2xl font-bold">{xeroPreviewResult.invoiceCount}</div>
                <div className="text-sm text-gray-500">Total Rows</div>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded">
                <div className="text-2xl font-bold text-green-600">{xeroPreviewResult.matchedCount}</div>
                <div className="text-sm text-gray-500">Matched</div>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded">
                <div className="text-2xl font-bold text-red-600">{xeroPreviewResult.unmatchedCount}</div>
                <div className="text-sm text-gray-500">Unmatched</div>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded">
                <div className="text-2xl font-bold text-blue-600">
                  {formatCurrency(xeroPreviewResult.totalTaxToImport * 100)}
                </div>
                <div className="text-sm text-gray-500">Tax to Import</div>
              </div>
            </div>

            {xeroPreviewResult.alreadyImportedCount > 0 && (
              <div className="flex items-center gap-2 p-3 bg-yellow-50 text-yellow-700 rounded-lg text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{xeroPreviewResult.alreadyImportedCount} invoice(s) already have imported tax.</span>
              </div>
            )}

            {xeroPreviewResult.notPendingCount > 0 && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 text-amber-700 rounded-lg text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium">{xeroPreviewResult.notPendingCount} invoice(s) don't use external tax calculation.</span>
                  <p className="text-xs mt-1 text-amber-600">
                    These invoices were created with internal tax calculation. To import tax from Xero, invoices must be set up with "Pending External" tax source when exported.
                  </p>
                  <div className="mt-2 space-y-1">
                    {xeroPreviewResult.preview
                      .filter(p => p.status === 'not_pending')
                      .slice(0, 3)
                      .map((item, index) => (
                        <div key={index} className="text-xs bg-amber-100 px-2 py-1 rounded">
                          {item.xeroInvoiceNumber} ({item.contactName}): {item.reason}
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {xeroPreviewResult.preview.filter(p => p.status === 'unmatched').length > 0 && (
              <div className="text-sm">
                <h5 className="font-medium text-red-600 mb-2">Errors ({xeroPreviewResult.unmatchedCount})</h5>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {xeroPreviewResult.preview
                    .filter(p => p.status === 'unmatched' && p.reason)
                    .slice(0, 5)
                    .map((item, index) => (
                      <div key={index} className="text-red-600 bg-red-50 px-3 py-1 rounded text-sm">
                        {item.reason}: {item.algaInvoiceId || item.xeroInvoiceNumber}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* QuickBooks Validation Results */}
        {source === 'quickbooks' && qbValidationResult && (
          <div className="border rounded-lg p-4 space-y-4">
            <h4 className="font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Validation Results
            </h4>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-gray-50 rounded">
                <div className="text-2xl font-bold">{qbValidationResult.stats.totalRows}</div>
                <div className="text-sm text-gray-500">Total Rows</div>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded">
                <div className="text-2xl font-bold">{qbValidationResult.stats.validRows}</div>
                <div className="text-sm text-gray-500">Valid Rows</div>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded">
                <div className="text-2xl font-bold text-green-600">{qbValidationResult.stats.matchedInvoices}</div>
                <div className="text-sm text-gray-500">Matched</div>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded">
                <div className="text-2xl font-bold">{qbValidationResult.stats.uniqueInvoices}</div>
                <div className="text-sm text-gray-500">Unique Invoices</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {qbValidationResult.structureValid && (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded text-sm">
                  <CheckCircle2 className="h-3 w-3" /> Structure
                </span>
              )}
              {qbValidationResult.rowsValid && (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded text-sm">
                  <CheckCircle2 className="h-3 w-3" /> Row Data
                </span>
              )}
              {qbValidationResult.databaseValid ? (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded text-sm">
                  <CheckCircle2 className="h-3 w-3" /> Database Match
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded text-sm">
                  <XCircle className="h-3 w-3" /> Database Match
                </span>
              )}
            </div>

            {qbValidationResult.errors.length > 0 && (
              <div className="text-sm">
                <h5 className="font-medium text-red-600 mb-2">Errors ({qbValidationResult.errors.length})</h5>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {qbValidationResult.errors.slice(0, 5).map((err, index) => (
                    <div key={index} className="text-red-600 bg-red-50 px-3 py-1 rounded text-sm">
                      {err.message}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {qbValidationResult.warnings.length > 0 && (
              <div className="text-sm">
                <h5 className="font-medium text-yellow-600 mb-2">Warnings ({qbValidationResult.warnings.length})</h5>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {qbValidationResult.warnings.slice(0, 5).map((warn, index) => (
                    <div key={index} className="text-yellow-600 bg-yellow-50 px-3 py-1 rounded text-sm">
                      {warn.message}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Import Result */}
        {source === 'xero' && xeroImportResult && (
          <div className={`flex items-center gap-2 p-3 rounded-lg ${
            xeroImportResult.success ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'
          }`}>
            {xeroImportResult.success ? (
              <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
            ) : (
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
            )}
            <span>
              Imported tax for {xeroImportResult.successCount} invoice{xeroImportResult.successCount !== 1 ? 's' : ''}.
              Total: {formatCurrency(xeroImportResult.totalTaxImported)}.
              {xeroImportResult.failureCount > 0 && ` ${xeroImportResult.failureCount} failed.`}
            </span>
          </div>
        )}

        {source === 'quickbooks' && qbImportResult?.success && (
          <div className="flex items-center gap-2 p-3 bg-green-50 text-green-700 rounded-lg">
            <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
            <span>
              Successfully imported tax for {qbImportResult.summary.successfulUpdates} invoice
              {qbImportResult.summary.successfulUpdates !== 1 ? 's' : ''}.
              Total tax imported: {formatCurrency(qbImportResult.summary.totalImportedTax)}
            </span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-3">
          <Button
            id="csv-tax-validate-button"
            variant="outline"
            onClick={source === 'xero' ? handleXeroValidate : handleQbValidate}
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
            id="csv-tax-import-button"
            onClick={source === 'xero' ? handleXeroImport : handleQbImport}
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
