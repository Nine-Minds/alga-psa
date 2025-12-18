'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Alert, AlertDescription } from '../../ui/Alert';
import { Badge } from '../../ui/Badge';
import { Download, FileSpreadsheet, CheckCircle, Info, ExternalLink } from 'lucide-react';
import { formatDate } from 'server/src/lib/utils/formatters';
import type { AccountingExportBatch } from 'server/src/interfaces/accountingExport.interfaces';

interface XeroCsvExportPanelProps {
  /** The export batch to display download options for */
  batch: AccountingExportBatch;
  /** Callback when download is initiated */
  onDownload?: () => void;
}

/**
 * Panel component for downloading Xero CSV exports and displaying import instructions.
 * Shows when a batch has adapter_type='xero_csv' and status='delivered'.
 */
const XeroCsvExportPanel: React.FC<XeroCsvExportPanelProps> = ({ batch, onDownload }) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const handleDownload = async () => {
    setIsDownloading(true);
    setDownloadError(null);
    setDownloadSuccess(false);

    try {
      const response = await fetch(`/api/v1/accounting-exports/${batch.batch_id}/download`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error ?? `Download failed with status ${response.status}`);
      }

      // Get filename from Content-Disposition header or generate one
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `xero-invoice-export-${batch.batch_id}.csv`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match) {
          filename = match[1];
        }
      }

      // Create blob and trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setDownloadSuccess(true);
      onDownload?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to download CSV';
      setDownloadError(message);
    } finally {
      setIsDownloading(false);
    }
  };

  const isDownloadable = batch.status === 'delivered' || batch.status === 'posted';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Xero CSV Export</CardTitle>
          </div>
          <Badge variant={batch.status === 'delivered' ? 'success' : 'primary'}>
            {batch.status}
          </Badge>
        </div>
        <CardDescription>
          Download the CSV file and import it into Xero.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {downloadError && (
          <Alert variant="destructive">
            <AlertDescription>{downloadError}</AlertDescription>
          </Alert>
        )}

        {downloadSuccess && (
          <Alert variant="success">
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              CSV file downloaded successfully. Follow the instructions below to import into Xero.
            </AlertDescription>
          </Alert>
        )}

        {/* Batch Info */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Batch ID</p>
            <p className="font-mono text-xs">{batch.batch_id}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Created</p>
            <p>{formatDate(batch.created_at)}</p>
          </div>
          {batch.delivered_at && (
            <div>
              <p className="text-muted-foreground">Exported</p>
              <p>{formatDate(batch.delivered_at)}</p>
            </div>
          )}
          {batch.target_realm && (
            <div>
              <p className="text-muted-foreground">Target Realm</p>
              <p>{batch.target_realm}</p>
            </div>
          )}
        </div>

        {/* Download Button */}
        <div className="pt-2">
          <Button
            id="xero-csv-export-download-button"
            onClick={handleDownload}
            disabled={!isDownloadable || isDownloading}
            className="w-full sm:w-auto"
          >
            <Download className="mr-2 h-4 w-4" />
            {isDownloading ? 'Downloading...' : 'Download CSV File'}
          </Button>
        </div>

        {/* Import Instructions */}
        <div className="rounded-lg border bg-muted/50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-blue-500" />
            <p className="font-medium text-sm">Import Instructions</p>
          </div>
          <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-2">
            <li>Download the CSV file using the button above</li>
            <li>
              In Xero, go to <strong>Business &rarr; Invoices &rarr; Import</strong>
            </li>
            <li>Upload the CSV file</li>
            <li>
              Review the import preview and import as <strong>Draft</strong> invoices
            </li>
            <li>Xero will calculate tax based on your organisation&apos;s tax settings</li>
          </ol>
          <div className="pt-2">
            <a
              href="https://central.xero.com/s/article/Import-or-export-sales-invoices"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline inline-flex items-center gap-1"
            >
              Xero Import Guide
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        {/* Tax Import Reminder */}
        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
          <div className="flex gap-3">
            <FileSpreadsheet className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-foreground">Import Tax Back to Alga</p>
              <p className="text-muted-foreground mt-1">
                After Xero calculates tax on the imported invoices, you can export the Invoice Details
                Report from Xero and upload it to Alga to import the tax amounts back. This is
                particularly useful if you&apos;ve configured external tax calculation.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default XeroCsvExportPanel;
