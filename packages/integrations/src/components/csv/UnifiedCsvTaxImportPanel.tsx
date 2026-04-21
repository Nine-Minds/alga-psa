'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { StringDateRangePicker } from '@alga-psa/ui/components/DateRangePicker';
import { Label } from '@alga-psa/ui/components/Label';
import ViewSwitcher from '@alga-psa/ui/components/ViewSwitcher';
import { Upload, FileText, AlertCircle, CheckCircle2, HelpCircle, ChevronDown, ChevronUp, XCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import {
  previewXeroCsvTaxImport,
  executeXeroCsvTaxImport
} from '@alga-psa/integrations/actions';
import type { TaxImportPreviewResult, TaxImportResult } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  const { t } = useTranslation('msp/integrations');
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
        setError(t('integrations.csv.taxImport.errors.readFile', { defaultValue: 'Failed to read file' }));
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
        setError(t('integrations.csv.taxImport.errors.readFile', { defaultValue: 'Failed to read file' }));
        setCsvContent(null);
      }
    }
  }, []);

  // Xero validation
  const handleXeroValidate = useCallback(async () => {
    if (!csvContent) {
      setError(t('integrations.csv.taxImport.errors.selectFile', { defaultValue: 'Please select a CSV file' }));
      return;
    }
    setIsValidating(true);
    setError(null);
    try {
      const result = await previewXeroCsvTaxImport(csvContent);
      setXeroPreviewResult(result);
    } catch (err) {
      setError(t('integrations.csv.taxImport.errors.validationFailed', { defaultValue: 'Validation failed' }));
    } finally {
      setIsValidating(false);
    }
  }, [csvContent, t]);

  // Xero import
  const handleXeroImport = useCallback(async () => {
    if (!csvContent) {
      setError(t('integrations.csv.taxImport.errors.selectFile', { defaultValue: 'Please select a CSV file' }));
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
      setError(t('integrations.csv.taxImport.errors.importFailed', { defaultValue: 'Import failed' }));
    } finally {
      setIsImporting(false);
    }
  }, [csvContent, onImportComplete, t]);

  // QuickBooks validation
  const handleQbValidate = useCallback(async () => {
    if (!csvContent || !dateRange.from || !dateRange.to) {
      setError(t('integrations.csv.taxImport.errors.selectFileAndRange', { defaultValue: 'Please select a file and date range' }));
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
        throw new Error(t('integrations.csv.taxImport.errors.validationFailed', { defaultValue: 'Validation failed' }));
      }
      setQbValidationResult(result.validation);
    } catch (err) {
      setError(t('integrations.csv.taxImport.errors.validationFailed', { defaultValue: 'Validation failed' }));
    } finally {
      setIsValidating(false);
    }
  }, [csvContent, dateRange, t]);

  // QuickBooks import
  const handleQbImport = useCallback(async () => {
    if (!csvContent || !dateRange.from || !dateRange.to) {
      setError(t('integrations.csv.taxImport.errors.selectFileAndRange', { defaultValue: 'Please select a file and date range' }));
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
        throw new Error(t('integrations.csv.taxImport.errors.importFailed', { defaultValue: 'Import failed' }));
      }
      setQbImportResult(result);
      if (result.success && result.importId) {
        onImportComplete?.({
          successCount: result.summary.successfulUpdates,
          totalTaxImported: result.summary.totalImportedTax
        });
      }
    } catch (err) {
      setError(t('integrations.csv.taxImport.errors.importFailed', { defaultValue: 'Import failed' }));
    } finally {
      setIsImporting(false);
    }
  }, [csvContent, dateRange, onImportComplete, t]);

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
          {t('integrations.csv.taxImport.unified.title', { defaultValue: 'Import Tax from CSV' })}
        </CardTitle>
        <CardDescription>
          {t('integrations.csv.taxImport.unified.description', { defaultValue: "Import tax amounts from your accounting system's CSV export." })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Source Toggle */}
        <ViewSwitcher
          currentView={source}
          onChange={(value) => {
            if (value === 'xero' || value === 'quickbooks') {
              handleSourceChange(value);
            }
          }}
          options={[
            { value: 'xero' as ImportSource, label: t('integrations.csv.taxImport.unified.source.xero', { defaultValue: 'Xero' }), id: 'csv-tax-import-source-xero', disabled: isValidating || isImporting },
            { value: 'quickbooks' as ImportSource, label: t('integrations.csv.taxImport.unified.source.quickbooks', { defaultValue: 'QuickBooks' }), id: 'csv-tax-import-source-quickbooks', disabled: isValidating || isImporting },
          ]}
          aria-label={t('integrations.csv.taxImport.unified.source.ariaLabel', { defaultValue: 'CSV import source' })}
        />

        {/* Help Section */}
        <div className="border rounded-lg">
          <button
            type="button"
            onClick={() => setShowHelp(!showHelp)}
            className="flex items-center justify-between w-full p-4 text-left hover:bg-muted/50"
          >
            <div className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-blue-500" />
              <span className="font-medium">
                {source === 'xero'
                  ? t('integrations.csv.taxImport.xero.help.title', { defaultValue: 'How to export tax data from Xero' })
                  : t('integrations.csv.taxImport.qbo.help.title', { defaultValue: 'How to export tax data from QuickBooks' })}
              </span>
            </div>
            {showHelp ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </button>
          {showHelp && (
            <div className="px-4 pb-4 space-y-3 text-sm text-muted-foreground">
              {source === 'xero' ? (
                <>
                  <ol className="list-decimal list-inside space-y-2">
                    <li>{t('integrations.csv.taxImport.unified.xeroHelp.s1', { defaultValue: 'In Xero, go to Sales > Invoices' })}</li>
                    <li>{t('integrations.csv.taxImport.unified.xeroHelp.s2', { defaultValue: 'Select the invoice tab you want to export from (e.g., Paid, Awaiting Payment)' })}</li>
                    <li>{t('integrations.csv.taxImport.unified.xeroHelp.s3', { defaultValue: '(Optional) Click Search to filter by Start date, End date, or Date type' })}</li>
                    <li>{t('integrations.csv.taxImport.unified.xeroHelp.s4', { defaultValue: 'Click Export' })}</li>
                    <li>{t('integrations.csv.taxImport.unified.xeroHelp.s5', { defaultValue: 'Xero downloads a CSV file to your computer' })}</li>
                    <li>{t('integrations.csv.taxImport.unified.xeroHelp.s6', { defaultValue: 'Upload that CSV file here' })}</li>
                  </ol>
                  <p className="text-xs text-gray-400 mt-2">
                    {t('integrations.csv.taxImport.unified.xeroHelp.note', { defaultValue: 'Note: Only invoices originally exported from Alga PSA (with Source System = AlgaPSA tracking) will be matched.' })}
                  </p>
                </>
              ) : (
                <ol className="list-decimal list-inside space-y-2">
                  <li>{t('integrations.csv.taxImport.qbo.help.steps.s1', { defaultValue: 'In QuickBooks, go to Reports > All Reports' })}</li>
                  <li>{t('integrations.csv.taxImport.qbo.help.steps.s2', { defaultValue: 'Select Sales Tax Liability or Transaction Detail by Account' })}</li>
                  <li>{t('integrations.csv.taxImport.qbo.help.steps.s3', { defaultValue: 'Set the date range to match your exported invoices' })}</li>
                  <li>{t('integrations.csv.taxImport.qbo.help.steps.s4', { defaultValue: 'Click Export and choose Export to Excel or Export to CSV' })}</li>
                  <li>{t('integrations.csv.taxImport.qbo.help.steps.s5', { defaultValue: 'Save the file and upload it here' })}</li>
                </ol>
              )}
              <p className="text-muted-foreground">
                {source === 'xero'
                  ? t('integrations.csv.taxImport.unified.xeroCsvDescription', { defaultValue: 'The exported CSV includes Invoice Number, Contact Name, Line Amount, Tax Amount, and tracking categories.' })
                  : t('integrations.csv.taxImport.qbo.help.csvRequirement', { defaultValue: 'The CSV must include Invoice Number, Invoice Date, and Tax Amount columns.' })}
              </p>
            </div>
          )}
        </div>

        {/* Date Range (QuickBooks only) */}
        {source === 'quickbooks' && (
          <div>
            <StringDateRangePicker
              id="unified-tax-import-date-range"
              label={t('integrations.csv.taxImport.fields.dateRangeRequired', { defaultValue: 'Date Range (required)' })}
              value={dateRange}
              onChange={setDateRange}
            />
            <p className="text-sm text-muted-foreground mt-1">
              {t('integrations.csv.taxImport.fields.dateRangeHelp', { defaultValue: 'Only invoices within this date range will be processed.' })}
            </p>
          </div>
        )}

        {/* File Upload */}
        <div className="space-y-2">
          <Label>{t('integrations.csv.taxImport.fields.csvFile', { defaultValue: 'CSV File' })}</Label>
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
                  {t('integrations.csv.taxImport.fields.fileSize', { defaultValue: '({{size}} KB)', size: (file.size / 1024).toFixed(1) })}
                </span>
              </div>
            ) : (
              <div className="text-muted-foreground">
                <Upload className="h-8 w-8 mx-auto mb-2" />
                <p>{t('integrations.csv.taxImport.fields.dropZone', { defaultValue: 'Drag and drop a CSV file here, or click to browse' })}</p>
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

        {/* Xero Preview Results */}
        {source === 'xero' && xeroPreviewResult && (
          <div className="border rounded-lg p-4 space-y-4">
            <h4 className="font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {t('integrations.csv.taxImport.preview.title', { defaultValue: 'Validation Results' })}
            </h4>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-muted/50 rounded">
                <div className="text-2xl font-bold">{xeroPreviewResult.invoiceCount}</div>
                <div className="text-sm text-muted-foreground">{t('integrations.csv.taxImport.preview.totalRows', { defaultValue: 'Total Rows' })}</div>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded">
                <div className="text-2xl font-bold text-green-600">{xeroPreviewResult.matchedCount}</div>
                <div className="text-sm text-muted-foreground">{t('integrations.csv.taxImport.preview.matched', { defaultValue: 'Matched' })}</div>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded">
                <div className="text-2xl font-bold text-red-600">{xeroPreviewResult.unmatchedCount}</div>
                <div className="text-sm text-muted-foreground">{t('integrations.csv.taxImport.preview.unmatched', { defaultValue: 'Unmatched' })}</div>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded">
                <div className="text-2xl font-bold text-blue-600">
                  {formatCurrency(xeroPreviewResult.totalTaxToImport * 100)}
                </div>
                <div className="text-sm text-muted-foreground">{t('integrations.csv.taxImport.preview.taxToImport', { defaultValue: 'Tax to Import' })}</div>
              </div>
            </div>

            {xeroPreviewResult.alreadyImportedCount > 0 && (
              <Alert variant="warning">
                <AlertDescription>{t('integrations.csv.taxImport.preview.alreadyImported', { defaultValue: '{{count}} invoice(s) already have imported tax.', count: xeroPreviewResult.alreadyImportedCount })}</AlertDescription>
              </Alert>
            )}

            {xeroPreviewResult.notPendingCount > 0 && (
              <Alert variant="warning">
                <AlertDescription>
                  <div>
                    <span className="font-medium">{t('integrations.csv.taxImport.preview.notPendingTitle', { defaultValue: "{{count}} invoice(s) don't use external tax calculation.", count: xeroPreviewResult.notPendingCount })}</span>
                    <p className="text-xs mt-1 opacity-80">
                      {t('integrations.csv.taxImport.preview.notPendingDescription', { defaultValue: 'These invoices were created with internal tax calculation. To import tax from Xero, invoices must be set up with "Pending External" tax source when exported.' })}
                    </p>
                    <div className="mt-2 space-y-1">
                      {xeroPreviewResult.preview
                        .filter(p => p.status === 'not_pending')
                        .slice(0, 3)
                        .map((item, index) => (
                          <div key={index} className="text-xs bg-warning/20 px-2 py-1 rounded">
                            {item.xeroInvoiceNumber} ({item.contactName}): {item.reason}
                          </div>
                        ))}
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {xeroPreviewResult.preview.filter(p => p.status === 'unmatched').length > 0 && (
              <div className="text-sm">
                <h5 className="font-medium text-red-600 mb-2">{t('integrations.csv.taxImport.preview.errorsTitle', { defaultValue: 'Errors ({{count}})', count: xeroPreviewResult.unmatchedCount })}</h5>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {xeroPreviewResult.preview
                    .filter(p => p.status === 'unmatched' && p.reason)
                    .slice(0, 5)
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

        {/* QuickBooks Validation Results */}
        {source === 'quickbooks' && qbValidationResult && (
          <div className="border rounded-lg p-4 space-y-4">
            <h4 className="font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {t('integrations.csv.taxImport.preview.title', { defaultValue: 'Validation Results' })}
            </h4>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-muted/50 rounded">
                <div className="text-2xl font-bold">{qbValidationResult.stats.totalRows}</div>
                <div className="text-sm text-muted-foreground">{t('integrations.csv.taxImport.preview.totalRows', { defaultValue: 'Total Rows' })}</div>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded">
                <div className="text-2xl font-bold">{qbValidationResult.stats.validRows}</div>
                <div className="text-sm text-muted-foreground">{t('integrations.csv.taxImport.preview.validRows', { defaultValue: 'Valid Rows' })}</div>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded">
                <div className="text-2xl font-bold text-green-600">{qbValidationResult.stats.matchedInvoices}</div>
                <div className="text-sm text-muted-foreground">{t('integrations.csv.taxImport.preview.matched', { defaultValue: 'Matched' })}</div>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded">
                <div className="text-2xl font-bold">{qbValidationResult.stats.uniqueInvoices}</div>
                <div className="text-sm text-muted-foreground">{t('integrations.csv.taxImport.preview.uniqueInvoices', { defaultValue: 'Unique Invoices' })}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {qbValidationResult.structureValid && (
                <Badge variant="success" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" /> {t('integrations.csv.taxImport.preview.badges.structure', { defaultValue: 'Structure' })}
                </Badge>
              )}
              {qbValidationResult.rowsValid && (
                <Badge variant="success" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" /> {t('integrations.csv.taxImport.preview.badges.rowData', { defaultValue: 'Row Data' })}
                </Badge>
              )}
              {qbValidationResult.databaseValid ? (
                <Badge variant="success" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" /> {t('integrations.csv.taxImport.preview.badges.databaseMatch', { defaultValue: 'Database Match' })}
                </Badge>
              ) : (
                <Badge variant="error" className="gap-1">
                  <XCircle className="h-3 w-3" /> {t('integrations.csv.taxImport.preview.badges.databaseMatch', { defaultValue: 'Database Match' })}
                </Badge>
              )}
            </div>

            {qbValidationResult.errors.length > 0 && (
              <div className="text-sm">
                <h5 className="font-medium text-red-600 mb-2">{t('integrations.csv.taxImport.preview.errorsTitle', { defaultValue: 'Errors ({{count}})', count: qbValidationResult.errors.length })}</h5>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {qbValidationResult.errors.slice(0, 5).map((err, index) => (
                    <div key={index} className="text-destructive bg-destructive/10 px-3 py-1 rounded text-sm">
                      {err.message}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {qbValidationResult.warnings.length > 0 && (
              <div className="text-sm">
                <h5 className="font-medium text-yellow-600 mb-2">{t('integrations.csv.taxImport.preview.warningsTitle', { defaultValue: 'Warnings ({{count}})', count: qbValidationResult.warnings.length })}</h5>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {qbValidationResult.warnings.slice(0, 5).map((warn, index) => (
                    <div key={index} className="text-warning bg-warning/10 px-3 py-1 rounded text-sm">
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
          <Alert variant={xeroImportResult.success ? 'success' : 'warning'}>
            <AlertDescription>
              {xeroImportResult.successCount === 1
                ? t('integrations.csv.taxImport.unified.xeroResult.one', { defaultValue: 'Imported tax for {{count}} invoice. Total: {{amount}}.', count: xeroImportResult.successCount, amount: formatCurrency(xeroImportResult.totalTaxImported) })
                : t('integrations.csv.taxImport.unified.xeroResult.other', { defaultValue: 'Imported tax for {{count}} invoices. Total: {{amount}}.', count: xeroImportResult.successCount, amount: formatCurrency(xeroImportResult.totalTaxImported) })}
              {xeroImportResult.failureCount > 0 && ` ${t('integrations.csv.taxImport.result.failed', { defaultValue: '{{count}} failed.', count: xeroImportResult.failureCount })}`}
            </AlertDescription>
          </Alert>
        )}

        {source === 'quickbooks' && qbImportResult?.success && (
          <Alert variant="success">
            <AlertDescription>
              {qbImportResult.summary.successfulUpdates === 1
                ? t('integrations.csv.taxImport.unified.qbResult.one', { defaultValue: 'Successfully imported tax for {{count}} invoice. Total tax imported: {{amount}}', count: qbImportResult.summary.successfulUpdates, amount: formatCurrency(qbImportResult.summary.totalImportedTax) })
                : t('integrations.csv.taxImport.unified.qbResult.other', { defaultValue: 'Successfully imported tax for {{count}} invoices. Total tax imported: {{amount}}', count: qbImportResult.summary.successfulUpdates, amount: formatCurrency(qbImportResult.summary.totalImportedTax) })}
            </AlertDescription>
          </Alert>
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
                {t('integrations.csv.taxImport.actions.validating', { defaultValue: 'Validating...' })}
              </>
            ) : (
              t('integrations.csv.taxImport.actions.validate', { defaultValue: 'Validate' })
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
                {t('integrations.csv.taxImport.actions.importing', { defaultValue: 'Importing...' })}
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                {t('integrations.csv.taxImport.actions.importTaxData', { defaultValue: 'Import Tax Data' })}
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
