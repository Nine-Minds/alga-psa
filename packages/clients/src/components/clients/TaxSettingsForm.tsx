'use client';

import React, { useState, useEffect } from 'react';
import type { TaxSource, IClientTaxSettings } from '@alga-psa/types';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { ShieldOff, ShieldCheck, Info } from 'lucide-react';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import {
  createDefaultTaxSettingsAsync,
  getClientTaxExemptStatusAsync,
  getClientTaxSettingsAsync,
  updateClientTaxExemptStatusAsync,
  updateClientTaxSettingsAsync,
  canClientOverrideTaxSourceAsync,
  getEffectiveTaxSourceForClientAsync,
} from '../../lib/billingHelpers';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface TaxSettingsFormProps {
  clientId: string;
}

const TaxSettingsForm: React.FC<TaxSettingsFormProps> = ({ clientId }) => {
  const { t } = useTranslation('msp/clients');
  const [taxSettings, setTaxSettings] = useState<Omit<IClientTaxSettings, 'tenant'> | null>(null);
  const [originalSettings, setOriginalSettings] = useState<Omit<IClientTaxSettings, 'tenant'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isTaxExempt, setIsTaxExempt] = useState(false);
  const [taxExemptionCertificate, setTaxExemptionCertificate] = useState('');
  const [originalTaxExempt, setOriginalTaxExempt] = useState(false);
  const [originalCertificate, setOriginalCertificate] = useState('');

  const [canOverrideTaxSource, setCanOverrideTaxSource] = useState(false);
  const [effectiveTaxSource, setEffectiveTaxSource] = useState<TaxSource>('internal');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [settings, taxExemptStatus, overrideAllowed, effectiveSource] = await Promise.all([
          getClientTaxSettingsAsync(clientId),
          getClientTaxExemptStatusAsync(clientId),
          canClientOverrideTaxSourceAsync(),
          getEffectiveTaxSourceForClientAsync(clientId)
        ]);

        if (!settings) {
          try {
            const defaultSettings = await createDefaultTaxSettingsAsync(clientId);
            setTaxSettings(defaultSettings);
            setOriginalSettings(JSON.parse(JSON.stringify(defaultSettings)));
            setSuccessMessage(t('taxSettingsForm.defaultCreatedSuccess', { defaultValue: 'Default tax settings created successfully' }));
          } catch {
            setError(t('taxSettingsForm.defaultCreateError', { defaultValue: 'Error creating default tax settings' }));
            setLoading(false);
            return;
          }
        } else {
          setTaxSettings(settings);
          setOriginalSettings(JSON.parse(JSON.stringify(settings)));
        }

        if (taxExemptStatus) {
          setIsTaxExempt(taxExemptStatus.is_tax_exempt);
          setTaxExemptionCertificate(taxExemptStatus.tax_exemption_certificate || '');
          setOriginalTaxExempt(taxExemptStatus.is_tax_exempt);
          setOriginalCertificate(taxExemptStatus.tax_exemption_certificate || '');
        }

        setCanOverrideTaxSource(overrideAllowed);
        setEffectiveTaxSource(effectiveSource.taxSource);

        setLoading(false);
      } catch {
        setError(t('taxSettingsForm.fetchError', { defaultValue: 'Error fetching tax settings' }));
        setLoading(false);
      }
    };

    fetchData();
  }, [clientId, t]);

  const handleCreateDefaultSettings = async () => {
    try {
      setLoading(true);
      const defaultSettings = await createDefaultTaxSettingsAsync(clientId);
      setTaxSettings(defaultSettings);
      setError(null);
      setSuccessMessage(t('taxSettingsForm.defaultCreatedSuccess', { defaultValue: 'Default tax settings created successfully' }));
      setLoading(false);
    } catch {
      setError(t('taxSettingsForm.defaultCreateError', { defaultValue: 'Error creating default tax settings' }));
      setLoading(false);
    }
  };

  const dismissError = () => {
    setError(null);
  };

  const dismissSuccess = () => {
    setSuccessMessage(null);
  };

  const handleTaxSourceOverrideChange = (value: string) => {
    if (!taxSettings) return;

    const source = value as TaxSource;
    setTaxSettings({
      ...taxSettings,
      tax_source_override: source === effectiveTaxSource ? null : source
    });
  };

  // Single save model: every control on this form stages locally and the one
  // Save button persists it all — no mix of auto-saving and deferred controls.
  const handleTaxExemptToggle = (checked: boolean) => {
    setIsTaxExempt(checked);
    if (!checked) {
      setTaxExemptionCertificate('');
    }
  };

  const handleCertificateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTaxExemptionCertificate(e.target.value);
  };

  const handleReverseChargeChange = (checked: boolean) => {
    if (!taxSettings) return;
    setTaxSettings({
      ...taxSettings,
      is_reverse_charge_applicable: checked
    });
  };

  const exemptDirty = isTaxExempt !== originalTaxExempt || taxExemptionCertificate !== originalCertificate;
  const settingsDirty = !!taxSettings && !!originalSettings && JSON.stringify(taxSettings) !== JSON.stringify(originalSettings);
  const hasChanges = exemptDirty || settingsDirty;

  const handleSubmit = async () => {
    if (!taxSettings) return;

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (exemptDirty) {
        const exemptResult = await updateClientTaxExemptStatusAsync(
          clientId,
          isTaxExempt,
          isTaxExempt ? taxExemptionCertificate : ''
        );
        setIsTaxExempt(exemptResult.is_tax_exempt);
        setOriginalTaxExempt(exemptResult.is_tax_exempt);
        const savedCertificate = exemptResult.tax_exemption_certificate ?? '';
        setTaxExemptionCertificate(savedCertificate);
        setOriginalCertificate(savedCertificate);
      }

      if (settingsDirty) {
        const result = await updateClientTaxSettingsAsync(clientId, taxSettings);
        if (result) {
          setTaxSettings(result);
          setOriginalSettings(JSON.parse(JSON.stringify(result)));
        }
      }

      setSuccessMessage(t('taxSettingsForm.saveSuccess', { defaultValue: 'Tax settings updated successfully' }));
    } catch (err) {
      console.error('Failed to update tax settings:', err);
      setError(t('taxSettingsForm.saveError', { defaultValue: 'Failed to update tax settings' }));
      setIsTaxExempt(originalTaxExempt);
      setTaxExemptionCertificate(originalCertificate);
      if (originalSettings) {
        setTaxSettings(JSON.parse(JSON.stringify(originalSettings)));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center p-8">
        <LoadingIndicator />
      </div>
    );
  }

  if (error && !taxSettings) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error}
          <Button id="client-tax-create-default-settings-error" variant="outline" onClick={handleCreateDefaultSettings} className="mt-4">
            {t('taxSettingsForm.createDefaultSettings', { defaultValue: 'Create Default Tax Settings' })}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!taxSettings) {
    return (
      <Alert>
        <AlertDescription>
          {t('taxSettingsForm.noSettings', { defaultValue: 'No tax settings found for this client.' })}
          <Button id="client-tax-create-default-settings-empty" variant="outline" onClick={handleCreateDefaultSettings} className="mt-4">
            {t('taxSettingsForm.createDefaultSettings', { defaultValue: 'Create Default Tax Settings' })}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex justify-between items-center">
            <span>{error}</span>
            <Button id="client-tax-dismiss-error" variant="ghost" size="sm" onClick={dismissError}>
              {t('taxSettingsForm.dismiss', { defaultValue: 'Dismiss' })}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {successMessage && (
        <Alert>
          <AlertDescription className="flex justify-between items-center">
            <span>{successMessage}</span>
            <Button id="client-tax-dismiss-success" variant="ghost" size="sm" onClick={dismissSuccess}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('taxSettingsForm.taxExemptStatus', { defaultValue: 'Tax exempt status' })}</CardTitle>
          <CardDescription>{t('taxSettingsForm.taxExemptDescription', { defaultValue: 'Mark this client as tax exempt and optionally store a certificate number.' })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isTaxExempt ? (
                <ShieldCheck className="h-5 w-5 text-green-600" />
              ) : (
                <ShieldOff className="h-5 w-5 text-gray-400" />
              )}
              <span className="font-medium">{t('taxSettingsForm.taxExempt', { defaultValue: 'Tax Exempt' })}</span>
              <Tooltip content={t('taxSettingsForm.taxExemptTooltip', { defaultValue: 'When enabled, taxes will not be applied to invoices for this client.' })}>
                <Info className="h-4 w-4 text-gray-500" />
              </Tooltip>
            </div>
            <Switch checked={isTaxExempt} onCheckedChange={handleTaxExemptToggle} disabled={isSubmitting} />
          </div>

          {isTaxExempt && (
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('taxSettingsForm.certificateLabel', { defaultValue: 'Exemption certificate' })}</label>
              <Input
                value={taxExemptionCertificate}
                onChange={handleCertificateChange}
                placeholder={t('taxSettingsForm.certificatePlaceholder', { defaultValue: 'Certificate number (optional)' })}
                disabled={isSubmitting}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('taxSettingsForm.taxCalculationSettings', { defaultValue: 'Tax calculation' })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-medium">{t('taxSettingsForm.reverseCharge', { defaultValue: 'Apply reverse charge' })}</span>
              <Tooltip content={t('taxSettingsForm.reverseChargeTooltip', { defaultValue: 'Reverse charge shifts tax liability to the buyer (common in B2B cross-border transactions).' })}>
                <Info className="h-4 w-4 text-gray-500" />
              </Tooltip>
            </div>
            <Switch checked={taxSettings.is_reverse_charge_applicable} onCheckedChange={handleReverseChargeChange} disabled={isSubmitting} />
          </div>

          <div className="text-sm text-gray-500">
            {t('taxSettingsForm.taxSourceHelp', { defaultValue: "Set this client's rates in Billing → Tax rates. Set global rates in Billing settings → Tax." })}
          </div>

          {canOverrideTaxSource && (
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('taxSettingsForm.taxSource', { defaultValue: 'Tax Source' })}</label>
              <CustomSelect
                value={taxSettings.tax_source_override ?? effectiveTaxSource}
                onValueChange={handleTaxSourceOverrideChange}
                options={[
                  { value: 'internal', label: t('taxSettingsForm.taxSourceInternal', { defaultValue: 'Internal' }) },
                  { value: 'external', label: t('taxSettingsForm.taxSourceExternal', { defaultValue: 'External' }) }
                ]}
              />
              <div className="text-sm text-gray-500">
                {t('taxSettingsForm.effectiveTaxSource', { defaultValue: 'Effective tax source: {{source}}', source: effectiveTaxSource })}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button id="client-tax-save-settings" onClick={handleSubmit} disabled={isSubmitting || !hasChanges}>
              {isSubmitting ? t('taxSettingsForm.saving', { defaultValue: 'Saving...' }) : t('taxSettingsForm.saveTaxSettings', { defaultValue: 'Save' })}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TaxSettingsForm;
