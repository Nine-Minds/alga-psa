'use client';

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from 'server/src/components/ui/Card';
import { Label } from 'server/src/components/ui/Label';
import { Button } from 'server/src/components/ui/Button';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { Info, Calculator, Cloud } from 'lucide-react';

import { TaxSource } from 'server/src/interfaces/tax.interfaces';
import {
  getTenantTaxSettings,
  updateTenantTaxSettings,
} from 'server/src/lib/actions/taxSettingsActions';

interface LocalTaxSettings {
  default_tax_source: TaxSource;
  allow_external_tax_override: boolean;
}

interface TaxSourceSettingsProps {
  isReadOnly?: boolean;
}

export function TaxSourceSettings({ isReadOnly = false }: TaxSourceSettingsProps) {
  const [settings, setSettings] = useState<LocalTaxSettings>({
    default_tax_source: 'internal',
    allow_external_tax_override: true, // Always enabled
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
          allow_external_tax_override: true, // Always enabled
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
      // Always set allow_external_tax_override to true
      await updateTenantTaxSettings({
        ...settings,
        allow_external_tax_override: true,
      });
      setOriginalSettings({ ...settings, allow_external_tax_override: true });
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
          <Alert variant="info" showIcon>
            <AlertDescription>
              <p className="font-medium">External Tax Calculation Workflow</p>
              <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
                <li>Invoice is created without tax amounts</li>
                <li>Invoice is exported to your connected accounting system (QuickBooks, Xero, etc.)</li>
                <li>Tax is calculated by the accounting system based on its tax rules</li>
                <li>Tax amounts are imported back to Alga PSA</li>
                <li>Invoice totals are updated with the imported tax</li>
              </ol>
              <p className="mt-3 text-sm text-muted-foreground">
                The accounting system used is determined automatically based on which system you export the invoice to.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {!isReadOnly && (
          <div className="flex justify-end gap-2 pt-4 border-t">
            {hasChanges && (
              <Button
                id="cancel-tax-source-settings-button"
                variant="outline"
                onClick={handleCancel}
                disabled={isSaving}
              >
                Cancel
              </Button>
            )}
            <Button
              id="save-tax-source-settings-button"
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
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
