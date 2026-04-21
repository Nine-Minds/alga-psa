'use client';

import React, { useState, useRef, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Users, Download, Upload, AlertCircle, CheckCircle2, FileUp } from 'lucide-react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import {
  exportClientsToXeroCsv,
  previewXeroCsvClientImport,
  executeXeroCsvClientImport
} from '@alga-psa/integrations/actions';
import type { ClientImportPreviewResult, ClientImportResult } from '../../../services/xeroCsvClientSyncService';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  const { t } = useTranslation('msp/integrations');
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

        setExportSuccess(t('integrations.xero.csv.clientSync.exportSuccess', { defaultValue: 'Exported {{count}} clients to {{filename}}', count: result.clientCount, filename: result.filename }));
        setTimeout(() => setExportSuccess(null), 5000);
      } catch (err) {
        const message = t('integrations.xero.csv.clientSync.errors.export', { defaultValue: 'Failed to export clients' });
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
      const message = t('integrations.xero.csv.clientSync.errors.processCsv', { defaultValue: 'Failed to process CSV file' });
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
      const message = t('integrations.xero.csv.clientSync.errors.import', { defaultValue: 'Failed to import clients' });
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
          {t('integrations.xero.csv.clientSync.title', { defaultValue: 'Client Sync' })}
        </CardTitle>
        <CardDescription>
          {t('integrations.xero.csv.clientSync.description', { defaultValue: 'Export clients to Xero Contacts CSV or import contacts from Xero.' })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Export Section */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-foreground">{t('integrations.xero.csv.clientSync.exportClients', { defaultValue: 'Export Clients' })}</h4>
          <p className="text-sm text-muted-foreground">
            {t('integrations.xero.csv.clientSync.exportDescription', { defaultValue: 'Export your Alga clients to a CSV file that can be imported into Xero as Contacts.' })}
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
            {t('integrations.xero.csv.clientSync.exportButton', { defaultValue: 'Export Clients to CSV' })}
          </Button>
        </div>

        <div className="border-t border-border" />

        {/* Import Section */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium text-foreground">{t('integrations.xero.csv.clientSync.importContacts', { defaultValue: 'Import Contacts' })}</h4>
          <p className="text-sm text-muted-foreground">
            {t('integrations.xero.csv.clientSync.importDescription', { defaultValue: 'Import contacts from a Xero Contacts CSV export. Existing clients can be matched and updated.' })}
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
                  label={t('integrations.xero.csv.clientSync.updateExisting', { defaultValue: 'Update existing clients' })}
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
                  label={t('integrations.xero.csv.clientSync.createNew', { defaultValue: 'Create new clients' })}
                  containerClassName="mb-0"
                />
              </div>

              <div>
                <label htmlFor="match-by" className="text-sm text-muted-foreground block mb-1">
                  {t('integrations.xero.csv.clientSync.matchByLabel', { defaultValue: 'Match contacts by:' })}
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
                  <option value="name">{t('integrations.xero.csv.clientSync.matchBy.contactName', { defaultValue: 'Contact Name' })}</option>
                  <option value="email">{t('integrations.xero.csv.clientSync.matchBy.emailAddress', { defaultValue: 'Email Address' })}</option>
                  <option value="xero_id">{t('integrations.xero.csv.clientSync.matchBy.algaClientId', { defaultValue: 'Alga Client ID (from tracking category)' })}</option>
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
                  {t('integrations.xero.csv.clientSync.selectCsvFile', { defaultValue: 'Select CSV File' })}
                </Button>
              </div>
            </div>
          )}

          {/* Uploading State */}
          {importStep === 'uploading' && (
            <div className="flex items-center gap-3 p-4 bg-muted/40 rounded-lg">
              <LoadingIndicator spinnerProps={{ size: 'sm' }} />
              <span className="text-sm text-muted-foreground">
                {t('integrations.xero.csv.clientSync.processing', { defaultValue: 'Processing {{filename}}...', filename: csvFilename ?? '' })}
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
                <div className="p-3 bg-success/10 rounded-lg">
                  <div className="text-2xl font-bold text-success">{previewResult.toUpdate}</div>
                  <div className="text-xs text-success/80">{t('integrations.xero.csv.clientSync.preview.toUpdate', { defaultValue: 'To Update' })}</div>
                </div>
                <div className="p-3 bg-primary/10 rounded-lg">
                  <div className="text-2xl font-bold text-primary">{previewResult.toCreate}</div>
                  <div className="text-xs text-primary/80">{t('integrations.xero.csv.clientSync.preview.toCreate', { defaultValue: 'To Create' })}</div>
                </div>
                <div className="p-3 bg-muted rounded-lg">
                  <div className="text-2xl font-bold text-muted-foreground">{previewResult.toSkip}</div>
                  <div className="text-xs text-muted-foreground">{t('integrations.xero.csv.clientSync.preview.toSkip', { defaultValue: 'To Skip' })}</div>
                </div>
              </div>

              {previewResult.warnings.length > 0 && (
                <Alert variant="warning">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{t('integrations.xero.csv.clientSync.preview.warnings', { defaultValue: 'Warnings' })}</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4 mt-1 text-sm">
                      {previewResult.warnings.slice(0, 5).map((warning, i) => (
                        <li key={i}>{warning}</li>
                      ))}
                      {previewResult.warnings.length > 5 && (
                        <li>{t('integrations.xero.csv.clientSync.preview.moreWarnings', { defaultValue: '...and {{count}} more', count: previewResult.warnings.length - 5 })}</li>
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
                          <th className="px-3 py-2 text-left font-medium">{t('integrations.xero.csv.clientSync.preview.columns.contactName', { defaultValue: 'Contact Name' })}</th>
                          <th className="px-3 py-2 text-left font-medium">{t('integrations.xero.csv.clientSync.preview.columns.email', { defaultValue: 'Email' })}</th>
                          <th className="px-3 py-2 text-left font-medium">{t('integrations.xero.csv.clientSync.preview.columns.action', { defaultValue: 'Action' })}</th>
                          <th className="px-3 py-2 text-left font-medium">{t('integrations.xero.csv.clientSync.preview.columns.matchedClient', { defaultValue: 'Matched Client' })}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {previewResult.rows.slice(0, 20).map((row) => (
                          <tr key={row.rowIndex} className="hover:bg-muted/30">
                            <td className="px-3 py-2">{row.contactName}</td>
                            <td className="px-3 py-2 text-muted-foreground">{row.email || '-'}</td>
                            <td className="px-3 py-2">
                              <Badge
                                variant={
                                  row.action === 'create'
                                    ? 'info'
                                    : row.action === 'update'
                                      ? 'success'
                                      : 'default-muted'
                                }
                                size="sm"
                              >
                                {row.action}
                              </Badge>
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
                      {t('integrations.xero.csv.clientSync.preview.showing20of', { defaultValue: 'Showing 20 of {{count}} rows', count: previewResult.rows.length })}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <Button id="xero-csv-client-sync-execute-import-button" onClick={handleExecuteImport} disabled={previewResult.toUpdate + previewResult.toCreate === 0}>
                  {t('integrations.xero.csv.clientSync.importContactsButton', { defaultValue: 'Import {{count}} Contacts', count: previewResult.toUpdate + previewResult.toCreate })}
                </Button>
                <Button id="xero-csv-client-sync-cancel-import-button" variant="outline" onClick={handleCancelImport}>
                  {t('integrations.xero.csv.clientSync.cancel', { defaultValue: 'Cancel' })}
                </Button>
              </div>
            </div>
          )}

          {/* Importing State */}
          {importStep === 'importing' && (
            <div className="flex items-center gap-3 p-4 bg-muted/40 rounded-lg">
              <LoadingIndicator spinnerProps={{ size: 'sm' }} />
              <span className="text-sm text-muted-foreground">{t('integrations.xero.csv.clientSync.importing', { defaultValue: 'Importing contacts...' })}</span>
            </div>
          )}

          {/* Complete State */}
          {importStep === 'complete' && importResult && (
            <div className="space-y-4">
              <Alert variant="success">
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>{t('integrations.xero.csv.clientSync.importCompleteTitle', { defaultValue: 'Import Complete' })}</AlertTitle>
                <AlertDescription>
                  {t('integrations.xero.csv.clientSync.importCompleteDescription', { defaultValue: 'Successfully processed {{count}} contacts.', count: importResult.totalProcessed })}
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-4 gap-3 text-center">
                <div className="p-3 bg-success/10 rounded-lg">
                  <div className="text-xl font-bold text-success">{importResult.updated}</div>
                  <div className="text-xs text-success/80">{t('integrations.xero.csv.clientSync.result.updated', { defaultValue: 'Updated' })}</div>
                </div>
                <div className="p-3 bg-primary/10 rounded-lg">
                  <div className="text-xl font-bold text-primary">{importResult.created}</div>
                  <div className="text-xs text-primary/80">{t('integrations.xero.csv.clientSync.result.created', { defaultValue: 'Created' })}</div>
                </div>
                <div className="p-3 bg-muted rounded-lg">
                  <div className="text-xl font-bold text-muted-foreground">{importResult.skipped}</div>
                  <div className="text-xs text-muted-foreground">{t('integrations.xero.csv.clientSync.result.skipped', { defaultValue: 'Skipped' })}</div>
                </div>
                <div className="p-3 bg-purple-500/10 rounded-lg dark:bg-purple-400/10">
                  <div className="text-xl font-bold text-purple-700 dark:text-purple-400">{importResult.mappingsCreated}</div>
                  <div className="text-xs text-purple-600 dark:text-purple-400/80">{t('integrations.xero.csv.clientSync.result.mappings', { defaultValue: 'Mappings' })}</div>
                </div>
              </div>

              {importResult.errors.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{t('integrations.xero.csv.clientSync.errorsTitle', { defaultValue: 'Errors ({{count}})', count: importResult.errors.length })}</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4 mt-1 text-sm">
                      {importResult.errors.slice(0, 5).map((err, i) => (
                        <li key={i}>
                          {t('integrations.xero.csv.clientSync.errorRow', { defaultValue: 'Row {{row}}: {{name}} - {{error}}', row: err.rowIndex, name: err.contactName, error: err.error })}
                        </li>
                      ))}
                      {importResult.errors.length > 5 && (
                        <li>{t('integrations.xero.csv.clientSync.moreErrors', { defaultValue: '...and {{count}} more errors', count: importResult.errors.length - 5 })}</li>
                      )}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <Button id="xero-csv-client-sync-start-new-import-button" variant="outline" onClick={handleStartNewImport}>
                {t('integrations.xero.csv.clientSync.startNewImport', { defaultValue: 'Start New Import' })}
              </Button>
            </div>
          )}
        </div>

        {/* Workflow Guide */}
        <div className="border-t border-border pt-4">
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h5 className="text-sm font-medium text-foreground mb-2">{t('integrations.xero.csv.clientSync.workflowTitle', { defaultValue: 'Client Sync Workflow' })}</h5>
            <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
              <li>{t('integrations.xero.csv.clientSync.workflow.s1', { defaultValue: 'Export clients from Alga to Xero Contacts CSV' })}</li>
              <li>{t('integrations.xero.csv.clientSync.workflow.s2', { defaultValue: 'Import the CSV into Xero (Contacts → Import)' })}</li>
              <li>{t('integrations.xero.csv.clientSync.workflow.s3', { defaultValue: 'After changes in Xero, export contacts from Xero' })}</li>
              <li>{t('integrations.xero.csv.clientSync.workflow.s4', { defaultValue: 'Import the Xero contacts CSV back into Alga to sync updates' })}</li>
            </ol>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default XeroCsvClientSyncPanel;
