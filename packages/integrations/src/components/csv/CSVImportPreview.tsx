'use client';

import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, FileText } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';

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
          {importResult ? 'Import Results' : 'Validation Results'}
        </h4>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card p-3 rounded-lg border">
          <div className="text-2xl font-bold">{validation.stats.totalRows}</div>
          <div className="text-sm text-muted-foreground">Total Rows</div>
        </div>
        <div className="bg-card p-3 rounded-lg border">
          <div className="text-2xl font-bold text-green-600">{validation.stats.validRows}</div>
          <div className="text-sm text-muted-foreground">Valid Rows</div>
        </div>
        <div className="bg-card p-3 rounded-lg border">
          <div className="text-2xl font-bold text-blue-600">{validation.stats.matchedInvoices}</div>
          <div className="text-sm text-muted-foreground">Matched Invoices</div>
        </div>
        <div className="bg-card p-3 rounded-lg border">
          <div className="text-2xl font-bold">{validation.stats.uniqueInvoices}</div>
          <div className="text-sm text-muted-foreground">Unique Invoices</div>
        </div>
      </div>

      {/* Import Summary (if available) */}
      {importResult && (
        <div className="bg-card p-4 rounded-lg border space-y-2">
          <h5 className="font-medium">Import Summary</h5>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Successful Updates:</span>{' '}
              <span className="font-medium text-green-600">{importResult.summary.successfulUpdates}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Failed Updates:</span>{' '}
              <span className="font-medium text-red-600">{importResult.summary.failedUpdates}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Original Tax:</span>{' '}
              <span className="font-medium">{formatCurrency(importResult.summary.totalOriginalTax)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Imported Tax:</span>{' '}
              <span className="font-medium">{formatCurrency(importResult.summary.totalImportedTax)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Difference:</span>{' '}
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
          label="Structure"
          valid={validation.structureValid}
        />
        <StatusBadge
          label="Row Data"
          valid={validation.rowsValid}
        />
        <StatusBadge
          label="Database Match"
          valid={validation.databaseValid}
        />
      </div>

      {/* Errors */}
      {validation.errors.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-red-600">
            <XCircle className="h-4 w-4" />
            <span className="font-medium">Errors ({validation.errors.length})</span>
          </div>
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg divide-y divide-destructive/20 max-h-48 overflow-y-auto">
            {validation.errors.slice(0, 10).map((error, index) => (
              <div key={index} className="p-2 text-sm">
                {error.rowNumber && (
                  <span className="text-destructive font-mono mr-2">Row {error.rowNumber}:</span>
                )}
                <span className="text-destructive">{error.message}</span>
              </div>
            ))}
            {validation.errors.length > 10 && (
              <div className="p-2 text-sm text-destructive">
                ... and {validation.errors.length - 10} more errors
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
            <span className="font-medium">Warnings ({validation.warnings.length})</span>
          </div>
          <div className="bg-warning/10 border border-warning/30 rounded-lg divide-y divide-warning/20 max-h-48 overflow-y-auto">
            {validation.warnings.slice(0, 10).map((warning, index) => (
              <div key={index} className="p-2 text-sm">
                {warning.rowNumber && (
                  <span className="text-warning font-mono mr-2">Row {warning.rowNumber}:</span>
                )}
                <span className="text-warning">{warning.message}</span>
              </div>
            ))}
            {validation.warnings.length > 10 && (
              <div className="p-2 text-sm text-warning">
                ... and {validation.warnings.length - 10} more warnings
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
            <span className="font-medium">Duplicate Invoices ({validation.stats.duplicateInvoices.length})</span>
          </div>
          <Alert variant="info">
            <AlertDescription>
              <p className="mb-2">
                The following invoices appear multiple times. Their tax amounts will be summed:
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
            Validation passed. Ready to import tax data for {validation.stats.matchedInvoices} invoice
            {validation.stats.matchedInvoices !== 1 ? 's' : ''}.
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
