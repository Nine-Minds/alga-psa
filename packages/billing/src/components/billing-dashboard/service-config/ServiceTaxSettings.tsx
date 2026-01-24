'use client';

import React, { useState, useEffect } from 'react';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Card, CardHeader, CardContent, CardTitle, CardFooter } from '@alga-psa/ui/components/Card';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Button } from '@alga-psa/ui/components/Button';
import { updateService } from '@alga-psa/billing/actions';
import { IService } from '@alga-psa/types';
import { ITaxRate } from '@alga-psa/types'; // Use ITaxRate
import { getTaxRates } from '@alga-psa/billing/actions/taxSettingsActions'; // Use getTaxRates

interface ServiceTaxSettingsProps {
  service: IService;
  // Removed taxRates prop, will fetch regions internally
  onUpdate?: () => void;
}

export function ServiceTaxSettings({ service, onUpdate }: ServiceTaxSettingsProps) {
  // State for tax_rate_id instead of is_taxable and region_code
  const [taxRateId, setTaxRateId] = useState<string | null>(service.tax_rate_id || null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // State for fetching tax rates
  const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
  const [isLoadingTaxRates, setIsLoadingTaxRates] = useState(true);
  const [errorTaxRates, setErrorTaxRates] = useState<string | null>(null);

  // Fetch tax regions
  useEffect(() => {
      const fetchTaxRates = async () => {
          try {
              setIsLoadingTaxRates(true);
              const rates = await getTaxRates(); // Fetch rates
              setTaxRates(rates);
              setErrorTaxRates(null);
          } catch (fetchError) { // Use different variable name
              console.error('Error loading tax rates:', fetchError);
              setErrorTaxRates('Failed to load tax rates.');
              setTaxRates([]);
          } finally {
              setIsLoadingTaxRates(false);
          }
      };
      fetchTaxRates();
  }, []);

  // Generate options from fetched tax rates
  const taxRateOptions = taxRates.map(rate => ({
    value: rate.tax_rate_id,
    // Construct a meaningful label
    label: `${rate.tax_type} (${rate.country_code}) - ${rate.tax_percentage}%`
  }));

  // Add an option for non-taxable (clearing the selection)
  const selectOptions = [
    { value: '', label: 'Non-Taxable' }, // Represents null tax_rate_id
    ...taxRateOptions
  ];


  // Handle changes to the tax rate select
  const handleTaxRateChange = (value: string) => {
    setTaxRateId(value || null); // Set to null if '' (Non-Taxable) is selected
  };

  // Removed handleTaxableChange and handleRegionCodeChange






  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);

      // Send only tax_rate_id
      await updateService(service.service_id, {
        tax_rate_id: taxRateId
      } as Pick<IService, 'tax_rate_id'>); // Use Pick for type safety

      if (onUpdate) {
        onUpdate();
      }
    } catch (err) {
      console.error('Error updating tax settings:', err);
      setError('Failed to save tax settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Tax Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Replace Switch and Region Select with Tax Rate Select */}
        <div>
          <CustomSelect
              id="service-tax-rate-select"
              label="Tax Rate"
              options={selectOptions} // Use combined options
              value={taxRateId || ''} // Bind to taxRateId state
              onValueChange={handleTaxRateChange} // Use new handler
              placeholder={isLoadingTaxRates ? "Loading rates..." : "Select Tax Rate"}
              disabled={isSaving || isLoadingTaxRates} // Disable while saving or loading
              allowClear={false} // Don't allow clearing, use 'Non-Taxable' option instead
          />
          <p className="text-xs text-gray-500 mt-1">Select 'Non-Taxable' if this service should not be taxed.</p>
        </div>











        {/* Removed display of effectiveTaxRate */}

        {error && <p className="text-red-500 text-sm">{error}</p>}
        {errorTaxRates && <p className="text-red-500 text-sm">{errorTaxRates}</p>} {/* Show tax rate loading error */}
      </CardContent>
      <CardFooter className="flex justify-end">
        <Button 
          id="save-tax-settings-button"
          onClick={handleSave} 
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Tax Settings'}
        </Button>
      </CardFooter>
    </Card>
  );
}
