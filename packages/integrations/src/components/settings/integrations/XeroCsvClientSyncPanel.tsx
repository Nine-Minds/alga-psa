'use client';

import React, { useState, useRef, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Users, Download, Upload, AlertCircle, CheckCircle2, FileUp } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import {
  exportClientsToXeroCsv,
  previewXeroCsvClientImport,
  executeXeroCsvClientImport
} from '../../../actions/integrations/xeroCsvActions';
import type { ClientImportPreviewResult, ClientImportResult } from '../../../services/xeroCsvClientSyncService';

type ImportStep = 'idle' | 'uploading' | 'preview' | 'importing' | 'complete';

interface ImportOptions {
  createNewClients: boolean;
  updateExistingClients: boolean;
  matchBy: 'name' | 'email' | 'xero_id';
}

const DEFAULT_OPTIONS: ImportOptions = {
  createNewClients: true,
  updateExistingClients: true,
  matchBy: 'name'
};

/**
 * Xero CSV Client Sync Panel
 *
 * Provides UI for exporting Alga clients to Xero Contacts CSV format
 * and importing Xero Contacts CSV back into Alga.
 */
export function XeroCsvClientSyncPanel() {
  const [isExporting, startExport] = useTransition();
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  const [importStep, setImportStep] = useState<ImportStep>('idle');
  const [importError, setImportError] = useState<string | null>(null);
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [csvFilename, setCsvFilename] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<ClientImportPreviewResult | null>(null);
  const [importResult, setImportResult] = useState<ClientImportResult | null>(null);
  const [importOptions, setImportOptions] = useState<ImportOptions>(DEFAULT_OPTIONS);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportClients = () => {
    startExport(async () => {
      setExportError(null);
      setExportSuccess(null);

      try {
        const result = await exportClientsToXeroCsv();

        // Create download
        const blob = new Blob([result.csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setExportSuccess(`Exported ${result.clientCount} clients to ${result.filename}`);
        setTimeout(() => setExportSuccess(null), 5000);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to export clients';
        setExportError(message);
      }
    });
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportError(null);
    setImportStep('uploading');
    setCsvFilename(file.name);

    try {
      const content = await file.text();
      setCsvContent(content);

      // Generate preview
      const preview = await previewXeroCsvClientImport(content, importOptions);
      setPreviewResult(preview);
      setImportStep('preview');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to process CSV file';
      setImportError(message);
      setImportStep('idle');
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleExecuteImport = async () => {
    if (!csvContent) return;

    setImportError(null);
    setImportStep('importing');

    try {
      const result = await executeXeroCsvClientImport(csvContent, importOptions);
      setImportResult(result);
      setImportStep('complete');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import clients';
      setImportError(message);
      setImportStep('preview');
    }
  };

  const handleCancelImport = () => {
    setImportStep('idle');
    setCsvContent(null);
    setCsvFilename(null);
    setPreviewResult(null);
    setImportResult(null);
    setImportError(null);
  };

  const handleStartNewImport = () => {
    handleCancelImport();
  };

  return (
    <Card id="xero-csv-client-sync-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Client Sync
        </CardTitle>
        <CardDescription>
          Export clients to Xero Contacts CSV or import contacts from Xero.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Export Section */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-foreground">Export Clients</h4>
          <p className="text-sm text-muted-foreground">
            Export your Alga clients to a CSV file that can be imported into Xero as Contacts.
          </p>

          {exportError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{exportError}</AlertDescription>
            </Alert>
          )}

          {exportSuccess && (
            <Alert variant="success">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>{exportSuccess}</AlertDescription>
            </Alert>
          )}

          <Button
            id="xero-csv-client-sync-export-button"
            onClick={handleExportClients}
            disabled={isExporting}
            variant="outline"
            className="gap-2"
          >
            {isExporting ? (
              <LoadingIndicator spinnerProps={{ size: 'sm' }} />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export Clients to CSV
          </Button>
        </div>

        <div className="border-t border-border" />

        {/* Import Section */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium text-foreground">Import Contacts</h4>
          <p className="text-sm text-muted-foreground">
            Import contacts from a Xero Contacts CSV export. Existing clients can be matched and updated.
          </p>

          {importError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{importError}</AlertDescription>
            </Alert>
          )}

          {/* Import Options */}
          {importStep === 'idle' && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Checkbox
                  id="update-existing"
                  checked={importOptions.updateExistingClients}
                  onChange={(e) =>
                    setImportOptions((prev) => ({
                      ...prev,
                      updateExistingClients: e.target.checked
                    }))
                  }
                  label="Update existing clients"
                  containerClassName="mb-0"
                />
                <Checkbox
                  id="create-new"
                  checked={importOptions.createNewClients}
                  onChange={(e) =>
                    setImportOptions((prev) => ({
                      ...prev,
                      createNewClients: e.target.checked
                    }))
                  }
                  label="Create new clients"
                  containerClassName="mb-0"
                />
              </div>

              <div>
                <label htmlFor="match-by" className="text-sm text-muted-foreground block mb-1">
                  Match contacts by:
                </label>
                <select
                  id="match-by"
                  value={importOptions.matchBy}
                  onChange={(e) =>
                    setImportOptions((prev) => ({
                      ...prev,
                      matchBy: e.target.value as 'name' | 'email' | 'xero_id'
                    }))
                  }
                  className="w-full max-w-xs rounded-md border px-3 py-2 text-sm"
                >
                  <option value="name">Contact Name</option>
                  <option value="email">Email Address</option>
                  <option value="xero_id">Alga Client ID (from tracking category)</option>
                </select>
              </div>

              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="xero-contacts-csv-input"
                />
                <Button
                  id="xero-csv-client-sync-select-file-button"
                  onClick={() => fileInputRef.current?.click()}
                  variant="outline"
                  className="gap-2"
                >
                  <Upload className="h-4 w-4" />
                  Select CSV File
                </Button>
              </div>
            </div>
          )}

          {/* Uploading State */}
          {importStep === 'uploading' && (
            <div className="flex items-center gap-3 p-4 bg-muted/40 rounded-lg">
              <LoadingIndicator spinnerProps={{ size: 'sm' }} />
              <span className="text-sm text-muted-foreground">
                Processing {csvFilename}...
              </span>
            </div>
          )}

          {/* Preview State */}
          {importStep === 'preview' && previewResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-muted/40 rounded-lg">
                <FileUp className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm font-medium">{csvFilename}</span>
              </div>

              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-3 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-700">{previewResult.toUpdate}</div>
                  <div className="text-xs text-green-600">To Update</div>
                </div>
                <div className="p-3 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-700">{previewResult.toCreate}</div>
                  <div className="text-xs text-blue-600">To Create</div>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <div className="text-2xl font-bold text-gray-700">{previewResult.toSkip}</div>
                  <div className="text-xs text-gray-600">To Skip</div>
                </div>
              </div>

              {previewResult.warnings.length > 0 && (
                <Alert variant="warning">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Warnings</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4 mt-1 text-sm">
                      {previewResult.warnings.slice(0, 5).map((warning, i) => (
                        <li key={i}>{warning}</li>
                      ))}
                      {previewResult.warnings.length > 5 && (
                        <li>...and {previewResult.warnings.length - 5} more</li>
                      )}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* Preview Table */}
              {previewResult.rows.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Contact Name</th>
                          <th className="px-3 py-2 text-left font-medium">Email</th>
                          <th className="px-3 py-2 text-left font-medium">Action</th>
                          <th className="px-3 py-2 text-left font-medium">Matched Client</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {previewResult.rows.slice(0, 20).map((row) => (
                          <tr key={row.rowIndex} className="hover:bg-muted/30">
                            <td className="px-3 py-2">{row.contactName}</td>
                            <td className="px-3 py-2 text-muted-foreground">{row.email || '-'}</td>
                            <td className="px-3 py-2">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                  row.action === 'create'
                                    ? 'bg-blue-100 text-blue-700'
                                    : row.action === 'update'
                                      ? 'bg-green-100 text-green-700'
                                      : 'bg-gray-100 text-gray-700'
                                }`}
                              >
                                {row.action}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {row.matchedClientName || row.skipReason || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {previewResult.rows.length > 20 && (
                    <div className="px-3 py-2 bg-muted/30 text-xs text-muted-foreground text-center">
                      Showing 20 of {previewResult.rows.length} rows
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <Button id="xero-csv-client-sync-execute-import-button" onClick={handleExecuteImport} disabled={previewResult.toUpdate + previewResult.toCreate === 0}>
                  Import {previewResult.toUpdate + previewResult.toCreate} Contacts
                </Button>
                <Button id="xero-csv-client-sync-cancel-import-button" variant="outline" onClick={handleCancelImport}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Importing State */}
          {importStep === 'importing' && (
            <div className="flex items-center gap-3 p-4 bg-muted/40 rounded-lg">
              <LoadingIndicator spinnerProps={{ size: 'sm' }} />
              <span className="text-sm text-muted-foreground">Importing contacts...</span>
            </div>
          )}

          {/* Complete State */}
          {importStep === 'complete' && importResult && (
            <div className="space-y-4">
              <Alert variant="success">
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Import Complete</AlertTitle>
                <AlertDescription>
                  Successfully processed {importResult.totalProcessed} contacts.
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-4 gap-3 text-center">
                <div className="p-3 bg-green-50 rounded-lg">
                  <div className="text-xl font-bold text-green-700">{importResult.updated}</div>
                  <div className="text-xs text-green-600">Updated</div>
                </div>
                <div className="p-3 bg-blue-50 rounded-lg">
                  <div className="text-xl font-bold text-blue-700">{importResult.created}</div>
                  <div className="text-xs text-blue-600">Created</div>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <div className="text-xl font-bold text-gray-700">{importResult.skipped}</div>
                  <div className="text-xs text-gray-600">Skipped</div>
                </div>
                <div className="p-3 bg-purple-50 rounded-lg">
                  <div className="text-xl font-bold text-purple-700">{importResult.mappingsCreated}</div>
                  <div className="text-xs text-purple-600">Mappings</div>
                </div>
              </div>

              {importResult.errors.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Errors ({importResult.errors.length})</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4 mt-1 text-sm">
                      {importResult.errors.slice(0, 5).map((err, i) => (
                        <li key={i}>
                          Row {err.rowIndex}: {err.contactName} - {err.error}
                        </li>
                      ))}
                      {importResult.errors.length > 5 && (
                        <li>...and {importResult.errors.length - 5} more errors</li>
                      )}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <Button id="xero-csv-client-sync-start-new-import-button" variant="outline" onClick={handleStartNewImport}>
                Start New Import
              </Button>
            </div>
          )}
        </div>

        {/* Workflow Guide */}
        <div className="border-t border-border pt-4">
          <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
            <h5 className="text-sm font-medium text-foreground mb-2">Client Sync Workflow</h5>
            <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
              <li>Export clients from Alga to Xero Contacts CSV</li>
              <li>Import the CSV into Xero (Contacts → Import)</li>
              <li>After changes in Xero, export contacts from Xero</li>
              <li>Import the Xero contacts CSV back into Alga to sync updates</li>
            </ol>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default XeroCsvClientSyncPanel;
