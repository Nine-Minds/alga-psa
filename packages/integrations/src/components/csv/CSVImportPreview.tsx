'use client';

import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, FileText } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ValidationError {
  rowNumber?: number;
  field: string;
  message: string;
  value?: string;
}

interface ValidationResult {
  valid: boolean;
  structureValid: boolean;
  rowsValid: boolean;
  databaseValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
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
  summary: {
    totalInvoices: number;
    successfulUpdates: number;
    failedUpdates: number;
    totalOriginalTax: number;
    totalImportedTax: number;
    totalDifference: number;
  };
}

interface CSVImportPreviewProps {
  validation: ValidationResult;
  importResult?: ImportResult | null;
}

export function CSVImportPreview({ validation, importResult }: CSVImportPreviewProps) {
  const { t } = useTranslation();
  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(cents / 100);
  };

  return (
    <div className="space-y-4 border rounded-lg p-4 bg-muted/50">
      {/* Header */}
      <div className="flex items-center gap-2">
        <FileText className="h-5 w-5 text-muted-foreground" />
        <h4 className="font-medium">
          {importResult
            ? t('integrations.csv.preview.importResults', { defaultValue: 'Import Results' })
            : t('integrations.csv.preview.validationResults', { defaultValue: 'Validation Results' })}
        </h4>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card p-3 rounded-lg border">
          <div className="text-2xl font-bold">{validation.stats.totalRows}</div>
          <div className="text-sm text-muted-foreground">{t('integrations.csv.preview.stats.totalRows', { defaultValue: 'Total Rows' })}</div>
        </div>
        <div className="bg-card p-3 rounded-lg border">
          <div className="text-2xl font-bold text-green-600">{validation.stats.validRows}</div>
          <div className="text-sm text-muted-foreground">{t('integrations.csv.preview.stats.validRows', { defaultValue: 'Valid Rows' })}</div>
        </div>
        <div className="bg-card p-3 rounded-lg border">
          <div className="text-2xl font-bold text-blue-600">{validation.stats.matchedInvoices}</div>
          <div className="text-sm text-muted-foreground">{t('integrations.csv.preview.stats.matchedInvoices', { defaultValue: 'Matched Invoices' })}</div>
        </div>
        <div className="bg-card p-3 rounded-lg border">
          <div className="text-2xl font-bold">{validation.stats.uniqueInvoices}</div>
          <div className="text-sm text-muted-foreground">{t('integrations.csv.preview.stats.uniqueInvoices', { defaultValue: 'Unique Invoices' })}</div>
        </div>
      </div>

      {/* Import Summary (if available) */}
      {importResult && (
        <div className="bg-card p-4 rounded-lg border space-y-2">
          <h5 className="font-medium">{t('integrations.csv.preview.importSummary.title', { defaultValue: 'Import Summary' })}</h5>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">{t('integrations.csv.preview.importSummary.successfulUpdates', { defaultValue: 'Successful Updates:' })}</span>{' '}
              <span className="font-medium text-green-600">{importResult.summary.successfulUpdates}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t('integrations.csv.preview.importSummary.failedUpdates', { defaultValue: 'Failed Updates:' })}</span>{' '}
              <span className="font-medium text-red-600">{importResult.summary.failedUpdates}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t('integrations.csv.preview.importSummary.originalTax', { defaultValue: 'Original Tax:' })}</span>{' '}
              <span className="font-medium">{formatCurrency(importResult.summary.totalOriginalTax)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t('integrations.csv.preview.importSummary.importedTax', { defaultValue: 'Imported Tax:' })}</span>{' '}
              <span className="font-medium">{formatCurrency(importResult.summary.totalImportedTax)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t('integrations.csv.preview.importSummary.difference', { defaultValue: 'Difference:' })}</span>{' '}
              <span className={`font-medium ${importResult.summary.totalDifference > 0 ? 'text-green-600' : importResult.summary.totalDifference < 0 ? 'text-red-600' : ''}`}>
                {importResult.summary.totalDifference >= 0 ? '+' : ''}{formatCurrency(importResult.summary.totalDifference)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Validation Status Indicators */}
      <div className="flex flex-wrap gap-4">
        <StatusBadge
          label={t('integrations.csv.preview.status.structure', { defaultValue: 'Structure' })}
          valid={validation.structureValid}
        />
        <StatusBadge
          label={t('integrations.csv.preview.status.rowData', { defaultValue: 'Row Data' })}
          valid={validation.rowsValid}
        />
        <StatusBadge
          label={t('integrations.csv.preview.status.databaseMatch', { defaultValue: 'Database Match' })}
          valid={validation.databaseValid}
        />
      </div>

      {/* Errors */}
      {validation.errors.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-red-600">
            <XCircle className="h-4 w-4" />
            <span className="font-medium">{t('integrations.csv.preview.errors.title', { defaultValue: 'Errors ({{count}})', count: validation.errors.length })}</span>
          </div>
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg divide-y divide-destructive/20 max-h-48 overflow-y-auto">
            {validation.errors.slice(0, 10).map((error, index) => (
              <div key={index} className="p-2 text-sm">
                {error.rowNumber && (
                  <span className="text-destructive font-mono mr-2">{t('integrations.csv.preview.rowLabel', { defaultValue: 'Row {{row}}:', row: error.rowNumber })}</span>
                )}
                <span className="text-destructive">{error.message}</span>
              </div>
            ))}
            {validation.errors.length > 10 && (
              <div className="p-2 text-sm text-destructive">
                {t('integrations.csv.preview.errors.more', { defaultValue: '... and {{count}} more errors', count: validation.errors.length - 10 })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Warnings */}
      {validation.warnings.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-yellow-600">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">{t('integrations.csv.preview.warnings.title', { defaultValue: 'Warnings ({{count}})', count: validation.warnings.length })}</span>
          </div>
          <div className="bg-warning/10 border border-warning/30 rounded-lg divide-y divide-warning/20 max-h-48 overflow-y-auto">
            {validation.warnings.slice(0, 10).map((warning, index) => (
              <div key={index} className="p-2 text-sm">
                {warning.rowNumber && (
                  <span className="text-warning font-mono mr-2">{t('integrations.csv.preview.rowLabel', { defaultValue: 'Row {{row}}:', row: warning.rowNumber })}</span>
                )}
                <span className="text-warning">{warning.message}</span>
              </div>
            ))}
            {validation.warnings.length > 10 && (
              <div className="p-2 text-sm text-warning">
                {t('integrations.csv.preview.warnings.more', { defaultValue: '... and {{count}} more warnings', count: validation.warnings.length - 10 })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Duplicate Invoices */}
      {validation.stats.duplicateInvoices.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-blue-600">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">{t('integrations.csv.preview.duplicates.title', { defaultValue: 'Duplicate Invoices ({{count}})', count: validation.stats.duplicateInvoices.length })}</span>
          </div>
          <Alert variant="info">
            <AlertDescription>
              <p className="mb-2">
                {t('integrations.csv.preview.duplicates.description', { defaultValue: 'The following invoices appear multiple times. Their tax amounts will be summed:' })}
              </p>
              <div className="flex flex-wrap gap-2">
                {validation.stats.duplicateInvoices.map((invoiceNo) => (
                  <Badge key={invoiceNo} variant="info" className="font-mono">
                    {invoiceNo}
                  </Badge>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Success Message (when validation passes) */}
      {validation.valid && !importResult && (
        <Alert variant="success">
          <AlertDescription>
            {validation.stats.matchedInvoices === 1
              ? t('integrations.csv.preview.validationPassed.one', { defaultValue: 'Validation passed. Ready to import tax data for {{count}} invoice.', count: validation.stats.matchedInvoices })
              : t('integrations.csv.preview.validationPassed.other', { defaultValue: 'Validation passed. Ready to import tax data for {{count}} invoices.', count: validation.stats.matchedInvoices })}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function StatusBadge({ label, valid }: { label: string; valid: boolean }) {
  return (
    <Badge variant={valid ? 'success' : 'error'} className="flex items-center gap-1.5 px-3 py-1.5">
      {valid ? (
        <CheckCircle2 className="h-4 w-4" />
      ) : (
        <XCircle className="h-4 w-4" />
      )}
      {label}
    </Badge>
  );
}
