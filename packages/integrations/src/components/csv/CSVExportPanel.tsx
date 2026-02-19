'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { StringDateRangePicker } from '@alga-psa/ui/components/DateRangePicker';
import { Label } from '@alga-psa/ui/components/Label';
import { Download, FileText, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import {
  INVOICE_STATUS_METADATA,
  INVOICE_STATUS_DISPLAY_ORDER,
  DEFAULT_ACCOUNTING_EXPORT_STATUSES,
  type InvoiceStatus
} from '@alga-psa/types';

interface ExportFilters {
  startDate?: string;
  endDate?: string;
  invoiceStatuses?: string[];
}

interface CSVExportPanelProps {
  onExportComplete?: (result: { filename: string; invoiceCount: number }) => void;
}

type ExportErrorDetail = {
  code: string;
  message: string;
  line_id?: string | null;
  metadata?: Record<string, any> | null;
};

// Build status options from the canonical invoice status metadata
const INVOICE_STATUS_OPTIONS = INVOICE_STATUS_DISPLAY_ORDER.map((status) => ({
  value: status,
  label: INVOICE_STATUS_METADATA[status].label
}));

export function CSVExportPanel({ onExportComplete }: CSVExportPanelProps) {
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({
    from: '',
    to: ''
  });
  const [selectedStatuses, setSelectedStatuses] = useState<InvoiceStatus[]>(DEFAULT_ACCOUNTING_EXPORT_STATUSES);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportErrors, setExportErrors] = useState<ExportErrorDetail[] | null>(null);
  const [success, setSuccess] = useState<{ filename: string; invoiceCount: number } | null>(null);

  const summarizedErrors = useMemo(() => {
    if (!exportErrors) {
      return [];
    }
    const seen = new Set<string>();
    const unique: ExportErrorDetail[] = [];
    for (const item of exportErrors) {
      const key =
        `${item.code}:` +
        (item.metadata?.service_id ||
          item.metadata?.tax_region_id ||
          item.metadata?.payment_term_id ||
          item.message);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(item);
    }
    return unique.slice(0, 8);
  }, [exportErrors]);

  const handleStatusToggle = useCallback((status: InvoiceStatus) => {
    setSelectedStatuses((prev) =>
      prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status]
    );
  }, []);

  const handleExport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setExportErrors(null);
    setSuccess(null);

    try {
      const filters: ExportFilters = {};

      if (dateRange.from) {
        filters.startDate = dateRange.from;
      }
      if (dateRange.to) {
        filters.endDate = dateRange.to;
      }
      if (selectedStatuses.length > 0) {
        filters.invoiceStatuses = selectedStatuses;
      }

      const response = await fetch('/api/accounting/csv/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ filters })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const message =
          (data && typeof data.message === 'string' && data.message) ||
          (data && typeof data.error?.message === 'string' && data.error.message) ||
          'Export failed';
        const errors = data && Array.isArray(data.errors) ? (data.errors as ExportErrorDetail[]) : null;
        setError(message);
        setExportErrors(errors);
        return;
      }

      // Get metadata from headers
      const invoiceCount = parseInt(response.headers.get('X-Invoice-Count') || '0', 10);
      const contentDisposition = response.headers.get('Content-Disposition') || '';
      const filenameMatch = contentDisposition.match(/filename="(.+?)"/);
      const filename = filenameMatch ? filenameMatch[1] : 'quickbooks-invoices.csv';

      // Download the file
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccess({ filename, invoiceCount });
      onExportComplete?.({ filename, invoiceCount });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsLoading(false);
    }
  }, [dateRange, selectedStatuses, onExportComplete]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          CSV Export for QuickBooks
        </CardTitle>
        <CardDescription>
          Export invoices as a CSV file for manual import into QuickBooks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Date Range */}
        <div>
          <StringDateRangePicker
            id="csv-export-date-range"
            label="Date Range (optional)"
            value={dateRange}
            onChange={setDateRange}
          />
        </div>

        {/* Invoice Statuses */}
        <div className="space-y-2">
          <Label>Invoice Statuses</Label>
          <div className="flex flex-wrap gap-2">
            {INVOICE_STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleStatusToggle(option.value)}
                className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                  selectedStatuses.includes(option.value)
                    ? 'bg-primary/10 border-primary text-primary'
                    : 'bg-card border-border text-foreground hover:bg-muted/50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              <div>{error}</div>
              {summarizedErrors.length > 0 && (
                <ul className="mt-2 ml-2 list-disc space-y-1 text-sm">
                  {summarizedErrors.map((item, index) => {
                    const serviceName = item.metadata?.service_name as string | undefined;
                    const serviceId = item.metadata?.service_id as string | undefined;
                    const label =
                      item.code === 'missing_service_mapping'
                        ? `Missing item mapping${serviceName ? `: ${serviceName}` : ''}${!serviceName && serviceId ? ` (${serviceId})` : ''}`
                        : item.message;
                    return <li key={`${item.code}-${index}`}>{label}</li>;
                  })}
                </ul>
              )}
              <div className="mt-2 ml-2 text-sm opacity-80">
                Configure missing mappings above, then retry the export.
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Success Message */}
        {success && (
          <Alert variant="success">
            <AlertDescription>
              Exported {success.invoiceCount} invoice{success.invoiceCount !== 1 ? 's' : ''} to{' '}
              <strong>{success.filename}</strong>
            </AlertDescription>
          </Alert>
        )}

        {/* Export Button */}
        <div className="flex justify-end">
          <Button
            id="csv-export-button"
            onClick={handleExport}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span className="animate-spin mr-2">⏳</span>
                Generating...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
