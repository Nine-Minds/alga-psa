'use client';

import React, { useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { StringDateRangePicker } from '../../ui/DateRangePicker';
import { Label } from '../../ui/Label';
import { Download, FileText, AlertCircle, CheckCircle2 } from 'lucide-react';

interface ExportFilters {
  startDate?: string;
  endDate?: string;
  invoiceStatuses?: string[];
}

interface CSVExportPanelProps {
  onExportComplete?: (result: { filename: string; invoiceCount: number }) => void;
}

const INVOICE_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'sent', label: 'Sent' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'partial', label: 'Partially Paid' }
];

export function CSVExportPanel({ onExportComplete }: CSVExportPanelProps) {
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({
    from: '',
    to: ''
  });
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['approved', 'sent']);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ filename: string; invoiceCount: number } | null>(null);

  const handleStatusToggle = useCallback((status: string) => {
    setSelectedStatuses((prev) =>
      prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status]
    );
  }, []);

  const handleExport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
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
        const data = await response.json();
        throw new Error(data.message || 'Export failed');
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
                    ? 'bg-primary-100 border-primary-500 text-primary-700'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Success Message */}
        {success && (
          <div className="flex items-center gap-2 p-3 bg-green-50 text-green-700 rounded-lg">
            <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
            <span>
              Exported {success.invoiceCount} invoice{success.invoiceCount !== 1 ? 's' : ''} to{' '}
              <strong>{success.filename}</strong>
            </span>
          </div>
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
