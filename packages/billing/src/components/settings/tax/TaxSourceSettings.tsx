'use client';

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@alga-psa/ui/components/Card';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { RadioGroup } from '@alga-psa/ui/components/RadioGroup';
import { Info, Calculator, Cloud } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

import { TaxSource } from '@alga-psa/types';
import {
  getTenantTaxSettings,
  updateTenantTaxSettings,
} from '@alga-psa/billing/actions';

interface LocalTaxSettings {
  default_tax_source: TaxSource;
  allow_external_tax_override: boolean;
}

interface TaxSourceSettingsProps {
  isReadOnly?: boolean;
}

export function TaxSourceSettings({ isReadOnly = false }: TaxSourceSettingsProps) {
  const { t } = useTranslation('msp/billing-settings');
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
      handleError(error, t('tax.source.errors.load', { defaultValue: 'Failed to load tax source settings.' }));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

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
      toast.success(t('tax.source.toast.saved', { defaultValue: 'Tax source settings saved successfully.' }));
    } catch (error: any) {
      handleError(error, t('tax.source.errors.save', { defaultValue: 'Failed to save settings.' }));
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
          <CardTitle>{t('tax.source.title', { defaultValue: 'Tax Calculation Source' })}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center p-4 text-muted-foreground">
            {t('tax.source.loading', { defaultValue: 'Loading settings...' })}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="tax-source-settings-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t('tax.source.title', { defaultValue: 'Tax Calculation Source' })}
          <Tooltip content={t('tax.source.tooltip', {
            defaultValue: 'Choose whether taxes are calculated by Alga PSA or delegated to your external accounting system'
          })}>
            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
          </Tooltip>
        </CardTitle>
        <CardDescription>
          {t('tax.source.description', {
            defaultValue: 'Configure how tax amounts are calculated for invoices.'
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <Label className="text-sm font-medium">
            {t('tax.source.fields.defaultMethod.label', {
              defaultValue: 'Default Tax Calculation Method'
            })}
          </Label>
          <RadioGroup
            id="tax-source"
            name="tax-source"
            value={settings.default_tax_source}
            onChange={(value) => setSettings({ ...settings, default_tax_source: value as TaxSource })}
            disabled={isReadOnly}
            options={[
              {
                value: 'internal',
                label: t('tax.source.options.internal.label', { defaultValue: 'Internal (Alga PSA)' }),
                description: t('tax.source.options.internal.description', {
                  defaultValue: 'Taxes are calculated automatically based on tax rates configured in Alga PSA.'
                }),
                icon: <Calculator className="h-4 w-4" />,
              },
              {
                value: 'external',
                label: t('tax.source.options.external.label', {
                  defaultValue: 'External (Accounting Package)'
                }),
                description: t('tax.source.options.external.description', {
                  defaultValue: 'Invoices are exported without tax. Tax is calculated by your accounting system and imported back.'
                }),
                icon: <Cloud className="h-4 w-4" />,
              },
            ]}
          />
        </div>

        {settings.default_tax_source === 'external' && (
          <Alert variant="info" showIcon>
            <AlertDescription>
              <p className="font-medium">
                {t('tax.source.workflow.title', { defaultValue: 'External Tax Calculation Workflow' })}
              </p>
              <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
                <li>{t('tax.source.workflow.step1', { defaultValue: 'Invoice is created without tax amounts' })}</li>
                <li>{t('tax.source.workflow.step2', {
                  defaultValue: 'Invoice is exported to your connected accounting system (QuickBooks, Xero, etc.)'
                })}</li>
                <li>{t('tax.source.workflow.step3', {
                  defaultValue: 'Tax is calculated by the accounting system based on its tax rules'
                })}</li>
                <li>{t('tax.source.workflow.step4', { defaultValue: 'Tax amounts are imported back to Alga PSA' })}</li>
                <li>{t('tax.source.workflow.step5', {
                  defaultValue: 'Invoice totals are updated with the imported tax'
                })}</li>
              </ol>
              <p className="mt-3 text-sm text-muted-foreground">
                {t('tax.source.workflow.note', {
                  defaultValue: 'The accounting system used is determined automatically based on which system you export the invoice to.'
                })}
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
                {t('tax.source.actions.cancel', { defaultValue: 'Cancel' })}
              </Button>
            )}
            <Button
              id="save-tax-source-settings-button"
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
            >
              {isSaving
                ? t('tax.source.actions.saving', { defaultValue: 'Saving...' })
                : t('tax.source.actions.save', { defaultValue: 'Save Settings' })}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default TaxSourceSettings;
