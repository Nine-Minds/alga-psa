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
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface XeroCsvTaxImportPanelProps {
  onImportComplete?: (result: { successCount: number; totalTaxImported: number }) => void;
}

export function XeroCsvTaxImportPanel({ onImportComplete }: XeroCsvTaxImportPanelProps) {
  const { t } = useTranslation();
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
      setPreviewResult(null);
      setImportResult(null);
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

  const handleValidate = useCallback(async () => {
    if (!csvContent) {
      setError(t('integrations.csv.taxImport.errors.selectFile', { defaultValue: 'Please select a CSV file' }));
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      const result = await previewXeroCsvTaxImport(csvContent);
      setPreviewResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('integrations.csv.taxImport.errors.validationFailed', { defaultValue: 'Validation failed' }));
    } finally {
      setIsValidating(false);
    }
  }, [csvContent, t]);

  const handleImport = useCallback(async () => {
    if (!csvContent) {
      setError(t('integrations.csv.taxImport.errors.selectFile', { defaultValue: 'Please select a CSV file' }));
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
      setError(err instanceof Error ? err.message : t('integrations.csv.taxImport.errors.importFailed', { defaultValue: 'Import failed' }));
    } finally {
      setIsImporting(false);
    }
  }, [csvContent, onImportComplete, t]);

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
          {t('integrations.csv.taxImport.xero.title', { defaultValue: 'Import Tax from Xero CSV' })}
        </CardTitle>
        <CardDescription>
          {t('integrations.csv.taxImport.xero.description', { defaultValue: 'Import tax amounts from a Xero Invoice Details Report CSV file.' })}
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
              <span className="font-medium">{t('integrations.csv.taxImport.xero.help.title', { defaultValue: 'How to export tax data from Xero' })}</span>
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
                <li>{t('integrations.csv.taxImport.xero.help.steps.s1', { defaultValue: 'In Xero, go to Reports > All Reports' })}</li>
                <li>{t('integrations.csv.taxImport.xero.help.steps.s2', { defaultValue: 'Select Sales (Invoices and Revenue)' })}</li>
                <li>{t('integrations.csv.taxImport.xero.help.steps.s3', { defaultValue: 'Run the Invoice Details report' })}</li>
                <li>{t('integrations.csv.taxImport.xero.help.steps.s4', { defaultValue: 'Set the date range to match your exported invoices' })}</li>
                <li>{t('integrations.csv.taxImport.xero.help.steps.s5', { defaultValue: 'Click Export and choose CSV' })}</li>
                <li>{t('integrations.csv.taxImport.xero.help.steps.s6', { defaultValue: 'Upload the exported file here' })}</li>
              </ol>
              <p className="text-muted-foreground">
                {t('integrations.csv.taxImport.xero.help.csvRequirement', { defaultValue: 'The report should include columns for Invoice Number, Contact Name, Line Amount, and Tax Amount. Invoices are matched using the Reference field or tracking categories set during export.' })}
              </p>
            </div>
          )}
        </div>

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
                <p>{t('integrations.csv.taxImport.xero.dropZone', { defaultValue: 'Drag and drop a Xero Invoice Details Report CSV here, or click to browse' })}</p>
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
              {t('integrations.csv.taxImport.preview.title', { defaultValue: 'Validation Results' })}
            </h4>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-muted/50 rounded">
                <div className="text-2xl font-bold">{previewResult.invoiceCount}</div>
                <div className="text-sm text-muted-foreground">{t('integrations.csv.taxImport.preview.totalRows', { defaultValue: 'Total Rows' })}</div>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded">
                <div className="text-2xl font-bold text-green-600">{previewResult.matchedCount}</div>
                <div className="text-sm text-muted-foreground">{t('integrations.csv.taxImport.preview.matchedInvoices', { defaultValue: 'Matched Invoices' })}</div>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded">
                <div className="text-2xl font-bold text-red-600">{previewResult.unmatchedCount}</div>
                <div className="text-sm text-muted-foreground">{t('integrations.csv.taxImport.preview.unmatched', { defaultValue: 'Unmatched' })}</div>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded">
                <div className="text-2xl font-bold text-blue-600">
                  {formatCurrency(previewResult.totalTaxToImport * 100)}
                </div>
                <div className="text-sm text-muted-foreground">{t('integrations.csv.taxImport.preview.taxToImport', { defaultValue: 'Tax to Import' })}</div>
              </div>
            </div>

            {previewResult.alreadyImportedCount > 0 && (
              <Alert variant="warning">
                <AlertDescription>{t('integrations.csv.taxImport.preview.alreadyImportedSkip', { defaultValue: '{{count}} invoice(s) already have imported tax and will be skipped.', count: previewResult.alreadyImportedCount })}</AlertDescription>
              </Alert>
            )}

            {previewResult.notPendingCount > 0 && (
              <Alert variant="warning">
                <AlertDescription>{t('integrations.csv.taxImport.preview.notPendingSkip', { defaultValue: "{{count}} invoice(s) don't have pending external tax and will be skipped.", count: previewResult.notPendingCount })}</AlertDescription>
              </Alert>
            )}

            {/* Preview Table */}
            {previewResult.preview.length > 0 && (
              <div className="border rounded-md overflow-hidden max-h-64 overflow-y-auto">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">{t('integrations.csv.taxImport.preview.columns.status', { defaultValue: 'Status' })}</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">{t('integrations.csv.taxImport.preview.columns.xeroInvoice', { defaultValue: 'Xero Invoice' })}</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">{t('integrations.csv.taxImport.preview.columns.algaInvoice', { defaultValue: 'Alga Invoice' })}</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">{t('integrations.csv.taxImport.preview.columns.contact', { defaultValue: 'Contact' })}</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase">{t('integrations.csv.taxImport.preview.columns.taxAmount', { defaultValue: 'Tax Amount' })}</th>
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
                    {t('integrations.csv.taxImport.preview.showingFirst20', { defaultValue: 'Showing first 20 of {{count}} rows', count: previewResult.preview.length })}
                  </div>
                )}
              </div>
            )}

            {/* Unmatched reasons */}
            {previewResult.preview.filter(p => p.status === 'unmatched' && p.reason).length > 0 && (
              <div className="text-sm">
                <h5 className="font-medium text-red-600 mb-2">{t('integrations.csv.taxImport.preview.errorsTitle', { defaultValue: 'Errors ({{count}})', count: previewResult.unmatchedCount })}</h5>
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
              {importResult.successCount === 1
                ? t('integrations.csv.taxImport.result.one', { defaultValue: 'Imported tax for {{count}} invoice. Total tax imported: {{amount}}.', count: importResult.successCount, amount: formatCurrency(importResult.totalTaxImported) })
                : t('integrations.csv.taxImport.result.other', { defaultValue: 'Imported tax for {{count}} invoices. Total tax imported: {{amount}}.', count: importResult.successCount, amount: formatCurrency(importResult.totalTaxImported) })}
              {importResult.failureCount > 0 && ` ${t('integrations.csv.taxImport.result.failed', { defaultValue: '{{count}} failed.', count: importResult.failureCount })}`}
              {importResult.skippedCount > 0 && ` ${t('integrations.csv.taxImport.result.skipped', { defaultValue: '{{count}} skipped.', count: importResult.skippedCount })}`}
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
                {t('integrations.csv.taxImport.actions.validating', { defaultValue: 'Validating...' })}
              </>
            ) : (
              t('integrations.csv.taxImport.actions.validate', { defaultValue: 'Validate' })
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
