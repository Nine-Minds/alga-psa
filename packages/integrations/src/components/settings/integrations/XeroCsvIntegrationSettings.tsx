'use client';

import React, { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { ExternalLink, Info, Download, Upload, FileText } from 'lucide-react';
import { XeroCsvMappingManager } from '@alga-psa/integrations/components/csv/XeroCsvMappingManager';
import { XeroCsvClientSyncPanel } from './XeroCsvClientSyncPanel';
import { Button } from '@alga-psa/ui/components/Button';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { CURRENCY_OPTIONS } from '@alga-psa/core';
import {
  getXeroCsvSettings,
  updateXeroCsvSettings,
  XeroCsvSettings as XeroCsvSettingsType
} from '@alga-psa/integrations/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

function FeedbackMessage({
  tone,
  children
}: {
  tone: 'success' | 'error';
  children: React.ReactNode;
}) {
  const Icon = tone === 'success' ? CheckCircle2 : AlertCircle;
  const toneClass =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-red-200 bg-red-50 text-red-800';

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${toneClass}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

/**
 * Xero CSV settings — a file-based workflow: complete a one-time Xero setup,
 * map your billing data, then generate CSVs from Billing → Accounting Exports
 * and import tax totals back from Xero reports.
 */
const XeroCsvIntegrationSettings: React.FC = () => {
  const { t } = useTranslation('msp/integrations');
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
      const message = t('integrations.xero.csv.settings.errors.load', { defaultValue: 'Failed to load settings' });
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
        const message = t('integrations.xero.csv.settings.errors.save', { defaultValue: 'Failed to save settings' });
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
      <div className="py-8">
        <LoadingIndicator spinnerProps={{ size: 'sm' }} text={t('integrations.xero.csv.settings.loading', { defaultValue: 'Loading Xero CSV settings...' })} />
      </div>
    );
  }

  return (
    <div className="space-y-8" id="xero-csv-integration-settings">
      {successMessage ? <FeedbackMessage tone="success">{successMessage}</FeedbackMessage> : null}
      {error ? <FeedbackMessage tone="error">{error}</FeedbackMessage> : null}

      <section className="space-y-3" id="xero-csv-integration-overview-card">
        <h3 className="text-base font-semibold text-foreground">
          {t('integrations.xero.csv.settings.overview.title', { defaultValue: 'Xero CSV Integration' })}
        </h3>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t('integrations.xero.csv.settings.overview.summary', {
            defaultValue:
              'Generate a CSV of your finalized invoices to import into Xero, then import tax totals back from Xero reports. Complete the one-time Xero setup below, map your billing data, and run exports from Billing → Accounting Exports.'
          })}
        </p>
      </section>

      {!settings?.setupAcknowledged && (
        <section
          id="xero-csv-setup-card"
          className="rounded-lg border border-primary/30 bg-primary/5 p-4"
        >
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-foreground">{t('integrations.xero.csv.settings.setup.title', { defaultValue: 'Finish the one-time Xero setup' })}</h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('integrations.xero.csv.settings.setup.description', { defaultValue: 'Complete these steps in Xero before using CSV import/export.' })}
                </p>
              </div>

              <div className="space-y-4 text-sm">
                <div>
                  <h5 className="font-medium text-foreground">{t('integrations.xero.csv.settings.setup.step1Title', { defaultValue: 'Step 1: Create Tracking Categories' })}</h5>
                  <p className="mt-1 text-muted-foreground">
                    {t('integrations.xero.csv.settings.setup.step1Description', { defaultValue: 'In Xero, go to Settings → Tracking Categories and create these two categories:' })}
                  </p>
                  <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                    <li>
                      <strong>{t('integrations.xero.csv.settings.setup.sourceSystem', { defaultValue: 'Source System' })}</strong> - {t('integrations.xero.csv.settings.setup.sourceSystemHelp', { defaultValue: 'Add an option called' })} <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">AlgaPSA</code>
                    </li>
                    <li>
                      <strong>{t('integrations.xero.csv.settings.setup.externalInvoiceId', { defaultValue: 'External Invoice ID' })}</strong> - {t('integrations.xero.csv.settings.setup.externalInvoiceIdHelp', { defaultValue: 'Options will be created automatically when importing' })}
                    </li>
                  </ul>
                </div>

                <div>
                  <h5 className="font-medium text-foreground">{t('integrations.xero.csv.settings.setup.step2Title', { defaultValue: 'Step 2: Configure Tax Rates' })}</h5>
                  <p className="mt-1 text-muted-foreground">
                    {t('integrations.xero.csv.settings.setup.step2Description', { defaultValue: 'Ensure your Xero organisation has the tax rates you need configured under Settings → Tax Rates.' })}
                  </p>
                </div>

                <div>
                  <h5 className="font-medium text-foreground">{t('integrations.xero.csv.settings.setup.step3Title', { defaultValue: 'Step 3: Map Services and Tax Regions' })}</h5>
                  <p className="mt-1 text-muted-foreground">
                    {t('integrations.xero.csv.settings.setup.step3Description', { defaultValue: 'Use the mapping section below to link your Alga services to Xero item codes, and your tax regions to Xero tax rates.' })}
                  </p>
                </div>
              </div>

              <Button id="xero-csv-integration-acknowledge-setup-button" onClick={handleAcknowledgeSetup} disabled={isSaving}>
                {t('integrations.xero.csv.settings.setup.acknowledge', { defaultValue: "I've completed the setup" })}
              </Button>
            </div>
          </div>
        </section>
      )}

      <section id="xero-csv-settings-card" className="space-y-4 border-t pt-6">
        <div>
          <h3 className="text-base font-semibold text-foreground">{t('integrations.xero.csv.settings.exportSettings.title', { defaultValue: 'Export settings' })}</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t('integrations.xero.csv.settings.exportSettings.description', { defaultValue: 'Configure how invoices are exported to CSV format for Xero.' })}
          </p>
        </div>
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-foreground" htmlFor="xero-date-format">
              {t('integrations.xero.csv.settings.dateFormat', { defaultValue: 'Date Format' })}
            </label>
            <p className="mb-2 text-xs text-muted-foreground">
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
            <p className="mb-2 text-xs text-muted-foreground">
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
      </section>

      <section id="xero-csv-mapping-settings-card" className="space-y-4 border-t pt-6">
        <div>
          <h3 className="text-base font-semibold text-foreground">{t('integrations.xero.csv.settings.mappings.title', { defaultValue: 'Mappings' })}</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t('integrations.xero.csv.settings.mappings.description', { defaultValue: 'Match your clients, services, and tax codes to the identifiers used in your Xero organisation. These values are written into every CSV export.' })}
          </p>
        </div>
        <XeroCsvMappingManager />
      </section>

      <section className="border-t pt-6">
        <XeroCsvClientSyncPanel />
      </section>

      <section className="space-y-4 border-t pt-6">
        <div>
          <h3 className="text-base font-semibold text-foreground">{t('integrations.xero.csv.settings.workflow.title', { defaultValue: 'CSV workflow' })}</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t('integrations.xero.csv.settings.workflow.description', { defaultValue: 'How to export invoices and import tax calculations.' })}
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Download className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h4 className="font-medium text-foreground">{t('integrations.xero.csv.settings.workflow.exportInvoices', { defaultValue: 'Export Invoices' })}</h4>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>{t('integrations.xero.csv.settings.workflow.export.s1', { defaultValue: 'Go to Billing → Accounting Exports' })}</li>
                <li>{t('integrations.xero.csv.settings.workflow.export.s2', { defaultValue: 'Select invoices and choose "Xero CSV" as the adapter' })}</li>
                <li>{t('integrations.xero.csv.settings.workflow.export.s3', { defaultValue: 'Download the generated CSV file' })}</li>
                <li>{t('integrations.xero.csv.settings.workflow.export.s4', { defaultValue: 'In Xero: Business → Invoices → Import' })}</li>
                <li>{t('integrations.xero.csv.settings.workflow.export.s5', { defaultValue: 'Upload the CSV and import as Draft invoices' })}</li>
                <li>{t('integrations.xero.csv.settings.workflow.export.s6', { defaultValue: 'Xero will calculate tax based on your tax settings' })}</li>
              </ol>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Upload className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h4 className="font-medium text-foreground">{t('integrations.xero.csv.settings.workflow.importTax', { defaultValue: 'Import Tax Calculations' })}</h4>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>{t('integrations.xero.csv.settings.workflow.import.s1', { defaultValue: 'In Xero: Reports → All Reports → Invoice Details' })}</li>
                <li>{t('integrations.xero.csv.settings.workflow.import.s2', { defaultValue: 'Set date range and export as CSV' })}</li>
                <li>{t('integrations.xero.csv.settings.workflow.import.s3', { defaultValue: 'In Alga: Billing → Accounting Exports → Import Tax' })}</li>
                <li>{t('integrations.xero.csv.settings.workflow.import.s4', { defaultValue: 'Upload the Xero report CSV' })}</li>
                <li>{t('integrations.xero.csv.settings.workflow.import.s5', { defaultValue: 'Review matched invoices and confirm import' })}</li>
              </ol>
            </div>
          </div>
        </div>

        <div className="flex gap-3 rounded-lg border bg-muted/30 p-4">
          <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="text-sm">
            <p className="font-medium text-foreground">{t('integrations.xero.csv.settings.workflow.trackingTitle', { defaultValue: 'Tracking Categories for Reconciliation' })}</p>
            <p className="mt-1 text-muted-foreground">
              {t('integrations.xero.csv.settings.workflow.trackingDescription', { defaultValue: 'The CSV export includes tracking category columns that link each Xero invoice back to its Alga source. When you import tax from Xero, these tracking categories are used to automatically match invoices - no manual reconciliation needed.' })}
            </p>
          </div>
        </div>
      </section>

      <section
        id="xero-csv-export-navigation-card"
        className="flex flex-wrap items-end justify-between gap-4 border-t pt-6"
      >
        <div>
          <h3 className="text-base font-semibold text-foreground">{t('integrations.csv.settings.exports.title', { defaultValue: 'Accounting exports' })}</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t('integrations.xero.csv.settings.exports.navDescription', {
              defaultValue:
                'Create export batches, download CSV files, import tax reports, and review history from Billing → Accounting Exports.'
            })}
          </p>
        </div>
        <Button id="xero-csv-open-accounting-exports" asChild>
          <Link href="/msp/billing?tab=accounting-exports" className="inline-flex items-center gap-2">
            {t('integrations.csv.settings.exports.openButton', { defaultValue: 'Open Accounting Exports' })}
            <ExternalLink className="h-4 w-4" />
          </Link>
        </Button>
      </section>
    </div>
  );
};

export default XeroCsvIntegrationSettings;
