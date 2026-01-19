'use client';

import React, { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { FileSpreadsheet, FileText, ExternalLink, Info, Download, Upload } from 'lucide-react';
import { XeroCsvMappingManager } from '@alga-psa/integrations/components/csv/XeroCsvMappingManager';
import { XeroCsvClientSyncPanel } from './XeroCsvClientSyncPanel';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import {
  getXeroCsvSettings,
  updateXeroCsvSettings,
  XeroCsvSettings as XeroCsvSettingsType
} from '@alga-psa/integrations/actions';

/**
 * Xero CSV Integration Settings Component
 *
 * Provides CSV-based export/import for Xero as an alternative
 * to OAuth-based integration. Useful when:
 * - OAuth integration is not available or pending Xero app approval
 * - Manual import process is preferred
 * - External tax calculation with report-based feedback is needed
 */
const XeroCsvIntegrationSettings: React.FC = () => {
  const [settings, setSettings] = useState<XeroCsvSettingsType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, startSave] = useTransition();

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const result = await getXeroCsvSettings();
      setSettings(result);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load settings';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = (updates: Partial<XeroCsvSettingsType>) => {
    startSave(async () => {
      try {
        const result = await updateXeroCsvSettings(updates);
        setSettings(result);
        setSuccessMessage('Settings saved successfully');
        setError(null);
        setTimeout(() => setSuccessMessage(null), 3000);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save settings';
        setError(message);
        setSuccessMessage(null);
      }
    });
  };

  const handleAcknowledgeSetup = () => {
    handleSave({ setupAcknowledged: true });
  };

  const dateFormatOptions = [
    { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (Day/Month/Year)' },
    { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (Month/Day/Year)' }
  ];

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <LoadingIndicator spinnerProps={{ size: 'sm' }} text="Loading Xero CSV settings..." />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Success/Error messages */}
      {successMessage && (
        <Alert variant="success">
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Overview Card */}
      <Card id="xero-csv-integration-overview-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Xero CSV Integration
          </CardTitle>
          <CardDescription>
            Export invoices to CSV for manual import into Xero, and import tax data from Xero reports.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded border border-border/60 bg-muted/40 p-4 text-sm leading-6 text-muted-foreground space-y-3">
            <p>
              This integration provides an alternative to OAuth-based Xero connectivity:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Export</strong>: Generate CSV files compatible with Xero&apos;s invoice import feature
              </li>
              <li>
                <strong>Tax Import</strong>: When using external tax calculation, import tax amounts from Xero&apos;s Invoice Details Report
              </li>
            </ul>
            <p className="text-xs">
              Note: Configure mappings below before exporting. CSV exports and tax imports are managed from Billing → Accounting Exports.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Xero Setup Instructions - shown if setup not acknowledged */}
      {!settings?.setupAcknowledged && (
        <Card id="xero-csv-setup-card" className="border-blue-200 bg-blue-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-blue-500" />
              Xero Setup Required
            </CardTitle>
            <CardDescription>
              Complete these steps in Xero before using CSV import/export.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-4 text-sm">
              <div>
                <h4 className="font-medium text-foreground">Step 1: Create Tracking Categories</h4>
                <p className="text-muted-foreground mt-1">
                  In Xero, go to <strong>Settings → Tracking Categories</strong> and create these two categories:
                </p>
                <ul className="list-disc pl-5 mt-2 text-muted-foreground">
                  <li>
                    <strong>Source System</strong> - Add an option called <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">AlgaPSA</code>
                  </li>
                  <li>
                    <strong>External Invoice ID</strong> - Options will be created automatically when importing
                  </li>
                </ul>
              </div>

              <div>
                <h4 className="font-medium text-foreground">Step 2: Configure Tax Rates</h4>
                <p className="text-muted-foreground mt-1">
                  Ensure your Xero organisation has the tax rates you need configured under{' '}
                  <strong>Settings → Tax Rates</strong>.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-foreground">Step 3: Map Services and Tax Regions</h4>
                <p className="text-muted-foreground mt-1">
                  Use the mapping section below to link your Alga services to Xero item codes,
                  and your tax regions to Xero tax rates.
                </p>
              </div>
            </div>

            <Button id="xero-csv-integration-acknowledge-setup-button" onClick={handleAcknowledgeSetup} disabled={isSaving}>
              I&apos;ve completed the setup
            </Button>
          </CardContent>
        </Card>
      )}

      {/* CSV Export Settings Card */}
      <Card id="xero-csv-settings-card">
        <CardHeader>
          <CardTitle>CSV Export Settings</CardTitle>
          <CardDescription>
            Configure how invoices are exported to CSV format for Xero.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-foreground" htmlFor="xero-date-format">
                Date Format
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                Match this to your Xero region settings.
              </p>
              <CustomSelect
                options={dateFormatOptions}
                value={settings?.dateFormat ?? 'MM/DD/YYYY'}
                onValueChange={(value) =>
                  handleSave({ dateFormat: value as 'DD/MM/YYYY' | 'MM/DD/YYYY' })
                }
                disabled={isSaving}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-foreground" htmlFor="xero-default-currency">
                Default Currency
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                Leave blank to use invoice currency.
              </p>
              <input
                id="xero-default-currency"
                type="text"
                className="w-full rounded-md border px-3 py-2 text-sm"
                placeholder="e.g., NZD, USD, AUD"
                value={settings?.defaultCurrency ?? ''}
                onChange={(e) => handleSave({ defaultCurrency: e.target.value.toUpperCase() })}
                disabled={isSaving}
                maxLength={3}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mappings Card */}
      <Card id="xero-csv-mapping-settings-card">
        <CardHeader>
          <CardTitle>Xero CSV Mappings</CardTitle>
          <CardDescription>
            Map Alga clients, services, and tax codes to the identifiers used in your Xero organisation. These values are used when generating the CSV export.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <XeroCsvMappingManager />
        </CardContent>
      </Card>

      {/* Client Sync Card */}
      <XeroCsvClientSyncPanel />

      {/* Workflow Guide Card */}
      <Card id="xero-csv-workflow-card">
        <CardHeader>
          <CardTitle>CSV Workflow</CardTitle>
          <CardDescription>
            How to export invoices and import tax calculations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex gap-4">
            <div className="flex-shrink-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Download className="h-5 w-5 text-primary" />
              </div>
            </div>
            <div>
              <h4 className="font-medium text-foreground">Export Invoices</h4>
              <ol className="list-decimal pl-5 mt-2 text-sm text-muted-foreground space-y-1">
                <li>Go to Billing → Accounting Exports</li>
                <li>Select invoices and choose &quot;Xero CSV&quot; as the adapter</li>
                <li>Download the generated CSV file</li>
                <li>In Xero: Business → Invoices → Import</li>
                <li>Upload the CSV and import as Draft invoices</li>
                <li>Xero will calculate tax based on your tax settings</li>
              </ol>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-shrink-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Upload className="h-5 w-5 text-primary" />
              </div>
            </div>
            <div>
              <h4 className="font-medium text-foreground">Import Tax Calculations</h4>
              <ol className="list-decimal pl-5 mt-2 text-sm text-muted-foreground space-y-1">
                <li>In Xero: Reports → All Reports → Invoice Details</li>
                <li>Set date range and export as CSV</li>
                <li>In Alga: Billing → Accounting Exports → Import Tax</li>
                <li>Upload the Xero report CSV</li>
                <li>Review matched invoices and confirm import</li>
              </ol>
            </div>
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
            <div className="flex gap-3">
              <FileText className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-foreground">Tracking Categories for Reconciliation</p>
                <p className="text-muted-foreground mt-1">
                  The CSV export includes tracking category columns that link each Xero invoice back to its
                  Alga source. When you import tax from Xero, these tracking categories are used to
                  automatically match invoices - no manual reconciliation needed.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Navigation Card */}
      <Card id="xero-csv-export-navigation-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Accounting Exports
          </CardTitle>
          <CardDescription>
            Create export batches, download CSV files, import tax reports, and review export history.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="info">
            <AlertTitle>Managed from Billing</AlertTitle>
            <AlertDescription>
              Go to{' '}
              <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-mono text-muted-foreground">
                Billing → Accounting Exports
              </span>{' '}
              to select invoices, generate Xero CSV exports, import tax reports, and manage batches.
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter className="justify-end">
          <Button id="xero-csv-open-accounting-exports" asChild size="lg">
            <Link href="/msp/billing?tab=accounting-exports" className="inline-flex items-center gap-2">
              Open Accounting Exports
              <ExternalLink className="h-4 w-4 opacity-90" />
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export default XeroCsvIntegrationSettings;
