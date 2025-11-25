import React, { useState, useEffect } from 'react';
import { getClientTaxSettings, updateClientTaxSettings, getTaxRates, createDefaultTaxSettings, updateClientTaxExemptStatus, getClientTaxExemptStatus } from '../lib/actions/taxSettingsActions';
import { IClientTaxSettings, ITaxRate, ITaxComponent, ITaxRateThreshold, ITaxHoliday } from '../interfaces/tax.interfaces';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Button } from 'server/src/components/ui/Button';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { Input } from 'server/src/components/ui/Input';
import { Switch } from 'server/src/components/ui/Switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from 'server/src/components/ui/Card';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { ShieldOff, ShieldCheck, Info } from 'lucide-react';
import { Tooltip } from 'server/src/components/ui/Tooltip';

interface TaxSettingsFormProps {
  clientId: string;
}

const TaxSettingsForm: React.FC<TaxSettingsFormProps> = ({ clientId }) => {
  const [taxSettings, setTaxSettings] = useState<Omit<IClientTaxSettings, 'tenant'> | null>(null);
  const [originalSettings, setOriginalSettings] = useState<Omit<IClientTaxSettings, 'tenant'> | null>(null);
  const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Tax exempt state
  const [isTaxExempt, setIsTaxExempt] = useState(false);
  const [taxExemptionCertificate, setTaxExemptionCertificate] = useState('');
  const [originalTaxExempt, setOriginalTaxExempt] = useState(false);
  const [originalCertificate, setOriginalCertificate] = useState('');
  const [isUpdatingExemptStatus, setIsUpdatingExemptStatus] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [settings, rates, taxExemptStatus] = await Promise.all([
          getClientTaxSettings(clientId),
          getTaxRates(),
          getClientTaxExemptStatus(clientId)
        ]);

        setTaxSettings(settings);
        // Store original settings for reverting on error
        setOriginalSettings(JSON.parse(JSON.stringify(settings)));
        setTaxRates(rates);

        // Set tax exempt status
        if (taxExemptStatus) {
          setIsTaxExempt(taxExemptStatus.is_tax_exempt);
          setTaxExemptionCertificate(taxExemptStatus.tax_exemption_certificate || '');
          setOriginalTaxExempt(taxExemptStatus.is_tax_exempt);
          setOriginalCertificate(taxExemptStatus.tax_exemption_certificate || '');
        }

        setLoading(false);
      } catch (err) {
        if (err instanceof Error && err.message === 'No tax settings found') {
          setTaxSettings(null);
        } else {
          setError('Error fetching tax settings');
        }
        setLoading(false);
      }
    };

    fetchData();
  }, [clientId]);

  // Handle creation of default tax settings when none exist
  const handleCreateDefaultSettings = async () => {
    try {
      setLoading(true);
      const defaultSettings = await createDefaultTaxSettings(clientId);
      setTaxSettings(defaultSettings);
      setError(null);
      setSuccessMessage('Default tax settings created successfully');
      setLoading(false);
    } catch (err) {
      setError('Error creating default tax settings');
      setLoading(false);
    }
  };

  // Dismiss error message
  const dismissError = () => {
    setError(null);
  };

  // Validate tax settings before submission
  const validateTaxSettings = (settings: Omit<IClientTaxSettings, 'tenant'>): string | null => {
   // Removed validation for tax_rate_id as it's no longer part of settings

    // Validate tax rate thresholds
    if (settings.tax_rate_thresholds && settings.tax_rate_thresholds.length > 0) {
      for (let i = 0; i < settings.tax_rate_thresholds.length; i++) {
        const threshold = settings.tax_rate_thresholds[i];
        if (threshold.min_amount < 0) {
          return `Threshold ${i + 1} has a negative minimum amount`;
        }
        if (threshold.max_amount !== undefined && threshold.max_amount < threshold.min_amount) {
          return `Threshold ${i + 1} has a maximum amount less than its minimum amount`;
        }
        if (threshold.rate < 0) {
          return `Threshold ${i + 1} has a negative rate`;
        }
      }
    }

    // Validate tax holidays
    if (settings.tax_holidays && settings.tax_holidays.length > 0) {
      for (let i = 0; i < settings.tax_holidays.length; i++) {
        const holiday = settings.tax_holidays[i];
        if (!holiday.start_date || !holiday.end_date) {
          return `Holiday ${i + 1} is missing start or end date`;
        }
        if (new Date(holiday.start_date) > new Date(holiday.end_date)) {
          return `Holiday ${i + 1} has an end date before its start date`;
        }
      }
    }

    return null;
  };

  // Dismiss success message
  const dismissSuccess = () => {
    setSuccessMessage(null);
  };

  // Handle tax exempt status update
  const handleTaxExemptUpdate = async () => {
    setIsUpdatingExemptStatus(true);
    setError(null);

    try {
      await updateClientTaxExemptStatus(
        clientId,
        isTaxExempt,
        taxExemptionCertificate || undefined
      );

      // Update original values after successful save
      setOriginalTaxExempt(isTaxExempt);
      setOriginalCertificate(taxExemptionCertificate);
      setSuccessMessage(isTaxExempt
        ? 'Client marked as tax exempt.'
        : 'Tax exempt status removed from client.');
    } catch (err) {
      // Revert on error
      setIsTaxExempt(originalTaxExempt);
      setTaxExemptionCertificate(originalCertificate);
      setError(err instanceof Error ? err.message : 'Failed to update tax exempt status');
    } finally {
      setIsUpdatingExemptStatus(false);
    }
  };

  // Check if tax exempt settings have changed
  const hasTaxExemptChanges = isTaxExempt !== originalTaxExempt ||
    taxExemptionCertificate !== originalCertificate;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taxSettings) return;

    // Validate tax settings before submission
    const validationError = validateTaxSettings(taxSettings);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      const updatedSettings = await updateClientTaxSettings(clientId, taxSettings);
      setTaxSettings(updatedSettings);
      // Update original settings after successful update
      setOriginalSettings(JSON.parse(JSON.stringify(updatedSettings)));
      setError(null);
      setSuccessMessage('Tax settings updated successfully');
    } catch (err) {
      // Revert to original settings on error
      if (originalSettings) {
        setTaxSettings(JSON.parse(JSON.stringify(originalSettings)));
      }
      setError(err instanceof Error ? err.message : 'Error updating tax settings');
    } finally {
      setIsSubmitting(false);
    }
  };

 // Removed handleTaxRateChange as tax_rate_id is no longer managed here

 // Removed handlers for components, thresholds, and holidays as these sections are removed

  if (loading) return <div>Loading...</div>;

  // Dismissible error message
  const ErrorMessage = () => {
    if (!error) return null;
    return (
      <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-4">
        <div className="flex items-start">
          <div className="flex-1">
            <p className="text-red-700">{error}</p>
          </div>
          <button
            onClick={dismissError}
            className="ml-4 text-red-500 hover:text-red-700"
            aria-label="Dismiss error"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  // Dismissible success message
  const SuccessMessage = () => {
    if (!successMessage) return null;
    return (
      <div className="bg-green-50 border-l-4 border-green-500 p-4 mb-4">
        <div className="flex items-start">
          <div className="flex-1">
            <p className="text-green-700">{successMessage}</p>
          </div>
          <button
            onClick={dismissSuccess}
            className="ml-4 text-green-500 hover:text-green-700"
            aria-label="Dismiss success message"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
    );
  };
  if (!taxSettings) {
    return (
      <div className="text-center">
        <p className="mb-4">No tax settings found for this client.</p>
        <Button
          id="create-default-tax-settings-button"
          onClick={handleCreateDefaultSettings}
          variant="default"
        >
          Create Default Tax Settings
        </Button>
      </div>
    );
  }

 // Removed taxRateOptions as the select dropdown is removed

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Client Tax Settings</h2>
      <ErrorMessage />
      <SuccessMessage />

      {/* Tax Exempt Status Card */}
      <Card id="tax-exempt-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isTaxExempt ? (
              <ShieldOff className="h-5 w-5 text-amber-500" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-green-500" />
            )}
            Tax Exempt Status
          </CardTitle>
          <CardDescription>
            Tax exempt clients will not have taxes applied to their invoices.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Tax Exempt</span>
              <Tooltip content="When enabled, no taxes will be calculated for this client's invoices. Changes are logged for audit purposes.">
                <Info className="h-4 w-4 text-muted-foreground cursor-help" />
              </Tooltip>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {isTaxExempt ? 'Exempt' : 'Not Exempt'}
              </span>
              <Switch
                checked={isTaxExempt}
                onCheckedChange={setIsTaxExempt}
                disabled={isUpdatingExemptStatus}
              />
            </div>
          </div>

          {isTaxExempt && (
            <div className="space-y-2">
              <label htmlFor="tax-exemption-certificate" className="text-sm font-medium">
                Tax Exemption Certificate Number
              </label>
              <Input
                id="tax-exemption-certificate"
                type="text"
                placeholder="Enter certificate number (optional)"
                value={taxExemptionCertificate}
                onChange={(e) => setTaxExemptionCertificate(e.target.value)}
                disabled={isUpdatingExemptStatus}
              />
              <p className="text-xs text-muted-foreground">
                Optional: Store the client's tax exemption certificate number for reference.
              </p>
            </div>
          )}

          {isTaxExempt && (
            <Alert variant="info" showIcon>
              <AlertDescription>
                <p className="font-medium">Tax Exempt Client</p>
                <p className="text-sm mt-1">
                  This client will not be charged any taxes on invoices. Make sure to keep their exemption certificate on file.
                </p>
              </AlertDescription>
            </Alert>
          )}

          {hasTaxExemptChanges && (
            <div className="flex justify-end gap-2 pt-2">
              <Button
                id="cancel-tax-exempt-changes-button"
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsTaxExempt(originalTaxExempt);
                  setTaxExemptionCertificate(originalCertificate);
                }}
                disabled={isUpdatingExemptStatus}
              >
                Cancel
              </Button>
              <Button
                id="save-tax-exempt-status-button"
                type="button"
                size="sm"
                onClick={handleTaxExemptUpdate}
                disabled={isUpdatingExemptStatus}
              >
                {isUpdatingExemptStatus ? 'Saving...' : 'Save Tax Exempt Status'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Existing Tax Settings Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card id="reverse-charge-card">
          <CardHeader>
            <CardTitle>Advanced Tax Options</CardTitle>
            <CardDescription>
              Configure special tax handling for this client.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Checkbox
                id="reverseCharge"
                label="Apply Reverse Charge"
                checked={taxSettings.is_reverse_charge_applicable}
                onChange={(e) =>
                  setTaxSettings({ ...taxSettings, is_reverse_charge_applicable: (e.target as HTMLInputElement).checked })
                }
              />
              <Tooltip content="Reverse charge shifts the tax liability from the seller to the buyer. Common in B2B transactions across borders.">
                <Info className="h-4 w-4 text-muted-foreground cursor-help" />
              </Tooltip>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-between">
          <Button
            id="reset-tax-settings-button"
            type="button"
            onClick={() => {
              if (originalSettings) {
                setTaxSettings(JSON.parse(JSON.stringify(originalSettings)));
                setError(null);
              }
            }}
            variant="outline"
            disabled={isSubmitting}
          >
            Reset Changes
          </Button>
          <Button
            id="update-tax-settings-button"
            type="submit"
            variant="default"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Updating...' : 'Update Tax Settings'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default TaxSettingsForm;
