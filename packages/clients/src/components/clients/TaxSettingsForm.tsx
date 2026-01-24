'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
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

interface TaxSettingsFormProps {
  clientId: string;
}

const TaxSettingsForm: React.FC<TaxSettingsFormProps> = ({ clientId }) => {
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
  const [isUpdatingExemptStatus, setIsUpdatingExemptStatus] = useState(false);

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
            setSuccessMessage('Default tax settings created successfully');
          } catch (createErr) {
            setError('Error creating default tax settings');
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
      } catch (err) {
        setError('Error fetching tax settings');
        setLoading(false);
      }
    };

    fetchData();
  }, [clientId]);

  const handleCreateDefaultSettings = async () => {
    try {
      setLoading(true);
      const defaultSettings = await createDefaultTaxSettingsAsync(clientId);
      setTaxSettings(defaultSettings);
      setError(null);
      setSuccessMessage('Default tax settings created successfully');
      setLoading(false);
    } catch (err) {
      setError('Error creating default tax settings');
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

  const handleTaxExemptToggle = async (checked: boolean) => {
    if (isUpdatingExemptStatus) return;

    setIsUpdatingExemptStatus(true);
    try {
      const result = await updateClientTaxExemptStatusAsync(
        clientId,
        checked,
        checked ? taxExemptionCertificate : ''
      );

      setIsTaxExempt(result.is_tax_exempt);
      setOriginalTaxExempt(result.is_tax_exempt);
      if (result.tax_exemption_certificate !== undefined) {
        setTaxExemptionCertificate(result.tax_exemption_certificate);
        setOriginalCertificate(result.tax_exemption_certificate);
      }

      setSuccessMessage('Tax exempt status updated successfully');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tax exempt status');
      setIsTaxExempt(originalTaxExempt);
      setTaxExemptionCertificate(originalCertificate);
    } finally {
      setIsUpdatingExemptStatus(false);
    }
  };

  const handleCertificateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTaxExemptionCertificate(e.target.value);
  };

  const saveCertificate = async () => {
    if (isUpdatingExemptStatus) return;

    setIsUpdatingExemptStatus(true);
    try {
      const result = await updateClientTaxExemptStatusAsync(
        clientId,
        isTaxExempt,
        taxExemptionCertificate
      );

      if (result.tax_exemption_certificate !== undefined) {
        setOriginalCertificate(result.tax_exemption_certificate);
      }

      setSuccessMessage('Tax exemption certificate updated successfully');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tax exemption certificate');
      setTaxExemptionCertificate(originalCertificate);
    } finally {
      setIsUpdatingExemptStatus(false);
    }
  };

  const handleReverseChargeChange = (checked: boolean) => {
    if (!taxSettings) return;
    setTaxSettings({
      ...taxSettings,
      is_reverse_charge_applicable: checked
    });
  };

  const handleSubmit = async () => {
    if (!taxSettings) return;

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const result = await updateClientTaxSettingsAsync(clientId, taxSettings);
      if (result) {
        setTaxSettings(result);
        setOriginalSettings(JSON.parse(JSON.stringify(result)));
        setSuccessMessage('Tax settings updated successfully');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tax settings');
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
            Create Default Tax Settings
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!taxSettings) {
    return (
      <Alert>
        <AlertDescription>
          No tax settings found for this client.
          <Button id="client-tax-create-default-settings-empty" variant="outline" onClick={handleCreateDefaultSettings} className="mt-4">
            Create Default Tax Settings
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
              Dismiss
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
          <CardTitle>Tax Exempt Status</CardTitle>
          <CardDescription>Mark this client as tax exempt and optionally store a certificate number.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isTaxExempt ? (
                <ShieldCheck className="h-5 w-5 text-green-600" />
              ) : (
                <ShieldOff className="h-5 w-5 text-gray-400" />
              )}
              <span className="font-medium">Tax Exempt</span>
              <Tooltip content="When enabled, taxes will not be applied to invoices for this client.">
                <Info className="h-4 w-4 text-gray-500" />
              </Tooltip>
            </div>
            <Switch checked={isTaxExempt} onCheckedChange={handleTaxExemptToggle} disabled={isUpdatingExemptStatus} />
          </div>

          {isTaxExempt && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Tax Exemption Certificate</label>
              <div className="flex gap-2">
                <Input
                  value={taxExemptionCertificate}
                  onChange={handleCertificateChange}
                  placeholder="Certificate number (optional)"
                  disabled={isUpdatingExemptStatus}
                />
                <Button id="client-tax-save-certificate" onClick={saveCertificate} disabled={isUpdatingExemptStatus}>
                  Save
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tax Calculation Settings</CardTitle>
          <CardDescription>Configure how taxes are calculated for this client.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-medium">Reverse Charge Applicable</span>
              <Tooltip content="Reverse charge shifts tax liability to the buyer (common in B2B cross-border transactions).">
                <Info className="h-4 w-4 text-gray-500" />
              </Tooltip>
            </div>
            <Switch checked={taxSettings.is_reverse_charge_applicable} onCheckedChange={handleReverseChargeChange} />
          </div>

          <div className="text-sm text-gray-500">
            Manage default client tax rates in Client Settings → Tax Rates, and manage global rates in Billing → Tax Settings.
            <Link href="/billing/settings/tax" className="ml-1 underline">
              Go to Billing Tax Settings
            </Link>
          </div>

          {canOverrideTaxSource && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Tax Source</label>
              <CustomSelect
                value={taxSettings.tax_source_override ?? effectiveTaxSource}
                onValueChange={handleTaxSourceOverrideChange}
                options={[
                  { value: 'internal', label: 'Internal' },
                  { value: 'external', label: 'External' }
                ]}
              />
              <div className="text-sm text-gray-500">
                Effective tax source: <span className="font-medium">{effectiveTaxSource}</span>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button id="client-tax-save-settings" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Tax Settings'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TaxSettingsForm;
