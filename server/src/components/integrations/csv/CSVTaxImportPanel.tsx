'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { StringDateRangePicker } from '../../ui/DateRangePicker';
import { Label } from '../../ui/Label';
import { Upload, FileText, AlertCircle, CheckCircle2, HelpCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { CSVImportPreview } from './CSVImportPreview';

interface CSVTaxImportPanelProps {
  onImportComplete?: (result: { importId: string; invoiceCount: number }) => void;
}

interface ValidationResult {
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

interface ImportResult {
  success: boolean;
  importId?: string;
  validation: ValidationResult;
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

export function CSVTaxImportPanel({ onImportComplete }: CSVTaxImportPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({
    from: '',
    to: ''
  });
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setValidationResult(null);
      setImportResult(null);
      setError(null);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && droppedFile.type === 'text/csv') {
      setFile(droppedFile);
      setValidationResult(null);
      setImportResult(null);
      setError(null);
    }
  }, []);

  const handleValidate = useCallback(async () => {
    if (!file || !dateRange.from || !dateRange.to) {
      setError('Please select a file and date range');
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      const csvContent = await file.text();

      const response = await fetch('/api/accounting/csv/import/tax', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
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

      setValidationResult(result.validation);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setIsValidating(false);
    }
  }, [file, dateRange]);

  const handleImport = useCallback(async () => {
    if (!file || !dateRange.from || !dateRange.to) {
      setError('Please select a file and date range');
      return;
    }

    setIsImporting(true);
    setError(null);

    try {
      const csvContent = await file.text();

      const response = await fetch('/api/accounting/csv/import/tax', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          csvContent,
          startDate: dateRange.from,
          endDate: dateRange.to,
          dryRun: false
        })
      });

      const result: ImportResult = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Import failed');
      }

      setImportResult(result);

      if (result.success && result.importId) {
        onImportComplete?.({
          importId: result.importId,
          invoiceCount: result.summary.successfulUpdates
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  }, [file, dateRange, onImportComplete]);

  const handleDownloadTemplate = useCallback(async () => {
    try {
      const response = await fetch('/api/accounting/csv/import/tax/template');
      if (!response.ok) {
        throw new Error('Failed to download template');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tax-import-template.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download template');
    }
  }, []);

  const canValidate = file && dateRange.from && dateRange.to;
  const canImport = validationResult?.valid && !isValidating;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Import Tax from QuickBooks CSV
        </CardTitle>
        <CardDescription>
          Import tax amounts from a QuickBooks tax report CSV file.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Help Section */}
        <div className="border rounded-lg">
          <button
            type="button"
            onClick={() => setShowHelp(!showHelp)}
            className="flex items-center justify-between w-full p-4 text-left hover:bg-gray-50"
          >
            <div className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-blue-500" />
              <span className="font-medium">How to export tax data from QuickBooks</span>
            </div>
            {showHelp ? (
              <ChevronUp className="h-5 w-5 text-gray-500" />
            ) : (
              <ChevronDown className="h-5 w-5 text-gray-500" />
            )}
          </button>
          {showHelp && (
            <div className="px-4 pb-4 space-y-3 text-sm text-gray-600">
              <ol className="list-decimal list-inside space-y-2">
                <li>In QuickBooks, go to <strong>Reports &gt; All Reports</strong></li>
                <li>Select <strong>Sales Tax Liability</strong> or <strong>Transaction Detail by Account</strong></li>
                <li>Set the date range to match your exported invoices</li>
                <li>Click <strong>Export</strong> and choose <strong>Export to Excel</strong> or <strong>Export to CSV</strong></li>
                <li>Save the file and upload it here</li>
              </ol>
              <p className="text-gray-500">
                The CSV must include Invoice Number, Invoice Date, and Tax Amount columns.
              </p>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="text-blue-600 hover:underline"
              >
                Download template CSV
              </button>
            </div>
          )}
        </div>

        {/* Date Range (Required) */}
        <div>
          <StringDateRangePicker
            id="csv-tax-import-date-range"
            label="Date Range (required)"
            value={dateRange}
            onChange={setDateRange}
          />
          <p className="text-sm text-gray-500 mt-1">
            Only invoices within this date range will be processed.
          </p>
        </div>

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

        {/* Validation/Import Preview */}
        {validationResult && (
          <CSVImportPreview validation={validationResult} importResult={importResult} />
        )}

        {/* Success Message */}
        {importResult?.success && (
          <div className="flex items-center gap-2 p-3 bg-green-50 text-green-700 rounded-lg">
            <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
            <span>
              Successfully imported tax for {importResult.summary.successfulUpdates} invoice
              {importResult.summary.successfulUpdates !== 1 ? 's' : ''}.
              Total tax imported: ${(importResult.summary.totalImportedTax / 100).toFixed(2)}
            </span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-3">
          <Button
            id="csv-validate-button"
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
            id="csv-import-button"
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
