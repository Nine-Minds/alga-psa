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
import { CURRENCY_OPTIONS } from '@alga-psa/core';
import {
  getXeroCsvSettings,
  updateXeroCsvSettings,
  XeroCsvSettings as XeroCsvSettingsType
} from '@alga-psa/integrations/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  const { t } = useTranslation();
  const CURRENCY_SELECT_OPTIONS = React.useMemo(() => [
    { value: '', label: t('integrations.xero.csv.settings.useInvoiceCurrency', { defaultValue: 'Use invoice currency' }) },
    ...CURRENCY_OPTIONS
  ], [t]);
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
      const message = err instanceof Error ? err.message : t('integrations.xero.csv.settings.errors.load', { defaultValue: 'Failed to load settings' });
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
        setSuccessMessage(t('integrations.xero.csv.settings.savedMessage', { defaultValue: 'Settings saved successfully' }));
        setError(null);
        setTimeout(() => setSuccessMessage(null), 3000);
      } catch (err) {
        const message = err instanceof Error ? err.message : t('integrations.xero.csv.settings.errors.save', { defaultValue: 'Failed to save settings' });
        setError(message);
        setSuccessMessage(null);
      }
    });
  };

  const handleAcknowledgeSetup = () => {
    handleSave({ setupAcknowledged: true });
  };

  const dateFormatOptions = [
    { value: 'DD/MM/YYYY', label: t('integrations.xero.csv.settings.dateFormatOptions.dmy', { defaultValue: 'DD/MM/YYYY (Day/Month/Year)' }) },
    { value: 'MM/DD/YYYY', label: t('integrations.xero.csv.settings.dateFormatOptions.mdy', { defaultValue: 'MM/DD/YYYY (Month/Day/Year)' }) }
  ];

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <LoadingIndicator spinnerProps={{ size: 'sm' }} text={t('integrations.xero.csv.settings.loading', { defaultValue: 'Loading Xero CSV settings...' })} />
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
            {t('integrations.xero.csv.settings.overview.title', { defaultValue: 'Xero CSV Integration' })}
          </CardTitle>
          <CardDescription>
            {t('integrations.xero.csv.settings.overview.description', { defaultValue: 'Export invoices to CSV for manual import into Xero, and import tax data from Xero reports.' })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded border border-border/60 bg-muted/40 p-4 text-sm leading-6 text-muted-foreground space-y-3">
            <p>
              {t('integrations.xero.csv.settings.overview.intro', { defaultValue: 'This integration provides an alternative to OAuth-based Xero connectivity:' })}
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>{t('integrations.xero.csv.settings.overview.exportLabel', { defaultValue: 'Export' })}</strong>: {t('integrations.xero.csv.settings.overview.exportText', { defaultValue: "Generate CSV files compatible with Xero's invoice import feature" })}
              </li>
              <li>
                <strong>{t('integrations.xero.csv.settings.overview.taxImportLabel', { defaultValue: 'Tax Import' })}</strong>: {t('integrations.xero.csv.settings.overview.taxImportText', { defaultValue: "When using external tax calculation, import tax amounts from Xero's Invoice Details Report" })}
              </li>
            </ul>
            <p className="text-xs">
              {t('integrations.xero.csv.settings.overview.note', { defaultValue: 'Note: Configure mappings below before exporting. CSV exports and tax imports are managed from Billing → Accounting Exports.' })}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Xero Setup Instructions - shown if setup not acknowledged */}
      {!settings?.setupAcknowledged && (
        <Card id="xero-csv-setup-card" className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              {t('integrations.xero.csv.settings.setup.title', { defaultValue: 'Xero Setup Required' })}
            </CardTitle>
            <CardDescription>
              {t('integrations.xero.csv.settings.setup.description', { defaultValue: 'Complete these steps in Xero before using CSV import/export.' })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-4 text-sm">
              <div>
                <h4 className="font-medium text-foreground">{t('integrations.xero.csv.settings.setup.step1Title', { defaultValue: 'Step 1: Create Tracking Categories' })}</h4>
                <p className="text-muted-foreground mt-1">
                  {t('integrations.xero.csv.settings.setup.step1Description', { defaultValue: 'In Xero, go to Settings → Tracking Categories and create these two categories:' })}
                </p>
                <ul className="list-disc pl-5 mt-2 text-muted-foreground">
                  <li>
                    <strong>{t('integrations.xero.csv.settings.setup.sourceSystem', { defaultValue: 'Source System' })}</strong> - {t('integrations.xero.csv.settings.setup.sourceSystemHelp', { defaultValue: 'Add an option called' })} <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">AlgaPSA</code>
                  </li>
                  <li>
                    <strong>{t('integrations.xero.csv.settings.setup.externalInvoiceId', { defaultValue: 'External Invoice ID' })}</strong> - {t('integrations.xero.csv.settings.setup.externalInvoiceIdHelp', { defaultValue: 'Options will be created automatically when importing' })}
                  </li>
                </ul>
              </div>

              <div>
                <h4 className="font-medium text-foreground">{t('integrations.xero.csv.settings.setup.step2Title', { defaultValue: 'Step 2: Configure Tax Rates' })}</h4>
                <p className="text-muted-foreground mt-1">
                  {t('integrations.xero.csv.settings.setup.step2Description', { defaultValue: 'Ensure your Xero organisation has the tax rates you need configured under Settings → Tax Rates.' })}
                </p>
              </div>

              <div>
                <h4 className="font-medium text-foreground">{t('integrations.xero.csv.settings.setup.step3Title', { defaultValue: 'Step 3: Map Services and Tax Regions' })}</h4>
                <p className="text-muted-foreground mt-1">
                  {t('integrations.xero.csv.settings.setup.step3Description', { defaultValue: 'Use the mapping section below to link your Alga services to Xero item codes, and your tax regions to Xero tax rates.' })}
                </p>
              </div>
            </div>

            <Button id="xero-csv-integration-acknowledge-setup-button" onClick={handleAcknowledgeSetup} disabled={isSaving}>
              {t('integrations.xero.csv.settings.setup.acknowledge', { defaultValue: "I've completed the setup" })}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* CSV Export Settings Card */}
      <Card id="xero-csv-settings-card">
        <CardHeader>
          <CardTitle>{t('integrations.xero.csv.settings.exportSettings.title', { defaultValue: 'CSV Export Settings' })}</CardTitle>
          <CardDescription>
            {t('integrations.xero.csv.settings.exportSettings.description', { defaultValue: 'Configure how invoices are exported to CSV format for Xero.' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-foreground" htmlFor="xero-date-format">
                {t('integrations.xero.csv.settings.dateFormat', { defaultValue: 'Date Format' })}
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                {t('integrations.xero.csv.settings.dateFormatHelp', { defaultValue: 'Match this to your Xero region settings.' })}
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
                {t('integrations.xero.csv.settings.defaultCurrency', { defaultValue: 'Default Currency' })}
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                {t('integrations.xero.csv.settings.defaultCurrencyHelp', { defaultValue: 'Leave blank to use invoice currency.' })}
              </p>
              <CustomSelect
                id="xero-default-currency"
                value={settings?.defaultCurrency ?? ''}
                onValueChange={(value) => handleSave({ defaultCurrency: value })}
                options={CURRENCY_SELECT_OPTIONS}
                placeholder={t('integrations.xero.csv.settings.selectCurrency', { defaultValue: 'Select currency' })}
                showPlaceholderInDropdown={false}
                disabled={isSaving}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mappings Card */}
      <Card id="xero-csv-mapping-settings-card">
        <CardHeader>
          <CardTitle>{t('integrations.xero.csv.settings.mappings.title', { defaultValue: 'Xero CSV Mappings' })}</CardTitle>
          <CardDescription>
            {t('integrations.xero.csv.settings.mappings.description', { defaultValue: 'Map Alga clients, services, and tax codes to the identifiers used in your Xero organisation. These values are used when generating the CSV export.' })}
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
          <CardTitle>{t('integrations.xero.csv.settings.workflow.title', { defaultValue: 'CSV Workflow' })}</CardTitle>
          <CardDescription>
            {t('integrations.xero.csv.settings.workflow.description', { defaultValue: 'How to export invoices and import tax calculations.' })}
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
              <h4 className="font-medium text-foreground">{t('integrations.xero.csv.settings.workflow.exportInvoices', { defaultValue: 'Export Invoices' })}</h4>
              <ol className="list-decimal pl-5 mt-2 text-sm text-muted-foreground space-y-1">
                <li>{t('integrations.xero.csv.settings.workflow.export.s1', { defaultValue: 'Go to Billing → Accounting Exports' })}</li>
                <li>{t('integrations.xero.csv.settings.workflow.export.s2', { defaultValue: 'Select invoices and choose "Xero CSV" as the adapter' })}</li>
                <li>{t('integrations.xero.csv.settings.workflow.export.s3', { defaultValue: 'Download the generated CSV file' })}</li>
                <li>{t('integrations.xero.csv.settings.workflow.export.s4', { defaultValue: 'In Xero: Business → Invoices → Import' })}</li>
                <li>{t('integrations.xero.csv.settings.workflow.export.s5', { defaultValue: 'Upload the CSV and import as Draft invoices' })}</li>
                <li>{t('integrations.xero.csv.settings.workflow.export.s6', { defaultValue: 'Xero will calculate tax based on your tax settings' })}</li>
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
              <h4 className="font-medium text-foreground">{t('integrations.xero.csv.settings.workflow.importTax', { defaultValue: 'Import Tax Calculations' })}</h4>
              <ol className="list-decimal pl-5 mt-2 text-sm text-muted-foreground space-y-1">
                <li>{t('integrations.xero.csv.settings.workflow.import.s1', { defaultValue: 'In Xero: Reports → All Reports → Invoice Details' })}</li>
                <li>{t('integrations.xero.csv.settings.workflow.import.s2', { defaultValue: 'Set date range and export as CSV' })}</li>
                <li>{t('integrations.xero.csv.settings.workflow.import.s3', { defaultValue: 'In Alga: Billing → Accounting Exports → Import Tax' })}</li>
                <li>{t('integrations.xero.csv.settings.workflow.import.s4', { defaultValue: 'Upload the Xero report CSV' })}</li>
                <li>{t('integrations.xero.csv.settings.workflow.import.s5', { defaultValue: 'Review matched invoices and confirm import' })}</li>
              </ol>
            </div>
          </div>

          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="flex gap-3">
              <FileText className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-foreground">{t('integrations.xero.csv.settings.workflow.trackingTitle', { defaultValue: 'Tracking Categories for Reconciliation' })}</p>
                <p className="text-muted-foreground mt-1">
                  {t('integrations.xero.csv.settings.workflow.trackingDescription', { defaultValue: 'The CSV export includes tracking category columns that link each Xero invoice back to its Alga source. When you import tax from Xero, these tracking categories are used to automatically match invoices - no manual reconciliation needed.' })}
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
            {t('integrations.csv.settings.exports.title', { defaultValue: 'Accounting Exports' })}
          </CardTitle>
          <CardDescription>
            {t('integrations.csv.settings.exports.description', { defaultValue: 'Create export batches, download CSV files, import tax reports, and review export history.' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="info">
            <AlertTitle>{t('integrations.csv.settings.exports.managedTitle', { defaultValue: 'Managed from Billing' })}</AlertTitle>
            <AlertDescription>
              {t('integrations.xero.csv.settings.managedPrefix', { defaultValue: 'Go to' })}{' '}
              <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-mono text-muted-foreground">
                {t('integrations.csv.settings.exports.path', { defaultValue: 'Billing → Accounting Exports' })}
              </span>{' '}
              {t('integrations.xero.csv.settings.managedSuffix', { defaultValue: 'to select invoices, generate Xero CSV exports, import tax reports, and manage batches.' })}
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter className="justify-end">
          <Button id="xero-csv-open-accounting-exports" asChild size="lg">
            <Link href="/msp/billing?tab=accounting-exports" className="inline-flex items-center gap-2">
              {t('integrations.csv.settings.exports.openButton', { defaultValue: 'Open Accounting Exports' })}
              <ExternalLink className="h-4 w-4 opacity-90" />
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export default XeroCsvIntegrationSettings;
