'use client';

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from 'server/src/components/ui/Card';
import { Label } from 'server/src/components/ui/Label';
import { Button } from 'server/src/components/ui/Button';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { Info, AlertTriangle, Calculator, Cloud } from 'lucide-react';

import { TaxSource, ExternalTaxAdapter } from 'server/src/interfaces/tax.interfaces';
import {
  getTenantTaxSettings,
  updateTenantTaxSettings,
} from 'server/src/lib/actions/taxSettingsActions';

const ADAPTER_OPTIONS = [
  { value: 'quickbooks', label: 'QuickBooks Online' },
  { value: 'xero', label: 'Xero' },
  { value: 'sage', label: 'Sage' },
];

interface LocalTaxSettings {
  default_tax_source: TaxSource;
  allow_external_tax_override: boolean;
  external_tax_adapter: ExternalTaxAdapter;
}

interface TaxSourceSettingsProps {
  isReadOnly?: boolean;
}

export function TaxSourceSettings({ isReadOnly = false }: TaxSourceSettingsProps) {
  const [settings, setSettings] = useState<LocalTaxSettings>({
    default_tax_source: 'internal',
    allow_external_tax_override: false,
    external_tax_adapter: null,
  });
  const [originalSettings, setOriginalSettings] = useState<LocalTaxSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const fetchedSettings = await getTenantTaxSettings();
      if (fetchedSettings) {
        const mappedSettings: LocalTaxSettings = {
          default_tax_source: fetchedSettings.default_tax_source,
          allow_external_tax_override: fetchedSettings.allow_external_tax_override,
          external_tax_adapter: (fetchedSettings.external_tax_adapter as ExternalTaxAdapter) || null,
        };
        setSettings(mappedSettings);
        setOriginalSettings(mappedSettings);
      }
    } catch (error) {
      console.error('Failed to fetch tax source settings:', error);
      toast.error('Failed to load tax source settings.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateTenantTaxSettings(settings);
      setOriginalSettings(settings);
      toast.success('Tax source settings saved successfully.');
    } catch (error: any) {
      console.error('Failed to save tax source settings:', error);
      toast.error(`Failed to save settings: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (originalSettings) {
      setSettings(originalSettings);
    }
  };

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(originalSettings);

  if (isLoading) {
    return (
      <Card id="tax-source-settings-card">
        <CardHeader>
          <CardTitle>Tax Calculation Source</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center p-4 text-muted-foreground">Loading settings...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="tax-source-settings-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Tax Calculation Source
          <Tooltip content="Choose whether taxes are calculated by Alga PSA or delegated to your external accounting system">
            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
          </Tooltip>
        </CardTitle>
        <CardDescription>
          Configure how tax amounts are calculated for invoices.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <Label className="text-sm font-medium">Default Tax Calculation Method</Label>
          <div className="space-y-3">
            <div className="flex items-start space-x-3">
              <input
                type="radio"
                id="tax-source-internal"
                name="tax-source"
                value="internal"
                checked={settings.default_tax_source === 'internal'}
                onChange={() => setSettings({ ...settings, default_tax_source: 'internal' })}
                disabled={isReadOnly}
                className="mt-1 h-4 w-4 border-gray-300 text-primary focus:ring-primary"
              />
              <div className="space-y-1">
                <Label htmlFor="tax-source-internal" className="flex items-center gap-2 cursor-pointer font-medium">
                  <Calculator className="h-4 w-4 text-green-600" />
                  Internal (Alga PSA)
                </Label>
                <p className="text-sm text-muted-foreground">
                  Taxes are calculated automatically based on tax rates configured in Alga PSA.
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <input
                type="radio"
                id="tax-source-external"
                name="tax-source"
                value="external"
                checked={settings.default_tax_source === 'external'}
                onChange={() => setSettings({ ...settings, default_tax_source: 'external' })}
                disabled={isReadOnly}
                className="mt-1 h-4 w-4 border-gray-300 text-primary focus:ring-primary"
              />
              <div className="space-y-1">
                <Label htmlFor="tax-source-external" className="flex items-center gap-2 cursor-pointer font-medium">
                  <Cloud className="h-4 w-4 text-blue-600" />
                  External (Accounting Package)
                </Label>
                <p className="text-sm text-muted-foreground">
                  Invoices are exported without tax. Tax is calculated by your accounting system and imported back.
                </p>
              </div>
            </div>
          </div>
        </div>

        {settings.default_tax_source === 'external' && (
          <div className="space-y-4 pl-6 border-l-2 border-blue-200">
            <div className="space-y-2">
              <Label htmlFor="external-adapter-select">Accounting System</Label>
              <CustomSelect
                options={ADAPTER_OPTIONS}
                value={settings.external_tax_adapter || ''}
                onValueChange={(value) => setSettings({ ...settings, external_tax_adapter: value as ExternalTaxAdapter })}
                placeholder="Select accounting system..."
                disabled={isReadOnly}
              />
            </div>

            {settings.external_tax_adapter && (
              <Alert variant="info" showIcon>
                <AlertDescription>
                  <p className="font-medium">External Tax Calculation Workflow</p>
                  <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
                    <li>Invoice is exported to {ADAPTER_OPTIONS.find(o => o.value === settings.external_tax_adapter)?.label} without tax</li>
                    <li>Tax is calculated by {ADAPTER_OPTIONS.find(o => o.value === settings.external_tax_adapter)?.label}</li>
                    <li>Tax amounts are imported back to Alga PSA</li>
                    <li>Invoice totals are updated with imported tax</li>
                  </ol>
                </AlertDescription>
              </Alert>
            )}

            {!settings.external_tax_adapter && (
              <Alert variant="destructive" showIcon={false}>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Please select an accounting system to use for external tax calculation.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {settings.default_tax_source === 'external' && (
          <div className="pt-4 border-t">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="allow-override"
                checked={settings.allow_external_tax_override}
                onChange={(e) => setSettings({ ...settings, allow_external_tax_override: e.target.checked })}
                disabled={isReadOnly}
                className="rounded border-gray-300 text-primary focus:ring-primary"
              />
              <Label htmlFor="allow-override" className="cursor-pointer">
                Allow clients to override tax source
              </Label>
              <Tooltip content="When enabled, individual clients can be configured to use a different tax calculation method">
                <Info className="h-4 w-4 text-muted-foreground cursor-help" />
              </Tooltip>
            </div>
            <p className="text-sm text-muted-foreground ml-6 mt-1">
              Enable this to allow per-client tax source configuration in client billing settings.
            </p>
          </div>
        )}

        {hasChanges && !isReadOnly && (
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              id="cancel-tax-source-settings-button"
              variant="outline"
              onClick={handleCancel}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              id="save-tax-source-settings-button"
              onClick={handleSave}
              disabled={isSaving || (settings.default_tax_source === 'external' && !settings.external_tax_adapter)}
            >
              {isSaving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default TaxSourceSettings;
