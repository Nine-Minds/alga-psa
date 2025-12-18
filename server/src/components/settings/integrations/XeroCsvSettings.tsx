'use client';

import React, { useEffect, useState, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Alert, AlertDescription } from '../../ui/Alert';
import LoadingIndicator from '../../ui/LoadingIndicator';
import CustomSelect from '../../ui/CustomSelect';
import { Info, FileText, Upload, Download } from 'lucide-react';
import {
  getXeroCsvSettings,
  updateXeroCsvSettings,
  XeroCsvSettings as XeroCsvSettingsType
} from 'server/src/lib/actions/integrations/xeroCsvActions';

interface XeroCsvSettingsProps {
  /** Optional callback when settings are saved */
  onSettingsSaved?: () => void;
}

/**
 * Settings panel for Xero CSV integration mode.
 * Allows configuring date format, currency, and shows setup instructions.
 */
const XeroCsvSettings: React.FC<XeroCsvSettingsProps> = ({ onSettingsSaved }) => {
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
        onSettingsSaved?.();
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

      {/* Setup Instructions Card */}
      {!settings?.setupAcknowledged && (
        <Card className="border-blue-200 bg-blue-50/50">
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
                  In Xero, go to <strong>Settings &rarr; Tracking Categories</strong> and create these two categories:
                </p>
                <ul className="list-disc pl-5 mt-2 text-muted-foreground">
                  <li>
                    <strong>Source System</strong> - Add an option called &quot;AlgaPSA&quot;
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
                  <strong>Settings &rarr; Tax Rates</strong>.
                </p>
              </div>

              <div>
                <h4 className="font-medium text-foreground">Step 3: Map Services and Tax Regions</h4>
                <p className="text-muted-foreground mt-1">
                  Use the mapping section below to link your Alga services to Xero item codes and account codes,
                  and your tax regions to Xero tax rates.
                </p>
              </div>
            </div>

            <Button onClick={handleAcknowledgeSetup} disabled={isSaving}>
              I&apos;ve completed the setup
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle>CSV Export Settings</CardTitle>
          <CardDescription>
            Configure how invoices are exported to CSV format for Xero.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-foreground" htmlFor="date-format">
                Date Format
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                Match this to your Xero region settings.
              </p>
              <CustomSelect
                options={dateFormatOptions}
                value={settings?.dateFormat ?? 'DD/MM/YYYY'}
                onValueChange={(value) =>
                  handleSave({ dateFormat: value as 'DD/MM/YYYY' | 'MM/DD/YYYY' })
                }
                disabled={isSaving}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-foreground" htmlFor="default-currency">
                Default Currency
              </label>
              <p className="text-xs text-muted-foreground mb-2">
                Leave blank to use invoice currency.
              </p>
              <input
                id="default-currency"
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

      {/* Workflow Guide Card */}
      <Card>
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
                <li>Go to Billing &rarr; Accounting Exports</li>
                <li>Select invoices and choose &quot;Xero (CSV)&quot; as the adapter</li>
                <li>Download the generated CSV file</li>
                <li>In Xero: Business &rarr; Invoices &rarr; Import</li>
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
                <li>In Xero: Reports &rarr; All Reports &rarr; Invoice Details</li>
                <li>Set date range and export as CSV</li>
                <li>In Alga: Billing &rarr; Accounting Exports &rarr; Import Tax</li>
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
    </div>
  );
};

export default XeroCsvSettings;
